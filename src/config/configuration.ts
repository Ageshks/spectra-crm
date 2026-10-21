import { randomBytes } from 'crypto';
import * as Joi from 'joi';

import { EXPORT_RETENTION_HOURS } from '../common/constants';

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value === 'true' || value === '1';

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) ? parsed : fallback;
};

export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  trustProxy: boolean;
  swaggerEnabled: boolean;
  workersEnabled: boolean;
  schedulerEnabled: boolean;
  bodyLimit: string;
  databaseUrl: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: number;
    refreshTtl: number;
  };
  redisUrl: string;
  firebase: {
    projectId?: string;
    clientEmail?: string;
    privateKey?: string;
  };
  cloudinary: {
    cloudName?: string;
    apiKey?: string;
    apiSecret?: string;
  };
  uploads: {
    maxFileSize: number;
  };
  attendance: {
    gpsEnabled: boolean;
    gpsRadiusMeters: number;
    workStartTime: string;
    workEndTime: string;
    lateThresholdMinutes: number;
    minHalfDayMinutes: number;
  };
  exports: {
    storageDir: string;
    retentionHours: number;
  };
  timezone: string;
}

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGIN: Joi.string().default('*'),
  TRUST_PROXY: Joi.string().valid('true', 'false', '1', '0').default('true'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false', '1', '0').default('false'),
  WORKERS_ENABLED: Joi.string().valid('true', 'false', '1', '0').default('true'),
  SCHEDULER_ENABLED: Joi.string().valid('true', 'false', '1', '0').default('true'),
  BODY_LIMIT: Joi.string().default('1mb'),
  DATABASE_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.number().integer().min(60).default(900),
  JWT_REFRESH_TTL: Joi.number().integer().min(3600).default(604800),
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  FIREBASE_PROJECT_ID: Joi.string().allow('').optional(),
  FIREBASE_CLIENT_EMAIL: Joi.string().allow('').optional(),
  FIREBASE_PRIVATE_KEY: Joi.string().allow('').optional(),
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').optional(),
  CLOUDINARY_API_KEY: Joi.string().allow('').optional(),
  CLOUDINARY_API_SECRET: Joi.string().allow('').optional(),
  MAX_FILE_SIZE_BYTES: Joi.number().integer().min(1024).max(25 * 1024 * 1024).default(5 * 1024 * 1024),
  GPS_ATTENDANCE_ENABLED: Joi.string().valid('true', 'false').default('false'),
  GPS_ATTENDANCE_RADIUS_METERS: Joi.number().integer().min(10).default(500),
  DEFAULT_WORK_START_TIME: Joi.string().pattern(/^\d{2}:\d{2}$/).default('09:00'),
  DEFAULT_WORK_END_TIME: Joi.string().pattern(/^\d{2}:\d{2}$/).default('18:00'),
  LATE_THRESHOLD_MINUTES: Joi.number().integer().min(0).default(15),
  MIN_HALF_DAY_MINUTES: Joi.number().integer().min(0).default(240),
  EXPORT_STORAGE_DIR: Joi.string().default('./storage'),
  EXPORT_RETENTION_HOURS: Joi.number().integer().min(1).default(EXPORT_RETENTION_HOURS),
  APP_TIMEZONE: Joi.string().default('Asia/Kolkata'),
}).unknown();

/** Normalises a PEM private key supplied via env (handles literal \n and \\n). */
const normalisePrivateKey = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  let key = value.trim();
  // Strip surrounding quotes that some env stores preserve.
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, '\n');
  return key || undefined;
};

export const configuration = (): AppConfig => {
  const { error, value } = envSchema.validate(process.env);
  if (error) {
    throw new Error(`Invalid environment configuration: ${error.message}`);
  }

  // Fail fast in production on weak/default secrets.
  if (value.NODE_ENV === 'production') {
    const weak = new Set([
      'change-me',
      'change-me-to-a-long-random-string',
      'change-me-to-another-long-random-string',
      'dev-secret',
    ]);
    for (const secret of [value.JWT_ACCESS_SECRET, value.JWT_REFRESH_SECRET]) {
      if (weak.has(String(secret)) || String(secret).length < 32) {
        throw new Error(
          'Invalid environment configuration: JWT secrets must be at least 32 characters in production',
        );
      }
    }
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      throw new Error(
        'Invalid environment configuration: JWT access and refresh secrets must differ',
      );
    }
    if (String(value.CORS_ORIGIN).trim() === '*') {
      throw new Error(
        'Invalid environment configuration: CORS_ORIGIN must be an explicit allowlist in production',
      );
    }
  }

  return {
    env: value.NODE_ENV,
    isProduction: value.NODE_ENV === 'production',
    port: int(value.PORT, 3000),
    apiPrefix: value.API_PREFIX,
    corsOrigins: String(value.CORS_ORIGIN)
      .split(',')
      .map((origin: string) => origin.trim())
      .filter(Boolean),
    trustProxy: bool(value.TRUST_PROXY, true),
    swaggerEnabled:
      value.NODE_ENV === 'production' ? bool(value.SWAGGER_ENABLED, false) : true,
    workersEnabled: bool(value.WORKERS_ENABLED, true),
    schedulerEnabled: bool(value.SCHEDULER_ENABLED, true),
    bodyLimit: String(value.BODY_LIMIT || '1mb'),
    databaseUrl: value.DATABASE_URL,
    jwt: {
      accessSecret: value.JWT_ACCESS_SECRET,
      refreshSecret: value.JWT_REFRESH_SECRET,
      accessTtl: int(value.JWT_ACCESS_TTL, 900),
      refreshTtl: int(value.JWT_REFRESH_TTL, 604800),
    },
    redisUrl: value.REDIS_URL,
    firebase: {
      projectId: value.FIREBASE_PROJECT_ID || undefined,
      clientEmail: value.FIREBASE_CLIENT_EMAIL || undefined,
      privateKey: normalisePrivateKey(value.FIREBASE_PRIVATE_KEY),
    },
    cloudinary: {
      cloudName: value.CLOUDINARY_CLOUD_NAME || undefined,
      apiKey: value.CLOUDINARY_API_KEY || undefined,
      apiSecret: value.CLOUDINARY_API_SECRET || undefined,
    },
    uploads: {
      maxFileSize: int(value.MAX_FILE_SIZE_BYTES, 5 * 1024 * 1024),
    },
    attendance: {
      gpsEnabled: bool(value.GPS_ATTENDANCE_ENABLED, false),
      gpsRadiusMeters: int(value.GPS_ATTENDANCE_RADIUS_METERS, 500),
      workStartTime: value.DEFAULT_WORK_START_TIME,
      workEndTime: value.DEFAULT_WORK_END_TIME,
      lateThresholdMinutes: int(value.LATE_THRESHOLD_MINUTES, 15),
      minHalfDayMinutes: int(value.MIN_HALF_DAY_MINUTES, 240),
    },
    exports: {
    storageDir: value.EXPORT_STORAGE_DIR || './storage',
    retentionHours: int(value.EXPORT_RETENTION_HOURS, EXPORT_RETENTION_HOURS),
  },
  timezone: value.APP_TIMEZONE,
  };
};

/** Only used to keep a stable import target when env sampling is needed. */
export const randomSecret = (): string => randomBytes(32).toString('hex');
