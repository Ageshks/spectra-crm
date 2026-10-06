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
