import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '../common/constants';

type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const connectionOptionsFromUrl = (redisUrl: string): { host: string; port: number; password?: string; db?: number } => {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    ...(url.pathname && url.pathname !== '/' ? { db: Number(url.pathname.slice(1)) } : {}),
  };
};

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/**
 * Queue producers used by the API process. Consumers (workers) live in
 * src/workers and run in a separate process.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  readonly notifications: Queue;
  readonly maintenance: Queue;
  readonly reports: Queue;
  readonly exports: Queue;
  readonly cleanup: Queue;

  constructor(config: ConfigService) {
    const connection = connectionOptionsFromUrl(
      config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
    );
    this.notifications = new Queue(QUEUE_NAMES.NOTIFICATIONS, { connection, defaultJobOptions });
    this.maintenance = new Queue(QUEUE_NAMES.MAINTENANCE, { connection, defaultJobOptions });
    this.reports = new Queue(QUEUE_NAMES.REPORTS, { connection, defaultJobOptions });
    this.exports = new Queue(QUEUE_NAMES.EXPORTS, { connection, defaultJobOptions });
    this.cleanup = new Queue(QUEUE_NAMES.CLEANUP, { connection, defaultJobOptions });
  }

  async enqueuePush(payload: {
    notificationId: string;
    userId: string;
    title: string;
    message: string;
    referenceId?: string;
    referenceType?: string;
  }): Promise<void> {
    try {
      await this.notifications.add(JOB_NAMES.SEND_PUSH, payload);
    } catch (error) {
      // The in-app notification row is already persisted; never fail the
      // business request because push delivery is unavailable.
      this.logger.warn(
        `enqueuePush failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async enqueueMaintenanceReminder(): Promise<void> {
    try {
      await this.maintenance.add(JOB_NAMES.MAINTENANCE_REMINDER, {}, { jobId: `mtr-${Date.now()}` });
    } catch (error) {
      this.logger.warn(
        `enqueueMaintenanceReminder failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async enqueueExport(jobId: string): Promise<void> {
    try {
      await this.exports.add(JOB_NAMES.EXPORT_BUILD, { jobId }, { jobId });
    } catch (error) {
      this.logger.error(
        `enqueueExport failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [this.notifications, this.maintenance, this.reports, this.exports, this.cleanup].map((q) =>
        q.close().catch(() => undefined),
      ),
    );
  }
}

@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueuesModule {}
