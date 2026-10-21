import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '../common/constants';
import { AppConfig } from '../config/configuration';
import { PrismaService } from '../database/prisma.service';
import { ExportBuilderService } from '../modules/exports/export-builder.service';
import { FcmService } from '../modules/notifications/fcm.service';

const connectionOptionsFromUrl = (
  redisUrl: string,
): { host: string; port: number; password?: string; db?: number } => {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    ...(url.pathname && url.pathname !== '/' ? { db: Number(url.pathname.slice(1)) } : {}),
  };
};

/**
 * BullMQ consumers. Runs inside the API process by default (WORKERS_ENABLED)
 * and/or in the dedicated `worker` container (`npm run worker:prod`).
 */
@Injectable()
export class WorkersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkersService.name);
  private readonly workers: Worker[] = [];
  private readonly enabled: boolean;
  private readonly redisUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmService,
    private readonly exportBuilder: ExportBuilderService,
    config: ConfigService,
  ) {
    const app = config.get<AppConfig>('app') as AppConfig | undefined;
    this.enabled =
      app?.workersEnabled ?? config.get<string>('WORKERS_ENABLED') !== 'false';
    this.redisUrl =
      app?.redisUrl ??
      config.get<string>('REDIS_URL') ??
      'redis://localhost:6379';
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Queue workers disabled (WORKERS_ENABLED=false)');
      return;
    }
    let connection: ReturnType<typeof connectionOptionsFromUrl>;
    try {
      connection = connectionOptionsFromUrl(this.redisUrl);
    } catch (error) {
      this.logger.error('Queue workers disabled: invalid REDIS_URL');
      return;
    }

    this.workers.push(
      new Worker(QUEUE_NAMES.NOTIFICATIONS, (job) => this.handleNotification(job), {
        connection,
        concurrency: 10,
      }),
      new Worker(QUEUE_NAMES.MAINTENANCE, (job) => this.handleMaintenance(job), {
        connection,
        concurrency: 2,
      }),
      new Worker(QUEUE_NAMES.EXPORTS, (job) => this.handleExport(job), {
        connection,
        concurrency: 2,
      }),
      new Worker(QUEUE_NAMES.CLEANUP, (job) => this.handleCleanup(job), {
        connection,
        concurrency: 2,
      }),
      new Worker(QUEUE_NAMES.REPORTS, (job) => this.handleReport(job), {
        connection,
        concurrency: 2,
      }),
    );
    for (const worker of this.workers) {
      worker.on('failed', (job, error) => {
        this.logger.warn(`Job failed: ${job?.queueName}/${job?.name}: ${error?.message}`);
      });
    }
    this.logger.log('Queue workers started');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
  }


  private async handleNotification(job: Job): Promise<void> {
    if (job.name !== JOB_NAMES.SEND_PUSH) return;
    const data = job.data as { userId?: string; title?: string; message?: string };
    if (!data?.userId || !data?.title || !data?.message) return;
    await this.fcm.sendToUser(data.userId, { title: data.title, body: data.message });
  }

  private async handleMaintenance(job: Job): Promise<void> {
    if (job.name !== JOB_NAMES.MAINTENANCE_REMINDER) return;
    const now = new Date();
    const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const due = await this.prisma.maintenanceSchedule.findMany({
      where: {
        status: 'ACTIVE',
        nextServiceDate: { gte: now, lte: horizon },
        reminderRecords: { none: {} },
      },
      select: { id: true, customerId: true, nextServiceDate: true },
      take: 500,
    });
    for (const schedule of due) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: schedule.customerId },
        select: { userId: true },
      });
      if (!customer) continue;
      const dueDate = schedule.nextServiceDate.toISOString().slice(0, 10);
      try {
        await this.prisma.maintenanceReminderRecord.create({
          data: { scheduleId: schedule.id, dueDate: new Date(dueDate) },
        });
      } catch {
        continue;
      }
      await this.prisma.notification.create({
        data: {
          userId: customer.userId,
          title: 'Service due soon',
          message: `Maintenance is due on ${dueDate}`,
          type: 'MAINTENANCE_REMINDER',
          referenceId: schedule.id,
          referenceType: 'maintenance',
        },
      });
      await this.fcm.sendToUser(customer.userId, {
        title: 'Service due soon',
        body: `Maintenance is due on ${dueDate}`,
      });
    }
  }

  private async handleExport(job: Job): Promise<void> {
    if (job.name !== JOB_NAMES.EXPORT_BUILD) return;
    const jobId = (job.data as { jobId?: string })?.jobId;
    if (!jobId) return;
    await this.exportBuilder.build(jobId);
  }

  private async handleCleanup(job: Job): Promise<void> {
    if (job.name === JOB_NAMES.TOKEN_CLEANUP) {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await this.prisma.refreshToken
        .deleteMany({ where: { expiresAt: { lt: cutoff } } })
        .catch(() => undefined);
      return;
    }
    if (job.name === JOB_NAMES.NOTIFICATION_CLEANUP) {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      await this.prisma.notification
        .deleteMany({ where: { isRead: true, createdAt: { lt: cutoff } } })
        .catch(() => undefined);
    }
  }

  private async handleReport(job: Job): Promise<void> {
    this.logger.debug(`Report queue job ${job.name} ${job.id} ignored (no handler)`);
  }
}