import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, OvertimePaymentStatus, OvertimeStatus, Prisma, Role, WorkAssignmentStatus } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { AuditService } from '../../common/audit/audit.module';
import { AuthUser } from '../../common/types/auth.types';
import { timeOfDayInTz, todayDateString } from '../../common/utils/date.util';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateOvertimeDto,
  ListOvertimeDto,
  OvertimeDecisionDto,
  RecordOvertimePaymentDto,
} from './dto/overtime.dto';

const overtimeInclude = {
  employee: {
    select: {
      id: true,
      companyId: true,
      employeeNo: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  manager: {
    select: {
      id: true,
      companyId: true,
      title: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.OvertimeInclude;

const STANDARD_SHIFT_MINUTES = 8 * 60 + 30;
type OvertimeOwner = { employeeId: string; managerId?: never } | { managerId: string; employeeId?: never };

@Injectable()
export class OvertimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly notifications: NotificationsService,
  ) {}

  private async resolveOwner(actor: AuthUser, employeeOverride?: string): Promise<OvertimeOwner> {
    if (actor.role === Role.EMPLOYEE) {
      return { employeeId: await this.attendance.resolveEmployeeId(actor) };
    }
    if (actor.role === Role.MANAGER) {
      return { managerId: await this.attendance.resolveManagerId(actor) };
    }
    if (employeeOverride) return { employeeId: employeeOverride };
    throw new BadRequestException('employeeId is required');
  }

  private async ownerCompanyId(owner: OvertimeOwner): Promise<string | null> {
    if (owner.employeeId) {
      return (await this.prisma.employee.findUnique({
        where: { id: owner.employeeId },
        select: { companyId: true },
      }))?.companyId ?? null;
    }
    return (await this.prisma.manager.findUnique({
      where: { id: owner.managerId },
      select: { companyId: true },
    }))?.companyId ?? null;
  }

  private async hasOngoingWork(owner: OvertimeOwner): Promise<boolean> {
    if (owner.employeeId) {
      return !!await this.prisma.workAssignment.findFirst({
        where: { employeeId: owner.employeeId, status: WorkAssignmentStatus.IN_PROGRESS },
        select: { id: true },
      });
    }
    return !!await this.prisma.workOrder.findFirst({
      where: { managerId: owner.managerId, status: 'IN_PROGRESS' },
      select: { id: true },
    });
  }

  async request(dto: CreateOvertimeDto, actor: AuthUser): Promise<unknown> {
    const owner = await this.resolveOwner(actor, dto.employeeId);
    const companyId = await this.ownerCompanyId(owner);
    if (!companyId || (actor.role !== Role.SUPER_ADMIN && companyId !== actor.companyId)) {
      throw new ForbiddenException('Staff member is outside your company');
    }
    const probe = new Date(`${dto.date}T00:00:00`);
    if (Number.isNaN(probe.getTime())) throw new BadRequestException('Invalid date');

    const dayStart = new Date(`${dto.date}T00:00:00`);
    const dayEnd = new Date(`${dto.date}T23:59:59.999`);
    const record = await this.prisma.attendance.findFirst({
      where: { ...owner, date: { gte: dayStart, lte: dayEnd } },
    });
    if (!record?.checkInTime) {
      throw new BadRequestException('Overtime requires an attendance check-in for that day');
    }
    const ongoingWork = await this.hasOngoingWork(owner);
    const autoCheckedOut = !!record.checkOutTime && record.workingMinutes === STANDARD_SHIFT_MINUTES && ongoingWork;
    if (!ongoingWork) {
      throw new BadRequestException('You can request overtime during an active shift only while you have work in progress');
    }
    const endTime = record.checkOutTime ?? new Date();
    const elapsedMinutes = Math.floor(
      (endTime.getTime() - record.checkInTime.getTime()) / 60_000,
    );
    const requiredMinutes = STANDARD_SHIFT_MINUTES;
    if (autoCheckedOut) {
      if (!dto.requestedMinutes) {
        throw new BadRequestException('requestedMinutes is required when attendance was automatically checked out');
      }
    } else if (elapsedMinutes <= requiredMinutes) {
      throw new BadRequestException(
        'Overtime requires more than 8 hours 30 minutes from check-in, including the break',
      );
    }
    const durationMinutes = autoCheckedOut ? dto.requestedMinutes! : elapsedMinutes - requiredMinutes;
    const overtimeStart = new Date(record.checkInTime.getTime() + (autoCheckedOut ? STANDARD_SHIFT_MINUTES : requiredMinutes) * 60_000);
    const overtimeEnd = autoCheckedOut ? new Date(overtimeStart.getTime() + durationMinutes * 60_000) : endTime;
    const formatTime = (value: Date): string => timeOfDayInTz(value);

    const dup = await this.prisma.overtime.findFirst({
      where: { attendanceId: record.id, status: { not: OvertimeStatus.REJECTED } },
    });
    if (dup) throw new BadRequestException('An overtime entry already exists for this day');

    const created = await this.prisma.overtime.create({
      data: {
        ...owner,
        attendanceId: record.id,
        date: record.date,
        startTime: formatTime(overtimeStart),
        endTime: formatTime(overtimeEnd),
        durationMinutes,
        breakMinutes: 60,
        reason: dto.reason,
        status: OvertimeStatus.PENDING,
      },
      include: overtimeInclude,
    });
    await this.audit.log({
      action: 'REQUEST_OVERTIME', module: 'overtime',
      entity: 'Overtime', entityId: created.id, userId: actor.id,
      newValues: { durationMinutes, breakMinutes: 60 } as Prisma.InputJsonValue,
    });
    return created;
  }

  async eligibilityToday(actor: AuthUser): Promise<unknown> {
    const owner = await this.resolveOwner(actor);
    const today = todayDateString(new Date());
    const dayStart = new Date(`${today}T00:00:00`);
    const dayEnd = new Date(`${today}T23:59:59.999`);
    const [attendance, ongoingWork] = await Promise.all([
      this.prisma.attendance.findFirst({ where: { ...owner, date: { gte: dayStart, lte: dayEnd } } }),
      this.hasOngoingWork(owner),
    ]);
    const now = new Date();
    const eligibleAt = attendance?.checkInTime ? new Date(attendance.checkInTime.getTime() + STANDARD_SHIFT_MINUTES * 60_000) : null;
    const existing = attendance ? await this.prisma.overtime.findFirst({
      where: { attendanceId: attendance.id, status: { not: OvertimeStatus.REJECTED } },
      include: overtimeInclude,
    }) : null;
    const elapsedMinutes = attendance?.checkInTime
      ? attendance.checkOutTime
        ? attendance.workingMinutes ?? 0
        : Math.floor((now.getTime() - attendance.checkInTime.getTime()) / 60_000)
      : 0;
    const autoCheckedOut = !!attendance?.checkOutTime &&
      attendance.workingMinutes === STANDARD_SHIFT_MINUTES && ongoingWork;
    return {
      employeeId: owner.employeeId ?? null,
      managerId: owner.managerId ?? null,
      date: today,
      attendanceId: attendance?.id ?? null,
      checkInTime: attendance?.checkInTime ?? null,
      checkOutTime: attendance?.checkOutTime ?? null,
      eligibleAt,
      hasOngoingWork: ongoingWork,
      canApply: !!attendance?.checkInTime && !existing && now >= (eligibleAt ?? now) &&
        ongoingWork && (elapsedMinutes > STANDARD_SHIFT_MINUTES || autoCheckedOut),
      existingRequest: existing,
    };
  }

  /** Remind staff fifteen minutes before the standard shift threshold. */
  @Cron('* * * * *', { name: 'overtime-fifteen-minute-reminder', timeZone: 'Asia/Kolkata' })
  async remindBeforeOvertimeEligibility(): Promise<void> {
    const reminderCutoff = new Date(Date.now() - (STANDARD_SHIFT_MINUTES - 15) * 60_000);
    const previousMinuteCutoff = new Date(reminderCutoff.getTime() - 60_000);
    const attendances = await this.prisma.attendance.findMany({
      where: {
        OR: [{ employeeId: { not: null } }, { managerId: { not: null } }],
        checkInTime: { gt: previousMinuteCutoff, lte: reminderCutoff },
        checkOutTime: null,
      },
      select: {
        id: true,
        employeeId: true,
        managerId: true,
        employee: {
          select: {
            userId: true,
            assignments: {
              where: { status: WorkAssignmentStatus.IN_PROGRESS },
              select: { id: true },
              take: 1,
            },
          },
        },
        manager: {
          select: {
            userId: true,
            workOrders: {
              where: { status: 'IN_PROGRESS' },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
      take: 500,
    });

    for (const attendance of attendances) {
      const owner = attendance.employeeId
        ? { employeeId: attendance.employeeId }
        : attendance.managerId
          ? { managerId: attendance.managerId }
          : null;
      const userId = attendance.employee?.userId ?? attendance.manager?.userId;
      const hasOngoingWork = attendance.employee
        ? attendance.employee.assignments.length > 0
        : (attendance.manager?.workOrders.length ?? 0) > 0;
      if (!owner || !userId || !hasOngoingWork) continue;
      const existingOvertime = await this.prisma.overtime.findFirst({
        where: {
          attendanceId: attendance.id,
          status: { not: OvertimeStatus.REJECTED },
        },
        select: { id: true },
      });
      if (existingOvertime) continue;

      const existingReminder = await this.prisma.notification.findFirst({
        where: {
          userId,
          type: NotificationType.OVERTIME_REMINDER,
          referenceId: attendance.id,
        },
        select: { id: true },
      });
      if (existingReminder) continue;

      await this.notifications.notify({
        userId,
        title: 'Overtime application reminder',
        message: 'Your 8 hours 30 minutes shift threshold is 15 minutes away. If work is still in progress at the threshold, you can submit an overtime request from your work profile.',
        type: NotificationType.OVERTIME_REMINDER,
        referenceType: 'overtime_reminder',
        referenceId: attendance.id,
      });
    }
  }

  /** Automatically check out employees after their standard shift and notify them once. */
  @Cron('* * * * *', { name: 'attendance-eight-and-a-half-hour-auto-checkout', timeZone: 'Asia/Kolkata' })
  async autoCheckoutAfterStandardShift(): Promise<void> {
    const threshold = new Date(Date.now() - STANDARD_SHIFT_MINUTES * 60_000);
    const attendances = await this.prisma.attendance.findMany({
      where: {
        OR: [{ employeeId: { not: null } }, { managerId: { not: null } }],
        checkInTime: { lte: threshold },
        checkOutTime: null,
      },
      select: {
        id: true,
        employeeId: true,
        managerId: true,
        checkInTime: true,
        employee: {
          select: {
            userId: true,
            assignments: {
              where: { status: WorkAssignmentStatus.IN_PROGRESS },
              select: { id: true },
              take: 1,
            },
          },
        },
        manager: {
          select: {
            userId: true,
            workOrders: { where: { status: 'IN_PROGRESS' }, select: { id: true }, take: 1 },
          },
        },
      },
      take: 500,
    });
    for (const attendance of attendances) {
      const userId = attendance.employee?.userId ?? attendance.manager?.userId;
      if (!userId || !attendance.checkInTime) continue;
      const checkOutTime = new Date(attendance.checkInTime!.getTime() + STANDARD_SHIFT_MINUTES * 60_000);
      const updated = await this.prisma.attendance.updateMany({
        where: { id: attendance.id, checkOutTime: null },
        data: { checkOutTime, workingMinutes: STANDARD_SHIFT_MINUTES },
      });
      if (updated.count === 0) continue;
      const hasOngoingWork = attendance.employee
        ? attendance.employee.assignments.length > 0
        : (attendance.manager?.workOrders.length ?? 0) > 0;
      await this.notifications.notify({
        userId,
        title: 'Attendance automatically checked out',
        message: hasOngoingWork
          ? 'Your attendance was checked out after 8 hours 30 minutes. Work is still in progress; request overtime approval from your work profile.'
          : 'Your attendance was checked out automatically after 8 hours 30 minutes.',
        type: NotificationType.ATTENDANCE_AUTO_CHECKOUT,
        referenceType: hasOngoingWork ? 'overtime_reminder' : 'attendance',
        referenceId: attendance.id,
      });
    }
  }

  async list(query: ListOvertimeDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const and: Prisma.OvertimeWhereInput[] = [];
    if (actor.role !== Role.SUPER_ADMIN) {
      and.push({
        OR: [
          { employee: { companyId: actor.companyId ?? '__none__' } },
          { manager: { companyId: actor.companyId ?? '__none__' } },
        ],
      });
    }
    if (actor.role === Role.EMPLOYEE) {
      and.push({ employeeId: await this.attendance.resolveEmployeeId(actor) });
    } else if (actor.role === Role.MANAGER) {
      const managerId = await this.attendance.resolveManagerId(actor);
      and.push({
        OR: [
          { managerId },
          { employee: { assignments: { some: { workOrder: { managerId } } } } },
        ],
      });
    } else if (query.employeeId) {
      and.push({ employeeId: query.employeeId });
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
    const where: Prisma.OvertimeWhereInput = {
      ...(and.length ? { AND: and } : {}),
      ...(search ? { reason: { contains: search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.overtime.findMany({
        where, skip, take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['date', 'createdAt', 'status']),
        include: overtimeInclude,
      }),
      this.prisma.overtime.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string, actor: AuthUser): Promise<unknown> {
    const record = await this.prisma.overtime.findUnique({ where: { id }, include: overtimeInclude });
    if (!record) throw new NotFoundException('Overtime record not found');
    if (actor.role === Role.EMPLOYEE) {
      const employeeId = await this.attendance.resolveEmployeeId(actor);
      if (record.employeeId !== employeeId) {
        throw new ForbiddenException('You cannot access another employee record');
      }
    }
    if (actor.role === Role.MANAGER) {
      const managerId = await this.attendance.resolveManagerId(actor);
      if (record.managerId !== managerId && !await this.isInManagerTeam(record.employeeId, managerId)) {
        throw new ForbiddenException('You are not authorized to access this overtime record');
      }
    }
    this.assertCompany(record, actor);
    return record;
  }

  async decide(id: string, dto: OvertimeDecisionDto, actor: AuthUser): Promise<unknown> {
    const record = await this.prisma.overtime.findUnique({
      where: { id },
      include: overtimeInclude,
    });
    if (!record) throw new NotFoundException('Overtime record not found');
    if (actor.role === Role.MANAGER) {
      const managerId = await this.attendance.resolveManagerId(actor);
      if (record.managerId === managerId || !await this.isInManagerTeam(record.employeeId, managerId)) {
        throw new ForbiddenException('You are not authorized to decide this overtime record');
      }
    }
    this.assertCompany(record, actor);
    if (record.status !== OvertimeStatus.PENDING) {
      throw new BadRequestException(`Overtime is already ${record.status}`);
    }
    const updated = await this.prisma.overtime.update({
      where: { id },
      data: { status: dto.decision, approvedById: actor.id, approvedAt: new Date() },
      include: overtimeInclude,
    });
    await this.audit.log({
      action: dto.decision === OvertimeStatus.APPROVED ? 'APPROVE_OVERTIME' : 'REJECT_OVERTIME',
      module: 'overtime', entity: 'Overtime', entityId: id, userId: actor.id,
    });
    const staffUserId = record.employee?.user.id ?? record.manager?.user.id;
    if (staffUserId) await this.notifications.notify({
      userId: staffUserId,
      title: `Overtime ${dto.decision.toLowerCase()}`,
      message: `Your overtime of ${record.durationMinutes} minutes on ${todayDateString(record.date)} was ${dto.decision.toLowerCase()}`,
      type: NotificationType.OVERTIME_DECISION,
      referenceType: 'overtime', referenceId: id,
    });
    return updated;
  }

  async recordPayment(
    id: string,
    dto: RecordOvertimePaymentDto,
    actor: AuthUser,
  ): Promise<unknown> {
    const record = await this.prisma.overtime.findUnique({
      where: { id },
      include: overtimeInclude,
    });
    if (!record) throw new NotFoundException('Overtime record not found');
    if (actor.role === Role.MANAGER && (!record.employeeId || !await this.isInManagerTeam(record.employeeId, actor.managerId))) {
      throw new ForbiddenException('You are not authorized to pay this overtime record');
    }
    this.assertCompany(record, actor);
    if (record.status !== OvertimeStatus.APPROVED) {
      throw new BadRequestException('Only approved overtime can be paid');
    }
    if (record.paymentStatus === OvertimePaymentStatus.PAID) {
      throw new BadRequestException('Payment has already been recorded');
    }

    const paidAt = new Date();
    const updated = await this.prisma.overtime.update({
      where: { id },
      data: {
        paymentAmount: new Prisma.Decimal(dto.amount.toFixed(2)),
        paymentStatus: OvertimePaymentStatus.PAID,
        paidAt,
        paymentReference: dto.paymentReference,
      },
      include: overtimeInclude,
    });
    await this.audit.log({
      action: 'RECORD_OVERTIME_PAYMENT',
      module: 'overtime',
      entity: 'Overtime',
      entityId: id,
      userId: actor.id,
      newValues: {
        paymentAmount: dto.amount.toFixed(2),
        paymentStatus: OvertimePaymentStatus.PAID,
        paidAt: paidAt.toISOString(),
        paymentReference: dto.paymentReference,
      } as Prisma.InputJsonValue,
    });
    const staffUserId = record.employee?.user.id ?? record.manager?.user.id;
    if (staffUserId) await this.notifications.notify({
      userId: staffUserId,
      title: 'Overtime payment recorded',
      message: `A payment of ₹${dto.amount.toFixed(2)} for your approved overtime on ${todayDateString(record.date)} has been recorded.`,
      type: NotificationType.OVERTIME_DECISION,
      referenceType: 'overtime',
      referenceId: id,
    });
    return updated;
  }

  private assertCompany(
    record: { employee: { companyId: string } | null; manager: { companyId: string } | null },
    actor: AuthUser,
  ): void {
    if (actor.role !== Role.SUPER_ADMIN &&
      (record.employee?.companyId ?? record.manager?.companyId) !== actor.companyId) {
      throw new ForbiddenException('Overtime is outside your company');
    }
  }

  private async isInManagerTeam(employeeId: string | null, managerId?: string): Promise<boolean> {
    if (!employeeId || !managerId) return false;
    const assignment = await this.prisma.workAssignment.findFirst({
      where: { employeeId, workOrder: { managerId } },
      select: { id: true },
    });
    return !!assignment;
  }
}
