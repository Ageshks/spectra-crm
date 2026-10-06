import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus, Prisma, Role } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { SETTING_KEYS } from '../../common/constants';
import { SettingsService } from '../../common/settings/settings.module';
import { AuthUser } from '../../common/types/auth.types';
import { timeToMinutes, todayDateString } from '../../common/utils/date.util';
import { isValidCoordinate } from '../../common/utils/geo.util';
import {
  normalizePagination,
  paginated,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { CheckInDto, CheckOutDto, ListAttendanceDto } from './dto/attendance.dto';

export const attendanceInclude = {
  employee: {
    select: {
      id: true,
      employeeNo: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  manager: {
    select: {
      id: true,
      title: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.AttendanceInclude;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async resolveEmployeeId(actor: AuthUser): Promise<string> {
    if (actor.employeeId) return actor.employeeId;
    const employee = await this.prisma.employee.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    });
    if (!employee) throw new ForbiddenException('Employee profile not found');
    return employee.id;
  }

  private async resolveStaff(actor: AuthUser): Promise<{ employeeId: string } | { managerId: string }> {
    if (actor.role === Role.EMPLOYEE) {
      return { employeeId: await this.resolveEmployeeId(actor) };
    }
    if (actor.role === Role.MANAGER) {
      const manager = await this.prisma.manager.findUnique({
        where: { userId: actor.id },
        select: { id: true },
      });
      if (!manager) throw new ForbiddenException('Manager profile not found');
      return { managerId: manager.id };
    }
    throw new ForbiddenException('Staff profile not found');
  }

  async checkIn(dto: CheckInDto, actor: AuthUser): Promise<unknown> {
    const staff = await this.resolveStaff(actor);
    const gpsEnabled = await this.settings.getBoolean(SETTING_KEYS.GPS_ATTENDANCE_ENABLED, false);
    if (gpsEnabled && !isValidCoordinate(dto.latitude, dto.longitude)) {
      throw new BadRequestException('Valid latitude and longitude are required');
    }
    const now = new Date(); // server timestamp — never trust client time
    const today = new Date(todayDateString(now));
    const existing = await this.prisma.attendance.findUnique({
      where: 'employeeId' in staff
        ? { employeeId_date: { employeeId: staff.employeeId, date: today } }
        : { managerId_date: { managerId: staff.managerId, date: today } },
    });
    if (existing?.checkInTime) {
      throw new BadRequestException('You have already checked in today');
    }
    const workStart = (await this.settings.getString(SETTING_KEYS.WORK_START_TIME)) ?? '09:00';
    const lateThreshold = await this.settings.getNumber(SETTING_KEYS.LATE_THRESHOLD_MINUTES, 15);
    const lateCutoff = timeToMinutes(workStart) + lateThreshold;
    const mins = now.getHours() * 60 + now.getMinutes();
    const status = mins > lateCutoff ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
    const base = {
      checkInTime: now,
      checkInLatitude: dto.latitude,
      checkInLongitude: dto.longitude,
      status,
    };
    const record = existing
      ? await this.prisma.attendance.update({
        where: { id: existing.id }, data: base, include: attendanceInclude,
        })
      : await this.prisma.attendance.create({
          data: { ...staff, date: today, ...base }, include: attendanceInclude,
        });
    await this.audit.log({
      action: 'ATTENDANCE_CHECK_IN', module: 'attendance',
      entity: 'Attendance', entityId: record.id, userId: actor.id,
    });
    return record;
  }

  async checkOut(dto: CheckOutDto, actor: AuthUser): Promise<unknown> {
    const staff = await this.resolveStaff(actor);
    const gpsEnabled = await this.settings.getBoolean(SETTING_KEYS.GPS_ATTENDANCE_ENABLED, false);
    if (gpsEnabled && !isValidCoordinate(dto.latitude, dto.longitude)) {
      throw new BadRequestException('Valid latitude and longitude are required');
    }
    const now = new Date();
    const today = new Date(todayDateString(now));
    const record = await this.prisma.attendance.findUnique({
      where: 'employeeId' in staff
        ? { employeeId_date: { employeeId: staff.employeeId, date: today } }
        : { managerId_date: { managerId: staff.managerId, date: today } },
    });
    if (!record?.checkInTime) {
      throw new BadRequestException('No active check-in found for today');
    }
    if (record.checkOutTime) {
      throw new BadRequestException('You have already checked out today');
    }
    if (now.getTime() < record.checkInTime.getTime()) {
      throw new BadRequestException('Check-out cannot be before check-in');
    }
    const workingMinutes = Math.floor((now.getTime() - record.checkInTime.getTime()) / 60000);
    const minHalfDay = await this.settings.getNumber(SETTING_KEYS.MIN_HALF_DAY_MINUTES, 240);
    const status = workingMinutes < minHalfDay ? AttendanceStatus.HALF_DAY : record.status;
    const updated = await this.prisma.attendance.update({
      where: { id: record.id },
      data: {
        checkOutTime: now, checkOutLatitude: dto.latitude, checkOutLongitude: dto.longitude,
        workingMinutes, status,
      },
      include: attendanceInclude,
    });
    await this.audit.log({
      action: 'ATTENDANCE_CHECK_OUT', module: 'attendance',
      entity: 'Attendance', entityId: record.id, userId: actor.id,
      newValues: { workingMinutes } as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async today(actor: AuthUser): Promise<unknown> {
    const staff = await this.resolveStaff(actor);
    const today = new Date(todayDateString(new Date()));
    return this.prisma.attendance.findUnique({
      where: 'employeeId' in staff
        ? { employeeId_date: { employeeId: staff.employeeId, date: today } }
        : { managerId_date: { managerId: staff.managerId, date: today } },
      include: attendanceInclude,
    });
  }

  async list(query: ListAttendanceDto, actor: AuthUser) {
    const { skip, take, page, limit, sortBy, sortOrder } = normalizePagination(query);
    const and: Prisma.AttendanceWhereInput[] = [];
    if (actor.role === Role.EMPLOYEE || actor.role === Role.MANAGER) {
      and.push(await this.resolveStaff(actor));
    } else {
      if (query.employeeId) and.push({ employeeId: query.employeeId });
      if (query.managerId) and.push({ managerId: query.managerId });
    }
    if (query.status) and.push({ status: query.status });
    if (query.dateFrom || query.dateTo) {
      and.push({
        date: {
          ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
        },
      });
    }
    const where: Prisma.AttendanceWhereInput = and.length ? { AND: and } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({
        where, skip, take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['date', 'createdAt', 'status']),
        include: attendanceInclude,
      }),
      this.prisma.attendance.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string, actor: AuthUser): Promise<unknown> {
    const record = await this.prisma.attendance.findUnique({ where: { id }, include: attendanceInclude });
    if (!record) throw new NotFoundException('Attendance record not found');
    if (actor.role === Role.EMPLOYEE || actor.role === Role.MANAGER) {
      const staff = await this.resolveStaff(actor);
      const ownerId = 'employeeId' in staff ? record.employeeId : record.managerId;
      const staffId = 'employeeId' in staff ? staff.employeeId : staff.managerId;
      if (ownerId !== staffId) throw new ForbiddenException('You cannot access another staff attendance record');
    }
    return record;
  }
}
