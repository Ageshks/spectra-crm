/** Time helpers working in the application timezone (default Asia/Kolkata). */

export const TIMEZONE = (): string => process.env.APP_TIMEZONE || 'Asia/Kolkata';

export const timeToMinutes = (time: string): number => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export const minutesToTime = (total: number): string => {
  const clamped = Math.max(0, total);
  const hours = Math.floor(clamped / 60) % 24;
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

/** Local calendar date (YYYY-MM-DD) for "now" in the configured timezone. */
export const todayDateString = (date: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

/** Midnight (local app timezone) of the given day as a UTC instant. */
export const startOfDayInTz = (date: Date = new Date()): Date => {
  const ymd = todayDateString(date);
  const [year, month, day] = ymd.split('-').map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  // Offset of the timezone at that instant (minutes east of UTC).
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(guess);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  const offsetMs = asUtc - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
};

export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};
