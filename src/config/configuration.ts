import { randomBytes } from 'crypto';
import * as Joi from 'joi';

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
  timezone: string;
}

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGIN: Joi.string().default('*'),
  DATABASE_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.number().default(900),
  JWT_REFRESH_TTL: Joi.number().default(604800),
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  FIREBASE_PROJECT_ID: Joi.string().allow('').optional(),
  FIREBASE_CLIENT_EMAIL: Joi.string().allow('').optional(),
  FIREBASE_PRIVATE_KEY: Joi.string().allow('').optional(),
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').optional(),
  CLOUDINARY_API_KEY: Joi.string().allow('').optional(),
  CLOUDINARY_API_SECRET: Joi.string().allow('').optional(),
  MAX_FILE_SIZE_BYTES: Joi.number().default(5 * 1024 * 1024),
  GPS_ATTENDANCE_ENABLED: Joi.string().valid('true', 'false').default('false'),
  GPS_ATTENDANCE_RADIUS_METERS: Joi.number().default(500),
  DEFAULT_WORK_START_TIME: Joi.string().default('09:00'),
  DEFAULT_WORK_END_TIME: Joi.string().default('18:00'),
  LATE_THRESHOLD_MINUTES: Joi.number().default(15),
  MIN_HALF_DAY_MINUTES: Joi.number().default(240),
  APP_TIMEZONE: Joi.string().default('Asia/Kolkata'),
}).unknown();

export const configuration = (): AppConfig => {
  const { error, value } = envSchema.validate(process.env);
  if (error) {
    throw new Error(`Invalid environment configuration: ${error.message}`);
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
      privateKey: value.FIREBASE_PRIVATE_KEY
        ? String(value.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n')
        : undefined,
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
    timezone: value.APP_TIMEZONE,
  };
};

/** Only used to keep a stable import target when env sampling is needed. */
export const randomSecret = (): string => randomBytes(32).toString('hex');
