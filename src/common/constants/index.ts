export const PAGINATION_DEFAULT_PAGE = 1;
export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

export const PASSWORD_MIN_LENGTH = 8;

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

/** Setting keys managed by the Settings module. */
export const SETTING_KEYS = {
  GPS_ATTENDANCE_ENABLED: 'GPS_ATTENDANCE_ENABLED',
  GPS_ATTENDANCE_RADIUS_METERS: 'GPS_ATTENDANCE_RADIUS_METERS',
  WORK_START_TIME: 'WORK_START_TIME',
  WORK_END_TIME: 'WORK_END_TIME',
  LATE_THRESHOLD_MINUTES: 'LATE_THRESHOLD_MINUTES',
  MIN_HALF_DAY_MINUTES: 'MIN_HALF_DAY_MINUTES',
} as const;

/** Resource types that can be exported as CSV/XLSX. */
export const EXPORT_TYPES = {
  BOOKINGS: 'bookings',
  WORK_ORDERS: 'work-orders',
  ATTENDANCE: 'attendance',
  OVERTIME: 'overtime',
  LEAVE: 'leave',
  SERVICE_REPORTS: 'service-reports',
  ENQUIRIES: 'enquiries',
  CUSTOMERS: 'customers',
} as const;

export type ExportType = (typeof EXPORT_TYPES)[keyof typeof EXPORT_TYPES];

/** Maximum number of rows written into a single export file. */
export const EXPORT_MAX_ROWS = 50_000;

/** Default number of rows written into a single export file. */
export const EXPORT_DEFAULT_ROWS = 1_000;

/** How long a generated export file is kept on disk before cleanup (hours). */
export const EXPORT_RETENTION_HOURS = 24;

/** Storage directory (relative to EXPORT_STORAGE_DIR) for generated files. */
export const EXPORT_STORAGE_DIRNAME = 'exports';

export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  MAINTENANCE: 'maintenance',
  REPORTS: 'reports',
  EXPORTS: 'exports',
  CLEANUP: 'cleanup',
} as const;

export const JOB_NAMES = {
  SEND_PUSH: 'send-push',
  MAINTENANCE_REMINDER: 'maintenance-reminder',
  EXPORT_BUILD: 'export-build',
  TOKEN_CLEANUP: 'token-cleanup',
  NOTIFICATION_CLEANUP: 'notification-cleanup',
  PENDING_WORK_CHECK: 'pending-work-check',
} as const;
