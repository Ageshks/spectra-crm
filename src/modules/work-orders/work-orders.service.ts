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
  WorkOrderPriority,
  WorkOrderStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingsService } from '../bookings/bookings.service';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { SequenceService } from '../../common/sequence/sequence.module';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser } from '../../common/types/auth.types';
import { WorkOrderStatusService } from './work-order-status.service';
import {
  CreateWorkOrderDto,
  ListWorkOrdersDto,
  SetManagerDto,
  UpdatePriorityDto,
  UpdateScheduleDto,
  UpdateWorkOrderStatusDto,
} from './dto/work-orders.dto';

const workOrderInclude = {
  customer: {
    select: {
      id: true,
      user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
    },
  },
  service: { select: { id: true, name: true, image: true, requiresMaintenance: true, basePrice: true } },
  serviceLocation: {
    select: {
      id: true, locationName: true, address: true, city: true,
      state: true, pincode: true, latitude: true, longitude: true,
    },
  },
  manager: {
    select: { id: true, user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
  },
  booking: { select: { id: true, bookingNumber: true, status: true, preferredDate: true, preferredTime: true } },
  assignments: {
    include: {
      employee: {
        select: {
          id: true,
          employeeNo: true,
          user: { select: { id: true, firstName: true, lastName: true, phone: true, profilePhoto: true } },
        },
      },
    },
  },
  serviceReport: { select: { id: true, reportNumber: true, status: true, updatedAt: true } },
  _count: { select: { photos: true, statusLogs: true } },
} satisfies Prisma.WorkOrderInclude;

@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly notifications: NotificationsService,
    private readonly bookings: BookingsService,
    private readonly statusService: WorkOrderStatusService,
  ) {}

  /** Loads a work order and enforces customer / employee access rules. */
  async loadForActor(
    id: string,
    actor: AuthUser,
  ): Promise<Prisma.WorkOrderGetPayload<{ include: typeof workOrderInclude }>> {
    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id },
      include: workOrderInclude,
    });
    if (!workOrder) throw new NotFoundException('Work order not found');
    if (actor.role === Role.CUSTOMER && workOrder.customerId !== actor.customerId) {
      throw new ForbiddenException('You are not allowed to access this work order');
    }
    if (actor.role === Role.EMPLOYEE) {
      const mine = workOrder.assignments.some((a) => a.employee.user.id === actor.id);
      if (!mine) {
        throw new ForbiddenException('You are not assigned to this work order');
      }
    }
    return workOrder;
  }

  /**
   * Creates a work order from a CONFIRMED/SCHEDULED booking (single
   * transaction: work order + booking status sync + status log).
   */
  async createFromBooking(dto: CreateWorkOrderDto, actor: AuthUser): Promise<unknown> {
    const booking = await this.prisma.booking.findUnique({ where: { id: dto.bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.SCHEDULED
    ) {
      throw new BadRequestException('A work order requires a CONFIRMED or SCHEDULED booking');
    }
    const existing = await this.prisma.workOrder.findUnique({
      where: { bookingId: booking.id },
    });
    if (existing) {
      throw new BadRequestException(
        `Work order ${existing.workOrderNumber} already exists for this booking`,
      );
    }

    if (dto.managerId) {
      const manager = await this.prisma.manager.findUnique({ where: { id: dto.managerId } });
      if (!manager) throw new BadRequestException('Manager does not exist');
    }

    const workOrderNumber = await this.sequences.next('WO');
    const workOrder = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workOrder.create({
        data: {
          workOrderNumber,
          bookingId: booking.id,
          customerId: booking.customerId,
          serviceId: booking.serviceId,
          serviceLocationId: booking.serviceLocationId,
          managerId: dto.managerId,
          createdById: actor.id,
          priority: dto.priority ?? WorkOrderPriority.NORMAL,
          scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
          scheduledStartTime: dto.scheduledStartTime,
          scheduledEndTime: dto.scheduledEndTime,
          instructions: dto.instructions,
          status: WorkOrderStatus.ASSIGNED,
        },
        include: workOrderInclude,
      });
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.ASSIGNED },
      });
      await tx.workOrderStatusLog.create({
        data: {
          workOrderId: created.id,
          fromStatus: null,
          toStatus: WorkOrderStatus.ASSIGNED,
          changedById: actor.id,
          note: 'Work order created',
        },
      });
      return created;
    });

    await this.audit.log({
      action: 'CREATE_WORK_ORDER',
      module: 'work-orders',
      entity: 'WorkOrder',
      entityId: workOrder.id,
      userId: actor.id,
      newValues: { workOrderNumber, bookingNumber: booking.bookingNumber },
    });

    if (workOrder.manager) {
      await this.notifications.notify({
        userId: workOrder.manager.user.id,
        title: 'New work order',
        message: `Work order ${workOrderNumber} has been created`,
        type: NotificationType.WORK_ASSIGNED,
        referenceType: 'workOrder',
        referenceId: workOrder.id,
      });
    }

    return workOrder;
  }

  async list(query: ListWorkOrdersDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);

    const and: Prisma.WorkOrderWhereInput[] = [];
    if (query.status) and.push({ status: query.status });
    if (query.priority) and.push({ priority: query.priority });
    if (query.customerId) and.push({ customerId: query.customerId });
    if (query.managerId) and.push({ managerId: query.managerId });
    if (query.employeeId) {
      and.push({ assignments: { some: { employeeId: query.employeeId } } });
    }
    if (query.scheduledFrom || query.scheduledTo) {
      and.push({
        scheduledDate: {
          ...(query.scheduledFrom ? { gte: new Date(query.scheduledFrom) } : {}),
          ...(query.scheduledTo ? { lte: new Date(query.scheduledTo) } : {}),
        },
      });
    }

    if (actor.role === Role.CUSTOMER) {
      and.push({ customerId: actor.customerId ?? '__none__' });
    }
    if (actor.role === Role.EMPLOYEE && (query.mine ?? true)) {
      and.push({ assignments: { some: { employee: { userId: actor.id } } } });
    }
    if (actor.role === Role.MANAGER) {
      and.push({
        OR: [{ managerId: actor.managerId ?? '__none__' }, { managerId: null }],
      });
    }

    const where: Prisma.WorkOrderWhereInput = {
      ...(and.length ? { AND: and } : {}),
      ...(search
        ? {
            OR: [
              { workOrderNumber: { contains: search, mode: 'insensitive' } },
              { customer: { user: { firstName: { contains: search, mode: 'insensitive' } } } },
              { customer: { user: { lastName: { contains: search, mode: 'insensitive' } } } },
              { booking: { bookingNumber: { contains: search, mode: 'insensitive' } } },
              {
                assignments: {
                  some: {
                    employee: {
                      user: { firstName: { contains: search, mode: 'insensitive' } },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.workOrder.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt', 'scheduledDate', 'priority', 'status']),
        include: workOrderInclude,
      }),
      this.prisma.workOrder.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string, actor: AuthUser): Promise<unknown> {
    return this.loadForActor(id, actor);
  }

  async statusHistory(id: string, actor: AuthUser): Promise<unknown> {
    await this.loadForActor(id, actor);
    return this.statusService.history(id);
  }

  async updateSchedule(id: string, dto: UpdateScheduleDto, actor: AuthUser): Promise<unknown> {
    const workOrder = await this.loadForActor(id, actor);
    if (
      workOrder.status === WorkOrderStatus.COMPLETED ||
      workOrder.status === WorkOrderStatus.APPROVED ||
      workOrder.status === WorkOrderStatus.CANCELLED
    ) {
      throw new BadRequestException('Cannot reschedule a completed or cancelled work order');
    }

    const updated = await this.prisma.workOrder.update({
      where: { id },
      data: {
        scheduledDate: new Date(dto.scheduledDate),
        scheduledStartTime: dto.scheduledStartTime,
        scheduledEndTime: dto.scheduledEndTime,
      },
      include: workOrderInclude,
    });

    await this.audit.log({
      action: 'UPDATE_SCHEDULE',
      module: 'work-orders',
      entity: 'WorkOrder',
      entityId: id,
      userId: actor.id,
      oldValues: {
        scheduledDate: workOrder.scheduledDate?.toISOString(),
        scheduledStartTime: workOrder.scheduledStartTime,
        scheduledEndTime: workOrder.scheduledEndTime,
      },
      newValues: dto as unknown as Prisma.InputJsonValue,
    });

    const assigneeUserIds = await this.collectAssigneeUserIds(id);
    await this.notifications.notifyMany([
      ...assigneeUserIds.map((userId) => ({
        userId,
        title: 'Schedule changed',
        message: `Work ${workOrder.workOrderNumber} was rescheduled to ${dto.scheduledDate} ${dto.scheduledStartTime}`,
        type: NotificationType.WORK_SCHEDULE_CHANGED as NotificationType,
        referenceType: 'workOrder',
        referenceId: id,
      })),
      ...(workOrder.manager
        ? [
            {
              userId: workOrder.manager.user.id,
              title: 'Schedule changed',
              message: `Work ${workOrder.workOrderNumber} was rescheduled`,
              type: NotificationType.WORK_SCHEDULE_CHANGED as NotificationType,
              referenceType: 'workOrder',
              referenceId: id,
            },
          ]
        : []),
    ]);

    return updated;
  }

  private async collectAssigneeUserIds(workOrderId: string): Promise<string[]> {
    const assignments = await this.prisma.workAssignment.findMany({
      where: { workOrderId },
      select: { employee: { select: { userId: true } } },
    });
    return assignments.map((a) => a.employee.userId);
  }

  async setManager(id: string, dto: SetManagerDto, actor: AuthUser): Promise<unknown> {
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id } });
    if (!workOrder) throw new NotFoundException('Work order not found');
    const manager = await this.prisma.manager.findUnique({ where: { id: dto.managerId } });
    if (!manager) throw new BadRequestException('Manager does not exist');

    const updated = await this.prisma.workOrder.update({
      where: { id },
      data: { managerId: manager.id },
      include: workOrderInclude,
    });
    await this.audit.log({
      action: 'SET_WORK_ORDER_MANAGER',
      module: 'work-orders',
      entity: 'WorkOrder',
      entityId: id,
      userId: actor.id,
      oldValues: { managerId: workOrder.managerId },
      newValues: { managerId: manager.id },
    });
    await this.notifications.notify({
      userId: manager.userId,
      title: 'Work order assigned to you',
      message: `You are now managing ${workOrder.workOrderNumber}`,
      type: NotificationType.MANAGER_INSTRUCTION,
      referenceType: 'workOrder',
      referenceId: id,
    });
    return updated;
  }

  async updatePriority(id: string, dto: UpdatePriorityDto, actor: AuthUser): Promise<unknown> {
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id } });
    if (!workOrder) throw new NotFoundException('Work order not found');
    const updated = await this.prisma.workOrder.update({
      where: { id },
      data: { priority: dto.priority },
      include: workOrderInclude,
    });
    await this.audit.log({
      action: 'UPDATE_PRIORITY',
      module: 'work-orders',
      entity: 'WorkOrder',
      entityId: id,
      userId: actor.id,
      oldValues: { priority: workOrder.priority },
      newValues: { priority: dto.priority },
    });
    return updated;
  }

  /**
   * Explicit status changes made by managers/admins (e.g. cancellation).
   * Employee-driven transitions go through the assignments endpoints so the
   * assignment timestamps stay in sync.
   */
  async changeStatus(id: string, dto: UpdateWorkOrderStatusDto, actor: AuthUser): Promise<unknown> {
    const workOrder = await this.loadForActor(id, actor);

    const managerControlled: WorkOrderStatus[] = [
      WorkOrderStatus.CANCELLED,
      WorkOrderStatus.ON_HOLD,
      WorkOrderStatus.APPROVED,
      WorkOrderStatus.CORRECTION_REQUIRED,
    ];
    if (
      managerControlled.includes(dto.status) &&
      actor.role !== Role.ADMIN &&
      actor.role !== Role.SUPER_ADMIN &&
      actor.role !== Role.MANAGER
    ) {
      throw new ForbiddenException('Only managers can apply this status change');
    }

    await this.statusService.apply(id, dto.status, {
      actorId: actor.id,
      note: dto.note,
    });

    if (
      dto.status === WorkOrderStatus.IN_PROGRESS ||
      dto.status === WorkOrderStatus.COMPLETED
    ) {
      await this.bookings.syncStatus(
        workOrder.bookingId,
        dto.status === WorkOrderStatus.IN_PROGRESS
          ? BookingStatus.IN_PROGRESS
          : BookingStatus.COMPLETED,
      );
    }
    if (dto.status === WorkOrderStatus.APPROVED) {
      await this.bookings.syncStatus(workOrder.bookingId, BookingStatus.COMPLETED);
    }

    return this.loadForActor(id, actor);
  }
}
