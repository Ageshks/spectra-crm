import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { SettingsService } from '../../common/settings/settings.module';
import { AuthUser } from '../../common/types/auth.types';
import { SaveWorkingCalendarDto } from './working-calendar.dto';

const supportedYear = (year: number): void => {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException('year must be between 2000 and 2100');
  }
};

const settingKey = (year: number): string => `WORKING_CALENDAR_${year}`;
const DEFAULT_COMPANY_ID = '00000000-0000-4000-8000-000000000001';

const generalHolidaysFor = (year: number): WorkingCalendar['exceptions'] => {
  const fixed = [
    { date: `${year}-01-26`, title: 'Republic Day' },
    { date: `${year}-08-15`, title: 'Independence Day' },
    { date: `${year}-10-02`, title: "Mahatma Gandhi's Birthday" },
    { date: `${year}-12-25`, title: 'Christmas Day' },
  ];
  // India Post's All India Holidays list for 2026; lunar dates can vary by
  // region or later government notice, so admins can edit each calendar entry.
  const holidays2026 = [
    { date: '2026-01-26', title: 'Republic Day' },
    { date: '2026-03-21', title: 'Id-ul-Fitr' },
    { date: '2026-03-31', title: 'Mahavir Jayanti' },
    { date: '2026-04-03', title: 'Good Friday' },
    { date: '2026-05-01', title: 'Buddha Purnima' },
    { date: '2026-05-27', title: 'Id-ul-Zuha' },
    { date: '2026-06-26', title: 'Muharram' },
    { date: '2026-08-15', title: 'Independence Day' },
    { date: '2026-08-26', title: "Prophet Mohammad's Birthday" },
    { date: '2026-10-02', title: "Mahatma Gandhi's Birthday" },
    { date: '2026-10-20', title: 'Dussehra' },
    { date: '2026-11-08', title: 'Diwali' },
    { date: '2026-11-24', title: "Guru Nanak's Birthday" },
    { date: '2026-12-25', title: 'Christmas Day' },
  ];
  const source = year === 2026 ? holidays2026 : fixed;
  return source.map(({ date, title }) => ({ date, title, type: 'HOLIDAY' as const }));
};

export interface WorkingCalendar {
  year: number;
  startDate: string;
  endDate: string;
  workingWeekdays: number[];
  exceptions: Array<{
    date: string;
    type: 'HOLIDAY' | 'WORKING_DAY' | 'EVENT';
    title: string;
    note?: string;
  }>;
}

@Injectable()
export class WorkingCalendarService {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async get(year: number, companyId = DEFAULT_COMPANY_ID): Promise<WorkingCalendar> {
    supportedYear(year);
    const value = await this.settings.get(settingKey(year), companyId);
    if (value) {
      try {
        const parsed = JSON.parse(value) as WorkingCalendar;
        if (parsed.year === year && Array.isArray(parsed.workingWeekdays) && Array.isArray(parsed.exceptions)) {
          return parsed;
        }
      } catch {
        // Replace invalid persisted data with the safe default below.
      }
    }
    return {
      year,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      workingWeekdays: [1, 2, 3, 4, 5],
      exceptions: generalHolidaysFor(year),
    };
  }

  /**
   * Existing attendance remains available until an admin saves a calendar.
   * Once configured, date-specific holidays and working-day overrides take
   * precedence over the regular weekly pattern.
   */
  async isWorkingDate(date: string, companyId = DEFAULT_COMPANY_ID): Promise<boolean> {
    const year = Number(date.slice(0, 4));
    for (const calendarYear of [year, year - 1]) {
      const value = await this.settings.get(settingKey(calendarYear), companyId);
      if (!value) continue;
      let calendar: WorkingCalendar;
      try {
        calendar = JSON.parse(value) as WorkingCalendar;
      } catch {
        continue;
      }
      if (date < calendar.startDate || date > calendar.endDate) continue;
      const exception = calendar.exceptions.find((item) => item.date === date);
      if (exception?.type === 'HOLIDAY') return false;
      if (exception?.type === 'WORKING_DAY') return true;
      const jsDay = new Date(`${date}T00:00:00.000Z`).getUTCDay();
      const isoDay = jsDay === 0 ? 7 : jsDay;
      return calendar.workingWeekdays.includes(isoDay);
    }
    return true;
  }

  async save(year: number, dto: SaveWorkingCalendarDto, actor: AuthUser): Promise<WorkingCalendar> {
    supportedYear(year);
    if (!actor.companyId) throw new BadRequestException('Company context is required to save the working calendar');
    const startDate = this.dateOnly(dto.startDate);
    const endDate = this.dateOnly(dto.endDate);
    if (endDate < startDate) throw new BadRequestException('endDate cannot be before startDate');
    if (startDate.slice(0, 4) !== String(year)) {
      throw new BadRequestException('The calendar must start in the selected year');
    }
    if (Number(endDate.slice(0, 4)) > year + 1 ||
        new Date(`${endDate}T00:00:00.000Z`).getTime() - new Date(`${startDate}T00:00:00.000Z`).getTime() > 400 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('The calendar range cannot exceed 400 days');
    }
    const seen = new Set<string>();
    const exceptions = dto.exceptions.map((item) => {
      const date = this.dateOnly(item.date);
      if (date < startDate || date > endDate) {
        throw new BadRequestException(`Calendar date ${date} must be inside the calendar range`);
      }
      if (seen.has(date)) throw new BadRequestException(`Only one calendar entry is allowed for ${date}`);
      seen.add(date);
      const title = item.title.trim();
      if (!title) throw new BadRequestException('Calendar entry title cannot be empty');
      return {
        date,
        type: item.type,
        title,
        ...(item.note?.trim() ? { note: item.note.trim() } : {}),
      };
    }).sort((a, b) => a.date.localeCompare(b.date));

    const calendar: WorkingCalendar = {
      year,
      startDate,
      endDate,
      workingWeekdays: [...dto.workingWeekdays].sort((a, b) => a - b),
      exceptions,
    };
    const key = settingKey(year);
    const oldValue = await this.settings.get(key, actor.companyId);
    const serialized = JSON.stringify(calendar);
    await this.settings.set(key, serialized, `Working days and dates for ${year}`, actor.companyId);
    await this.audit.log({
      action: 'WORKING_CALENDAR_UPDATED',
      module: 'working-calendar',
      entity: 'Setting',
      entityId: key,
      userId: actor.id,
      ...(oldValue ? { oldValues: { calendar: JSON.parse(oldValue) } } : {}),
      newValues: { calendar } as unknown as Prisma.InputJsonValue,
    });
    return calendar;
  }

  private dateOnly(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Calendar date is invalid');
    const day = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) !== day) {
      throw new BadRequestException('Calendar date must be a valid YYYY-MM-DD date');
    }
    return day;
  }
}
