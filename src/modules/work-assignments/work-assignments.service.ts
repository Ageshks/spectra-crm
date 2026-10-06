import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  NotificationType,
  Prisma,
  Role,
  WorkAssignmentStatus,
  WorkOrderStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingsService } from '../bookings/bookings.service';
import { WorkOrderStatusService } from '../work-orders/work-order-status.service';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser } from '../../common/types/auth.types';
import { AssignmentActionDto, CreateAssignmentDto, ListAssignmentsDto } from './dto/work-assignments.dto';

const assignmentInclude = {
  employee: {
    select: {
      id: true,
      employeeNo: true,
      user: {
        select: { id: true, firstName: true, lastName: true, phone: true, profilePhoto: true },
      },
    },
  },
  workOrder: {
    include: {
      customer: {
        select: { id: true, user: { select: { firstName: true, lastName: true, phone: true } } },
      },
      service: { select: { id: true, name: true } },
      serviceLocation: { select: { id: true, locationName: true, address: true, city: true } },
      manager: { select: { id: true, user: { select: { id: true, firstName: true, lastName: true } } } },
    },
  },
} satisfies Prisma.WorkAssignmentInclude;

@Injectable()
export class WorkAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly bookings: BookingsService,
    private readonly statusService: WorkOrderStatusService,
  ) {}

  async assign(dto: CreateAssignmentDto, actor: AuthUser): Promise<unknown> {
    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id: dto.workOrderId },
    });
    if (!workOrder) throw new NotFoundException('Work order not found');
    if (
      workOrder.status === WorkOrderStatus.COMPLETED ||
      workOrder.status === WorkOrderStatus.APPROVED ||
      workOrder.status === WorkOrderStatus.CANCELLED
    ) {
      throw new BadRequestException(`Cannot assign technicians to a ${workOrder.status} work order`);
    }

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: dto.employeeIds } },
      include: { user: { select: { id: true, isActive: true } } },
    });
    if (employees.length !== new Set(dto.employeeIds).size) {
      throw new BadRequestException('One or more employees do not exist');
    }
    const inactive = employees.filter((e) => !e.user.isActive);
    if (inactive.length > 0) {
      throw new BadRequestException('Cannot assign deactivated employees');
    }

    const existing = await this.prisma.workAssignment.findMany({
      where: { workOrderId: workOrder.id },
      select: { employeeId: true },
    });
    const alreadyAssigned = new Set(existing.map((a) => a.employeeId));
    const toCreate = employees.filter((e) => !alreadyAssigned.has(e.id));
    if (toCreate.length === 0) {
      throw new BadRequestException('All selected employees are already assigned to this work order');
    }

    const created = await this.prisma.$transaction(
      toCreate.map((employee) =>
        this.prisma.workAssignment.create({
          data: {
            workOrderId: workOrder.id,
            employeeId: employee.id,
            assignedById: actor.id,
            status: WorkAssignmentStatus.ASSIGNED,
          },
          include: assignmentInclude,
        }),
      ),
    );

    await this.audit.log({
      action: 'ASSIGN_WORK',
      module: 'work-assignments',
      entity: 'WorkAssignment',
      entityId: workOrder.id,
      userId: actor.id,
      newValues: { employeeIds: toCreate.map((e) => e.id) },
    });

    await this.notifications.notifyMany(
      toCreate.map((employee) => ({
        userId: employee.user.id,
        title: 'New work assigned',
        message: `You have been assigned to work order ${workOrder.workOrderNumber}`,
        type: NotificationType.WORK_ASSIGNED,
        referenceType: 'workOrder',
        referenceId: workOrder.id,
      })),
    );

    return created;
  }

  async list(query: ListAssignmentsDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const and: Prisma.WorkAssignmentWhereInput[] = [];
    if (query.status) and.push({ status: query.status });
    if (query.workOrderId) and.push({ workOrderId: query.workOrderId });
    if (actor.role === Role.EMPLOYEE && (query.mine ?? true)) {
      and.push({ employee: { userId: actor.id } });
    }

    const where: Prisma.WorkAssignmentWhereInput = {
      ...(and.length ? { AND: and } : {}),
      ...(search
        ? {
            OR: [
              { workOrder: { workOrderNumber: { contains: search, mode: 'insensitive' } } },
              { employee: { employeeNo: { contains: search, mode: 'insensitive' } } },
              { employee: { user: { firstName: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.workAssignment.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['assignedAt', 'status']),
        include: assignmentInclude,
      }),
      this.prisma.workAssignment.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  /** Loads an assignment ensuring the acting employee owns it (rule: employee cannot touch others' work). */
  private async loadOwned(
    id: string,
    actor: AuthUser,
  ): Promise<Prisma.WorkAssignmentGetPayload<{ include: typeof assignmentInclude }>> {
    const assignment = await this.prisma.workAssignment.findUnique({
      where: { id },
      include: assignmentInclude,
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (actor.role === Role.EMPLOYEE && assignment.employee.user.id !== actor.id) {
      throw new ForbiddenException('This assignment does not belong to you');
    }
    return assignment;
  }

  async accept(id: string, actor: AuthUser, dto: AssignmentActionDto): Promise<unknown> {
    const assignment = await this.loadOwned(id, actor);
    if (assignment.status !== WorkAssignmentStatus.ASSIGNED) {
      throw new BadRequestException(`Only ASSIGNED work can be accepted (current: ${assignment.status})`);
    }

    const updated = await this.prisma.workAssignment.update({
      where: { id },
      data: { status: WorkAssignmentStatus.ACCEPTED, acceptedAt: new Date() },
      include: assignmentInclude,
    });

    if (assignment.workOrder.status === WorkOrderStatus.ASSIGNED) {
      await this.statusService.apply(assignment.workOrderId, WorkOrderStatus.ACCEPTED, {
        actorId: actor.id,
        note: dto.note ?? `Accepted by ${assignment.employee.user.firstName}`,
      });
    }

    await this.audit.log({
      action: 'ACCEPT_WORK',
      module: 'work-assignments',
      entity: 'WorkAssignment',
      entityId: id,
      userId: actor.id,
      oldValues: { status: WorkAssignmentStatus.ASSIGNED },
      newValues: { status: WorkAssignmentStatus.ACCEPTED },
    });
    return updated;
  }

  async start(id: string, actor: AuthUser, dto: AssignmentActionDto): Promise<unknown> {
    const assignment = await this.loadOwned(id, actor);
    if (assignment.status !== WorkAssignmentStatus.ACCEPTED) {
      throw new BadRequestException(
        `Only ACCEPTED work can be started (current: ${assignment.status})`,
      );
    }

    const updated = await this.prisma.workAssignment.update({
      where: { id },
      data: { status: WorkAssignmentStatus.IN_PROGRESS, startedAt: new Date() },
      include: assignmentInclude,
    });

    if (assignment.workOrder.status === WorkOrderStatus.ACCEPTED) {
      await this.statusService.apply(assignment.workOrderId, WorkOrderStatus.IN_PROGRESS, {
        actorId: actor.id,
        note: dto.note ?? `Started by ${assignment.employee.user.firstName}`,
      });
      await this.bookings.syncStatus(assignment.workOrder.bookingId, BookingStatus.IN_PROGRESS);
      const customerUserId = await this.resolveCustomerUserId(assignment.workOrderId);
      if (customerUserId) {
        await this.notifications.notify({
          userId: customerUserId,
          title: 'Service started',
          message: `Technician has started work on ${assignment.workOrder.workOrderNumber}`,
          type: NotificationType.SERVICE_STARTED,
          referenceType: 'workOrder',
          referenceId: assignment.workOrderId,
        });
      }
    }

    await this.audit.log({
      action: 'START_WORK',
      module: 'work-assignments',
      entity: 'WorkAssignment',
      entityId: id,
      userId: actor.id,
      oldValues: { status: WorkAssignmentStatus.ACCEPTED },
      newValues: { status: WorkAssignmentStatus.IN_PROGRESS },
    });
    return updated;
  }

  private async resolveCustomerUserId(workOrderId: string): Promise<string> {
    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { customer: { select: { userId: true } } },
    });
    return workOrder?.customer.userId ?? '';
  }

  async complete(id: string, actor: AuthUser, dto: AssignmentActionDto): Promise<unknown> {
    const assignment = await this.loadOwned(id, actor);
    if (assignment.status !== WorkAssignmentStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Only IN_PROGRESS work can be completed (current: ${assignment.status})`,
      );
    }

    const updated = await this.prisma.workAssignment.update({
      where: { id },
      data: { status: WorkAssignmentStatus.COMPLETED, completedAt: new Date() },
      include: assignmentInclude,
    });

    // When every technician has finished, complete the work order itself.
    const siblings = await this.prisma.workAssignment.findMany({
      where: { workOrderId: assignment.workOrderId },
      select: { status: true },
    });
    const allDone = siblings.every(
      (s) =>
        s.status === WorkAssignmentStatus.COMPLETED ||
        s.status === WorkAssignmentStatus.CANCELLED ||
        s.status === WorkAssignmentStatus.TRANSFERRED,
    );

    if (allDone && assignment.workOrder.status === WorkOrderStatus.IN_PROGRESS) {
      await this.statusService.apply(assignment.workOrderId, WorkOrderStatus.COMPLETED, {
        actorId: actor.id,
        note: dto.note ?? `Completed by ${assignment.employee.user.firstName}`,
      });
      await this.bookings.syncStatus(assignment.workOrder.bookingId, BookingStatus.COMPLETED);
      const customerUserId = await this.resolveCustomerUserId(assignment.workOrderId);
      if (customerUserId) {
        await this.notifications.notify({
          userId: customerUserId,
          title: 'Service completed',
          message: `Field work for ${assignment.workOrder.workOrderNumber} is complete — report under review`,
          type: NotificationType.SERVICE_COMPLETED,
          referenceType: 'workOrder',
          referenceId: assignment.workOrderId,
        });
      }
      if (assignment.workOrder.manager) {
        await this.notifications.notify({
          userId: assignment.workOrder.manager.user.id,
          title: 'Employee completion',
          message: `${assignment.workOrder.workOrderNumber} has been marked complete`,
          type: NotificationType.GENERAL,
          referenceType: 'workOrder',
          referenceId: assignment.workOrderId,
        });
      }
    }

    await this.audit.log({
      action: 'COMPLETE_WORK',
      module: 'work-assignments',
      entity: 'WorkAssignment',
      entityId: id,
      userId: actor.id,
      oldValues: { status: WorkAssignmentStatus.IN_PROGRESS },
      newValues: { status: WorkAssignmentStatus.COMPLETED },
    });
    return updated;
  }

  /** Manager/admin can cancel an assignment (employees have no rejection power — rule #4). */
  async cancel(id: string, actor: AuthUser, dto: AssignmentActionDto): Promise<unknown> {
    const assignment = await this.prisma.workAssignment.findUnique({
      where: { id },
      include: assignmentInclude,
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (
      assignment.status === WorkAssignmentStatus.COMPLETED ||
      assignment.status === WorkAssignmentStatus.CANCELLED
    ) {
      throw new BadRequestException(`Assignment is already ${assignment.status}`);
    }

    const updated = await this.prisma.workAssignment.update({
      where: { id },
      data: { status: WorkAssignmentStatus.CANCELLED },
      include: assignmentInclude,
    });
    await this.audit.log({
      action: 'CANCEL_ASSIGNMENT',
      module: 'work-assignments',
      entity: 'WorkAssignment',
      entityId: id,
      userId: actor.id,
      oldValues: { status: assignment.status },
      newValues: { status: WorkAssignmentStatus.CANCELLED, note: dto.note },
    });
    await this.notifications.notify({
      userId: assignment.employee.user.id,
      title: 'Assignment cancelled',
      message: `Your assignment for ${assignment.workOrder.workOrderNumber} was cancelled`,
      type: NotificationType.WORK_TRANSFER_DECISION,
      referenceType: 'workOrder',
      referenceId: assignment.workOrderId,
    });
    return updated;
  }
}
