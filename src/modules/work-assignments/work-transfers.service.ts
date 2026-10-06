import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, Prisma, Role, WorkAssignmentStatus, WorkTransferStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { NotificationsService } from '../notifications/notifications.service';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser } from '../../common/types/auth.types';
import { CreateTransferDto, ListTransfersDto, TransferDecisionDto } from './dto/work-assignments.dto';

const transferInclude = {
  fromEmployee: {
    select: { id: true, employeeNo: true, user: { select: { id: true, firstName: true, lastName: true } } },
  },
  toEmployee: {
    select: { id: true, employeeNo: true, user: { select: { id: true, firstName: true, lastName: true } } },
  },
  requestedBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  workOrder: { select: { id: true, workOrderNumber: true, status: true, managerId: true } },
} satisfies Prisma.WorkTransferInclude;

@Injectable()
export class WorkTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * An employee requests a transfer of an assigned job. Employees can never
   * reject work directly — they can only ask a manager to move it.
   */
  async request(dto: CreateTransferDto, actor: AuthUser): Promise<unknown> {
    if (actor.role !== Role.EMPLOYEE || !actor.employeeId) {
      throw new ForbiddenException('Only employees can request a work transfer');
    }

    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id: dto.workOrderId },
      include: { manager: true },
    });
    if (!workOrder) throw new NotFoundException('Work order not found');

    const assignment = await this.prisma.workAssignment.findFirst({
      where: {
        workOrderId: workOrder.id,
        employeeId: actor.employeeId,
        status: { in: [WorkAssignmentStatus.ASSIGNED, WorkAssignmentStatus.ACCEPTED, WorkAssignmentStatus.IN_PROGRESS] },
      },
    });
    if (!assignment) {
      throw new ForbiddenException('You are not currently assigned to this work order');
    }

    if (dto.toEmployeeId === actor.employeeId) {
      throw new BadRequestException('You cannot transfer work to yourself');
    }
    const target = await this.prisma.employee.findUnique({
      where: { id: dto.toEmployeeId },
      include: { user: { select: { isActive: true } } },
    });
    if (!target || !target.user.isActive) {
      throw new BadRequestException('Target employee is unavailable');
    }

    const pending = await this.prisma.workTransfer.findFirst({
      where: { workOrderId: workOrder.id, fromEmployeeId: actor.employeeId, status: WorkTransferStatus.PENDING },
    });
    if (pending) {
      throw new BadRequestException('You already have a pending transfer request for this work order');
    }

    const transfer = await this.prisma.workTransfer.create({
      data: {
        workOrderId: workOrder.id,
        fromEmployeeId: actor.employeeId,
        toEmployeeId: dto.toEmployeeId,
        requestedById: actor.id,
        reason: dto.reason,
        note: dto.note,
        status: WorkTransferStatus.PENDING,
      },
      include: transferInclude,
    });

    await this.audit.log({
      action: 'REQUEST_TRANSFER',
      module: 'work-assignments',
      entity: 'WorkTransfer',
      entityId: transfer.id,
      userId: actor.id,
      newValues: {
        workOrderId: workOrder.id,
        fromEmployeeId: actor.employeeId,
        toEmployeeId: dto.toEmployeeId,
        reason: dto.reason,
      },
    });

    const managerIds = await this.prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: [Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN] },
        ...(workOrder.manager?.userId ? { id: workOrder.manager.userId } : {}),
      },
      select: { id: true },
    });
    await this.notifications.notifyMany(
      managerIds.map((m) => ({
        userId: m.id,
        title: 'Transfer request',
        message: `Transfer requested for ${workOrder.workOrderNumber}: ${dto.reason}`,
        type: NotificationType.WORK_TRANSFER_REQUESTED,
        referenceType: 'workTransfer',
        referenceId: transfer.id,
      })),
    );

    return transfer;
  }

  /** Managers/admins approve or reject transfers — employees cannot self-approve (rule #6). */
  async decide(id: string, dto: TransferDecisionDto, actor: AuthUser): Promise<unknown> {
    const transfer = await this.prisma.workTransfer.findUnique({
      where: { id },
      include: { ...transferInclude, workOrder: { include: { manager: true } } },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== WorkTransferStatus.PENDING) {
      throw new BadRequestException(`Transfer is already ${transfer.status}`);
    }

    if (dto.decision === WorkTransferStatus.REJECTED) {
      const rejected = await this.prisma.workTransfer.update({
        where: { id },
        data: { status: WorkTransferStatus.REJECTED, approvedById: actor.id, approvedAt: new Date() },
        include: transferInclude,
      });
      await this.audit.log({
        action: 'REJECT_TRANSFER',
        module: 'work-assignments',
        entity: 'WorkTransfer',
        entityId: id,
        userId: actor.id,
        oldValues: { status: WorkTransferStatus.PENDING },
        newValues: { status: WorkTransferStatus.REJECTED, note: dto.note },
      });
      await this.notifyDecision(transfer, actor, false, dto.note);
      return rejected;
    }

    // Approve: move the assignment to the target employee atomically.
    const assignment = await this.prisma.workAssignment.findFirst({
      where: { workOrderId: transfer.workOrderId, employeeId: transfer.fromEmployeeId },
    });
    if (!assignment) {
      throw new BadRequestException('Original assignment no longer exists');
    }
    const targetAlready = await this.prisma.workAssignment.findFirst({
      where: { workOrderId: transfer.workOrderId, employeeId: transfer.toEmployeeId },
    });
    if (targetAlready) {
      throw new BadRequestException('Target employee is already assigned to this work order');
    }

    const [approved] = await this.prisma.$transaction([
      this.prisma.workTransfer.update({
        where: { id },
        data: {
          status: WorkTransferStatus.APPROVED,
          approvedById: actor.id,
          approvedAt: new Date(),
          note: dto.note ? `${transfer.note ?? ''}\nDecision: ${dto.note}`.trim() : transfer.note,
        },
        include: transferInclude,
      }),
      this.prisma.workAssignment.update({
        where: { id: assignment.id },
        data: {
          employeeId: transfer.toEmployeeId,
          status: WorkAssignmentStatus.ASSIGNED,
          acceptedAt: null,
          startedAt: null,
          completedAt: null,
          assignedAt: new Date(),
        },
      }),
    ]);

    await this.audit.log({
      action: 'APPROVE_TRANSFER',
      module: 'work-assignments',
      entity: 'WorkTransfer',
      entityId: id,
      userId: actor.id,
      oldValues: { status: WorkTransferStatus.PENDING, employeeId: transfer.fromEmployeeId },
      newValues: { status: WorkTransferStatus.APPROVED, employeeId: transfer.toEmployeeId },
    });
    await this.notifyDecision(transfer, actor, true, dto.note);
    return approved;
  }

  private async notifyDecision(
    transfer: {
      workOrder: { id: string; workOrderNumber: string };
      fromEmployee: { user: { id: string } };
      toEmployee: { user: { id: string } };
    },
    actor: AuthUser,
    approved: boolean,
    note?: string,
  ): Promise<void> {
    const decision = approved ? 'approved' : 'rejected';
    await this.notifications.notifyMany([
      {
        userId: transfer.fromEmployee.user.id,
        title: `Transfer ${decision}`,
        message: `Your transfer request for ${transfer.workOrder.workOrderNumber} was ${decision}${note ? ` — ${note}` : ''}`,
        type: NotificationType.WORK_TRANSFER_DECISION,
        referenceType: 'workOrder',
        referenceId: transfer.workOrder.id,
      },
      ...(approved
        ? [
            {
              userId: transfer.toEmployee.user.id,
              title: 'Work transferred to you',
              message: `You are now assigned to ${transfer.workOrder.workOrderNumber}`,
              type: NotificationType.WORK_TRANSFER_DECISION as NotificationType,
              referenceType: 'workOrder',
              referenceId: transfer.workOrder.id,
            },
          ]
        : []),
    ]);
    void actor;
  }

  async list(query: ListTransfersDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const and: Prisma.WorkTransferWhereInput[] = [];
    if (query.status) and.push({ status: query.status });
    if (query.workOrderId) and.push({ workOrderId: query.workOrderId });
    if (actor.role === Role.EMPLOYEE && actor.employeeId) {
      and.push({
        OR: [{ fromEmployeeId: actor.employeeId }, { toEmployeeId: actor.employeeId }],
      });
    }

    const where: Prisma.WorkTransferWhereInput = {
      ...(and.length ? { AND: and } : {}),
      ...(search
        ? { workOrder: { workOrderNumber: { contains: search, mode: 'insensitive' } } }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.workTransfer.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['requestedAt', 'status']),
        include: transferInclude,
      }),
      this.prisma.workTransfer.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string): Promise<unknown> {
    const transfer = await this.prisma.workTransfer.findUnique({
      where: { id },
      include: transferInclude,
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }
}
