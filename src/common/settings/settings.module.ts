import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SETTING_KEYS } from '../constants';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly cache = new Map<string, string>();
  private readonly envDefaults = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const attendance = config.get('attendance');
    this.envDefaults.set(SETTING_KEYS.GPS_ATTENDANCE_ENABLED, String(attendance.gpsEnabled));
    this.envDefaults.set(
      SETTING_KEYS.GPS_ATTENDANCE_RADIUS_METERS,
      String(attendance.gpsRadiusMeters),
    );
    this.envDefaults.set(SETTING_KEYS.WORK_START_TIME, attendance.workStartTime);
    this.envDefaults.set(SETTING_KEYS.WORK_END_TIME, attendance.workEndTime);
    this.envDefaults.set(
      SETTING_KEYS.LATE_THRESHOLD_MINUTES,
      String(attendance.lateThresholdMinutes),
    );
    this.envDefaults.set(
      SETTING_KEYS.MIN_HALF_DAY_MINUTES,
      String(attendance.minHalfDayMinutes),
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.prisma.setting.findMany();
      for (const row of rows) {
        this.cache.set(row.key, row.value);
      }
    } catch {
      // Settings fall back to env defaults when DB is unreachable at boot.
    }
  }

  async get(key: string): Promise<string | undefined> {
    if (this.cache.has(key)) return this.cache.get(key);
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (row) {
      this.cache.set(key, row.value);
      return row.value;
    }
    return this.envDefaults.get(key);
  }

  async getString(key: string): Promise<string | undefined> {
    return this.get(key);
  }

  async getBoolean(key: string, fallback = false): Promise<boolean> {
    const value = await this.get(key);
    if (value === undefined) return fallback;
    return value === 'true' || value === '1';
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const value = await this.get(key);
    const parsed = Number(value);
    return value !== undefined && Number.isFinite(parsed) ? parsed : fallback;
  }

  async set(key: string, value: string, description?: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value, description },
      update: { value, description: description ?? undefined },
    });
    this.cache.set(key, value);
  }

  async list(): Promise<Array<{ key: string; value: string; description: string | null }>> {
    const rows = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    const keys = new Set([...rows.map((r) => r.key), ...this.envDefaults.keys()]);
    return [...keys].sort().map((key) => {
      const row = rows.find((r) => r.key === key);
      return {
        key,
        value: row?.value ?? this.envDefaults.get(key) ?? '',
        description: row?.description ?? null,
      };
    });
  }
}

@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
