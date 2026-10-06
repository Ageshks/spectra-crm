import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus, LeaveStatus, NotificationType, Prisma, Role } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { AuthUser } from '../../common/types/auth.types';
import { startOfDayInTz } from '../../common/utils/date.util';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateLeaveDto, LeaveDecisionDto, ListLeaveDto } from './dto/leave.dto';

const leaveInclude = {
  employee: {
    select: {
      id: true,
      employeeNo: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.LeaveInclude;

@Injectable()
export class LeaveService {
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

  async apply(dto: CreateLeaveDto, actor: AuthUser): Promise<unknown> {
    const employeeId = await this.resolveEmployeeId(actor, dto.employeeId);
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid leave dates');
    }
    if (end < start) {
      throw new BadRequestException('endDate cannot be before startDate');
    }
    const overlap = await this.prisma.leave.findFirst({
      where: {
        employeeId,
        status: { not: LeaveStatus.REJECTED },
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });
    if (overlap) {
      throw new BadRequestException('A leave request already covers this period');
    }
    const created = await this.prisma.leave.create({
      data: {
        employeeId,
        leaveType: dto.leaveType,
        startDate: start,
        endDate: end,
        reason: dto.reason,
        status: LeaveStatus.PENDING,
      },
      include: leaveInclude,
    });
    await this.audit.log({
      action: 'APPLY_LEAVE', module: 'leave',
      entity: 'Leave', entityId: created.id, userId: actor.id,
    });
    const managers = await this.prisma.user.findMany({
      where: { role: { in: [Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN] }, isActive: true },
      select: { id: true },
    });
    await this.notifications.notifyMany(
      managers.map((m) => ({
        userId: m.id,
        title: 'New leave request',
        message: `A leave request (${dto.leaveType}) needs approval`,
        type: NotificationType.LEAVE_DECISION,
        referenceType: 'leave',
        referenceId: created.id,
      })),
    );
    return created;
  }

  async list(query: ListLeaveDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const and: Prisma.LeaveWhereInput[] = [];
    if (actor.role === Role.EMPLOYEE) {
      and.push({ employeeId: await this.attendance.resolveEmployeeId(actor) });
    } else if (query.employeeId) {
      and.push({ employeeId: query.employeeId });
    }
    if (query.status) and.push({ status: query.status });
    if (query.leaveType) and.push({ leaveType: query.leaveType });
    const where: Prisma.LeaveWhereInput = {
      ...(and.length ? { AND: and } : {}),
      ...(search ? { reason: { contains: search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.leave.findMany({
        where, skip, take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['startDate', 'createdAt', 'status']),
        include: leaveInclude,
      }),
      this.prisma.leave.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string, actor: AuthUser): Promise<unknown> {
    const record = await this.prisma.leave.findUnique({ where: { id }, include: leaveInclude });
    if (!record) throw new NotFoundException('Leave request not found');
    if (actor.role === Role.EMPLOYEE) {
      const employeeId = await this.attendance.resolveEmployeeId(actor);
      if (record.employeeId !== employeeId) {
        throw new ForbiddenException('You cannot access another employee record');
      }
    }
    return record;
  }

  async decide(id: string, dto: LeaveDecisionDto, actor: AuthUser): Promise<unknown> {
    const record = await this.prisma.leave.findUnique({
      where: { id },
      include: { employee: { include: { user: { select: { id: true } } } } },
    });
    if (!record) throw new NotFoundException('Leave request not found');
    if (record.status !== LeaveStatus.PENDING) {
      throw new BadRequestException(`Leave is already ${record.status}`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.leave.update({
        where: { id },
        data: { status: dto.decision, approvedById: actor.id, approvedAt: new Date() },
        include: leaveInclude,
      });
      if (dto.decision === LeaveStatus.APPROVED) {
        const day = new Date(record.startDate);
        for (; day <= record.endDate; day.setDate(day.getDate() + 1)) {
          const dateOnly = startOfDayInTz(day);
          await tx.attendance.upsert({
            where: { employeeId_date: { employeeId: record.employeeId, date: dateOnly } },
            create: {
              employeeId: record.employeeId,
              date: dateOnly,
              status: AttendanceStatus.LEAVE,
            },
            update: { status: AttendanceStatus.LEAVE },
          });
        }
      }
      return saved;
    });
    await this.audit.log({
      action: dto.decision === LeaveStatus.APPROVED ? 'APPROVE_LEAVE' : 'REJECT_LEAVE',
      module: 'leave', entity: 'Leave', entityId: id, userId: actor.id,
    });
    await this.notifications.notify({
      userId: record.employee.user.id,
      title: `Leave ${dto.decision.toLowerCase()}`,
      message: `Your leave request was ${dto.decision.toLowerCase()}`,
      type: NotificationType.LEAVE_DECISION,
      referenceType: 'leave', referenceId: id,
    });
    return updated;
  }
}
