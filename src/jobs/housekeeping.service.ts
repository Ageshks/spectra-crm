import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { AppConfig } from '../config/configuration';
import { PrismaService } from '../database/prisma.service';
import { QueueService } from '../queues/queues.module';

/**
 * Recurring housekeeping. Runs inside the API process by default and can be
 * disabled per-container with SCHEDULER_ENABLED=false (e.g. scaled API
 * replicas should leave it enabled on exactly one replica, or run the
 * dedicated worker process instead).
 */
@Injectable()
export class HousekeepingService {
  private readonly logger = new Logger(HousekeepingService.name);
  private readonly enabled: boolean;
  private readonly timezone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    config: ConfigService,
  ) {
    const app = config.get<AppConfig>('app') as AppConfig | undefined;
    this.enabled =
      app?.schedulerEnabled ?? config.get<string>('SCHEDULER_ENABLED') !== 'false';
    this.timezone =
      app?.timezone ?? config.get<string>('APP_TIMEZONE') ?? 'Asia/Kolkata';
  }

  /** Nightly: purge expired refresh/password-reset tokens. */
  @Cron('15 2 * * *', { name: 'purge-expired-tokens', timeZone: 'Asia/Kolkata' })
  async purgeExpiredTokens(): Promise<void> {
    if (!this.enabled) return;
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [refresh, resets] = await Promise.all([
        this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
        this.prisma.passwordResetToken.deleteMany({
          where: { expiresAt: { lt: cutoff } },
        }),
      ]);
      if (refresh.count + resets.count > 0) {
        this.logger.log(
          `Purged ${refresh.count} refresh tokens and ${resets.count} reset tokens`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Token purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Daily maintenance reminders are enqueued for the queue worker to deliver. */
  @Cron('0 8 * * *', { name: 'enqueue-maintenance-reminders', timeZone: 'Asia/Kolkata' })
  async enqueueMaintenanceReminders(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.queues.enqueueMaintenanceReminder();
    } catch (error) {
      this.logger.error(
        `Maintenance reminder enqueue failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Returns the configured timezone (used by worker logs). */
  getTimezone(): string {
    return this.timezone;
  }
}
