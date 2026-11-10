import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { SETTING_KEYS } from '../constants';
import { PrismaService } from '../../database/prisma.service';

const DEFAULT_COMPANY_ID = '00000000-0000-4000-8000-000000000001';

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly cache = new Map<string, string>();
  private readonly envDefaults = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const attendance =
      config.get<AppConfig['attendance']>('attendance') ??
      ({
        gpsEnabled: config.get<string>('GPS_ATTENDANCE_ENABLED') === 'true',
        gpsRadiusMeters: Number(config.get<string>('GPS_ATTENDANCE_RADIUS_METERS') ?? 500),
        workStartTime: config.get<string>('DEFAULT_WORK_START_TIME') ?? '09:00',
        workEndTime: config.get<string>('DEFAULT_WORK_END_TIME') ?? '18:00',
        lateThresholdMinutes: Number(config.get<string>('LATE_THRESHOLD_MINUTES') ?? 15),
        minHalfDayMinutes: Number(config.get<string>('MIN_HALF_DAY_MINUTES') ?? 240),
      } satisfies AppConfig['attendance']);
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
        this.cache.set(this.cacheKey(row.companyId, row.key), row.value);
      }
    } catch {
      // Settings fall back to env defaults when DB is unreachable at boot.
    }
  }

  async get(key: string, companyId = DEFAULT_COMPANY_ID): Promise<string | undefined> {
    const cacheKey = this.cacheKey(companyId, key);
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
    const row = await this.prisma.setting.findUnique({ where: { companyId_key: { companyId, key } } });
    if (row) {
      this.cache.set(cacheKey, row.value);
      return row.value;
    }
    return this.envDefaults.get(key);
  }

  async getString(key: string, companyId?: string): Promise<string | undefined> {
    return this.get(key, companyId);
  }

  async getBoolean(key: string, fallback = false, companyId?: string): Promise<boolean> {
    const value = await this.get(key, companyId);
    if (value === undefined) return fallback;
    return value === 'true' || value === '1';
  }

  async getNumber(key: string, fallback: number, companyId?: string): Promise<number> {
    const value = await this.get(key, companyId);
    const parsed = Number(value);
    return value !== undefined && Number.isFinite(parsed) ? parsed : fallback;
  }

  async set(key: string, value: string, description?: string, companyId = DEFAULT_COMPANY_ID): Promise<void> {
    await this.prisma.setting.upsert({
      where: { companyId_key: { companyId, key } },
      create: { companyId, key, value, description },
      update: { value, description: description ?? undefined },
    });
    this.cache.set(this.cacheKey(companyId, key), value);
  }

  private cacheKey(companyId: string, key: string): string { return `${companyId}:${key}`; }

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
