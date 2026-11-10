import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, OvertimePaymentStatus, OvertimeStatus, Prisma, Role } from '@prisma/client';
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
      employeeNo: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.OvertimeInclude;

@Injectable()
export class OvertimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly notifications: NotificationsService,
  ) {}

  private async resolveEmployeeId(actor: AuthUser, override?: string): Promise<string> {
    if (actor.role === Role.EMPLOYEE) {
      return this.attendance.resolveEmployeeId(actor);
    }
    if (override) return override;
    throw new BadRequestException('employeeId is required');
  }

  async request(dto: CreateOvertimeDto, actor: AuthUser): Promise<unknown> {
    const employeeId = await this.resolveEmployeeId(actor, dto.employeeId);
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { companyId: true } });
    if (!employee || (actor.role !== Role.SUPER_ADMIN && employee.companyId !== actor.companyId)) throw new ForbiddenException('Employee is outside your company');
    const probe = new Date(`${dto.date}T00:00:00`);
    if (Number.isNaN(probe.getTime())) throw new BadRequestException('Invalid date');

    const dayStart = new Date(`${dto.date}T00:00:00`);
    const dayEnd = new Date(`${dto.date}T23:59:59.999`);
    const record = await this.prisma.attendance.findFirst({
      where: { employeeId, date: { gte: dayStart, lte: dayEnd } },
    });
    if (!record?.checkInTime || !record.checkOutTime) {
      throw new BadRequestException('Overtime requires a completed attendance record for that day');
    }
    const elapsedMinutes = Math.floor(
      (record.checkOutTime.getTime() - record.checkInTime.getTime()) / 60_000,
    );
    const requiredMinutes = 8 * 60 + dto.breakMinutes;
    if (elapsedMinutes <= requiredMinutes) {
      throw new BadRequestException(
        `Overtime requires more than 8 working hours${dto.breakMinutes ? ' plus the 60-minute break' : ''} after check-in`,
      );
    }
    const durationMinutes = elapsedMinutes - requiredMinutes;
    const overtimeStart = new Date(record.checkInTime.getTime() + requiredMinutes * 60_000);
    const formatTime = (value: Date): string => timeOfDayInTz(value);

    const dup = await this.prisma.overtime.findFirst({
      where: { employeeId, date: { gte: dayStart, lte: dayEnd }, status: { not: OvertimeStatus.REJECTED } },
    });
    if (dup) throw new BadRequestException('An overtime entry already exists for this day');

    const created = await this.prisma.overtime.create({
      data: {
        employeeId,
        attendanceId: record.id,
        date: record.date,
        startTime: formatTime(overtimeStart),
        endTime: formatTime(record.checkOutTime),
        durationMinutes,
        breakMinutes: dto.breakMinutes,
        reason: dto.reason,
        status: OvertimeStatus.PENDING,
      },
      include: overtimeInclude,
    });
    await this.audit.log({
      action: 'REQUEST_OVERTIME', module: 'overtime',
      entity: 'Overtime', entityId: created.id, userId: actor.id,
      newValues: { durationMinutes, breakMinutes: dto.breakMinutes } as Prisma.InputJsonValue,
    });
    return created;
  }

  async list(query: ListOvertimeDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const and: Prisma.OvertimeWhereInput[] = [];
    if (actor.role !== Role.SUPER_ADMIN) and.push({ employee: { companyId: actor.companyId ?? '__none__' } });
    if (actor.role === Role.EMPLOYEE) {
      and.push({ employeeId: await this.attendance.resolveEmployeeId(actor) });
    } else if (query.employeeId) {
      and.push({ employeeId: query.employeeId });
    }
    if (actor.role === Role.MANAGER) {
      and.push({ employee: { assignments: { some: { workOrder: { managerId: actor.managerId ?? '__none__' } } } } });
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
    if (actor.role === Role.MANAGER && !await this.isInManagerTeam(record.employeeId, actor.managerId)) {
      throw new ForbiddenException('You are not authorized to access this overtime record');
    }
    if (actor.role !== Role.SUPER_ADMIN && (await this.prisma.employee.findUnique({ where: { id: record.employeeId }, select: { companyId: true } }))?.companyId !== actor.companyId) throw new ForbiddenException('Overtime is outside your company');
    return record;
  }

  async decide(id: string, dto: OvertimeDecisionDto, actor: AuthUser): Promise<unknown> {
    const record = await this.prisma.overtime.findUnique({
      where: { id },
      include: { employee: { include: { user: { select: { id: true } } } } },
    });
    if (!record) throw new NotFoundException('Overtime record not found');
    if (actor.role === Role.MANAGER && !await this.isInManagerTeam(record.employeeId, actor.managerId)) {
      throw new ForbiddenException('You are not authorized to decide this overtime record');
    }
    if (actor.role !== Role.SUPER_ADMIN && (await this.prisma.employee.findUnique({ where: { id: record.employeeId }, select: { companyId: true } }))?.companyId !== actor.companyId) throw new ForbiddenException('Overtime is outside your company');
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
    await this.notifications.notify({
      userId: record.employee.user.id,
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
      include: { employee: { include: { user: { select: { id: true } } } } },
    });
    if (!record) throw new NotFoundException('Overtime record not found');
    if (actor.role === Role.MANAGER && !await this.isInManagerTeam(record.employeeId, actor.managerId)) {
      throw new ForbiddenException('You are not authorized to pay this overtime record');
    }
    if (actor.role !== Role.SUPER_ADMIN && (await this.prisma.employee.findUnique({ where: { id: record.employeeId }, select: { companyId: true } }))?.companyId !== actor.companyId) throw new ForbiddenException('Overtime is outside your company');
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
    await this.notifications.notify({
      userId: record.employee.user.id,
      title: 'Overtime payment recorded',
      message: `A payment of ₹${dto.amount.toFixed(2)} for your approved overtime on ${todayDateString(record.date)} has been recorded.`,
      type: NotificationType.OVERTIME_DECISION,
      referenceType: 'overtime',
      referenceId: id,
    });
    return updated;
  }

  private async isInManagerTeam(employeeId: string, managerId?: string): Promise<boolean> {
    if (!managerId) return false;
    const assignment = await this.prisma.workAssignment.findFirst({
      where: { employeeId, workOrder: { managerId } },
      select: { id: true },
    });
    return !!assignment;
  }
}
