import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  EnquiryStatus,
  NotificationType,
  Prisma,
  Role,
  WorkAssignmentStatus,
  WorkOrderPriority,
  WorkOrderStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { SequenceService } from '../../common/sequence/sequence.module';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser } from '../../common/types/auth.types';
import {
  AssignEnquiryDto,
  CreateEnquiryDto,
  ListEnquiriesDto,
  UpdateEnquiryStatusDto,
} from './dto/enquiries.dto';

const enquiryInclude = {
  service: { select: { id: true, name: true } },
  serviceLocation: {
    select: {
      id: true,
      locationName: true,
      address: true,
      city: true,
      district: true,
      state: true,
      pincode: true,
      contactPerson: true,
      contactNumber: true,
      instructions: true,
      isActive: true,
    },
  },
  assignedManager: {
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  },
  customer: {
    select: {
      id: true,
      user: { select: { firstName: true, lastName: true, phone: true, email: true } },
      addresses: {
        where: { isActive: true },
        select: {
          id: true,
          locationName: true,
          address: true,
          city: true,
          district: true,
          state: true,
          pincode: true,
          contactPerson: true,
          contactNumber: true,
          instructions: true,
        },
        orderBy: { createdAt: 'desc' as const },
      },
    },
  },
} satisfies Prisma.EnquiryInclude;

const convertedWorkOrderInclude = {
  manager: { select: { id: true, user: { select: { id: true, firstName: true, lastName: true } } } },
  assignments: {
    include: {
      employee: {
        select: { id: true, employeeNo: true, user: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  },
} satisfies Prisma.WorkOrderInclude;

@Injectable()
export class EnquiriesService {
  private readonly logger = new Logger(EnquiriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    dto: CreateEnquiryDto,
    actor: { id: string; role: Role; customerId?: string; companyId?: string },
  ): Promise<unknown> {
    const name = dto.name ?? dto.contactName;
    if (!name) throw new BadRequestException('Contact name is required');
    const companyName = dto.companyName ?? dto.company;
    const requestedService = dto.serviceId ?? dto.requestedService;
    const message = dto.message ?? dto.customerMessage;
    const company = actor.companyId
      ? await this.prisma.company.findFirst({ where: { id: actor.companyId, isActive: true }, select: { id: true } })
      : await this.prisma.company.findFirst({ where: { slug: dto.companySlug?.trim().toLowerCase() || 'default', isActive: true }, select: { id: true } });
    if (!company) throw new BadRequestException('Company is unavailable');
    const companyId = company.id;
    let customerId = actor.role === Role.CUSTOMER ? actor.customerId : dto.customerId;
    if (actor.role === Role.CUSTOMER && dto.customerId && dto.customerId !== actor.customerId) {
      throw new ForbiddenException('You cannot create an enquiry for another customer');
    }
    if (customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new BadRequestException('Customer does not exist');
      if (customer.companyId !== companyId) throw new ForbiddenException('Customer is outside this company');
    }
    let serviceId: string | undefined;
    if (requestedService) {
      const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedService);
      const service = looksLikeUuid
        ? await this.prisma.service.findUnique({ where: { id: requestedService } })
        : await this.prisma.service.findFirst({
          where: { companyId, name: { equals: requestedService.trim(), mode: 'insensitive' }, isActive: true },
        });
      if (!service) throw new BadRequestException('Service does not exist');
      if (service.companyId !== companyId) throw new BadRequestException('Service is outside this company');
      serviceId = service.id;
    }
    if (dto.serviceLocationId) {
      const address = await this.prisma.customerAddress.findUnique({
        where: { id: dto.serviceLocationId },
      });
      if (!address) throw new BadRequestException('Service location does not exist');
      if (actor.customerId && address.customerId !== actor.customerId) {
        throw new ForbiddenException('Service location does not belong to you');
      }
      if (customerId && address.customerId !== customerId) {
        throw new BadRequestException('Service location does not belong to the selected customer');
      }
      customerId ??= address.customerId;
    }

    const email = dto.email.trim().toLowerCase();
    let existingCustomer = customerId
      ? await this.prisma.customer.findFirst({
          where: { id: customerId, companyId },
          select: { id: true },
        })
      : null;
    if (customerId && !existingCustomer) {
      throw new BadRequestException('Customer does not exist in this company');
    }

    // Link a matching customer record if one exists, but do not create one here.
    if (!customerId) {
      const matchingCustomer = await this.prisma.customer.findFirst({
        where: {
          companyId,
          OR: [
            { phone: dto.phone },
            ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []),
            { user: { is: { phone: dto.phone } } },
            ...(email ? [{ user: { is: { email: { equals: email, mode: 'insensitive' as const } } } }] : []),
          ],
        },
        select: { id: true },
      });
      existingCustomer = matchingCustomer;
      customerId = matchingCustomer?.id;
    }

    const enquiryNumber = await this.sequences.next('ENQ');
    const enquiry = await this.prisma.enquiry.create({
      data: {
        companyId,
        enquiryNumber,
        customerId: existingCustomer?.id ?? customerId,
        name,
        companyName: companyName?.trim() || undefined,
        phone: dto.phone,
        email,
        serviceId,
        priority: dto.priority ?? WorkOrderPriority.NORMAL,
        serviceLocationId: dto.serviceLocationId,
        message,
        status: EnquiryStatus.NEW,
      },
    });

    await this.audit.log({
      action: 'CREATE_ENQUIRY',
      module: 'enquiries',
      entity: 'Enquiry',
      entityId: enquiry.id,
      userId: actor.id || undefined,
      newValues: { enquiryNumber, phone: dto.phone },
    });

    // Alert active admins and managers about every new enquiry.
    try {
      const recipients = await this.prisma.user.findMany({
        where: { role: { in: [Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN] }, isActive: true, companyId },
        select: { id: true },
      });
      await this.notifications.notifyMany(
        recipients.map((recipient) => ({
          userId: recipient.id,
          title: 'New enquiry',
          message: `Enquiry ${enquiryNumber} received from ${name}`,
          type: NotificationType.NEW_ENQUIRY,
          referenceType: 'enquiry',
          referenceId: enquiry.id,
        })),
      );
    } catch (error) {
      this.logger.error(
        `Enquiry ${enquiry.id} was saved, but admin notifications could not be sent`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return enquiry;
  }

  async list(query: ListEnquiriesDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const scopeFilter =
      actor.role === Role.MANAGER
        ? { OR: [{ assignedManagerId: actor.managerId ?? '__none__' }, { assignedManagerId: null }] }
        : {};
    const where: Prisma.EnquiryWhereInput = {
      ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.assignedManagerId ? { assignedManagerId: query.assignedManagerId } : {}),
      ...scopeFilter,
      ...(search
        ? {
            OR: [
              { enquiryNumber: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.enquiry.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt', 'status']),
        include: enquiryInclude,
      }),
      this.prisma.enquiry.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string, actor?: AuthUser): Promise<unknown> {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
      include: enquiryInclude,
    });
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    if (actor && actor.role !== Role.SUPER_ADMIN && enquiry.companyId !== actor.companyId) throw new NotFoundException('Enquiry not found');
    return enquiry;
  }

  async assign(id: string, dto: AssignEnquiryDto, actor: AuthUser): Promise<unknown> {
    const enquiry = await this.prisma.enquiry.findFirst({ where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) } });
    if (!enquiry) throw new NotFoundException('Enquiry not found');

    const manager = await this.prisma.manager.findUnique({ where: { id: dto.managerId } });
    if (!manager) throw new BadRequestException('Manager does not exist');
    if (manager.companyId !== enquiry.companyId) throw new BadRequestException('Manager belongs to another company');

    const updated = await this.prisma.enquiry.update({
      where: { id },
      data: { assignedManagerId: manager.id },
    });

    await this.notifications.notify({
      userId: manager.userId,
      title: 'Enquiry assigned',
      message: `Enquiry ${enquiry.enquiryNumber} has been assigned to you`,
      type: NotificationType.NEW_ENQUIRY,
      referenceType: 'enquiry',
      referenceId: enquiry.id,
    });
    await this.audit.log({
      action: 'ASSIGN_ENQUIRY',
      module: 'enquiries',
      entity: 'Enquiry',
      entityId: id,
      userId: actor.id,
      oldValues: { assignedManagerId: enquiry.assignedManagerId },
      newValues: { assignedManagerId: manager.id },
    });
    return updated;
  }

  private readonly allowedStatusTransitions: Record<EnquiryStatus, EnquiryStatus[]> = {
    NEW: [EnquiryStatus.CONTACTED, EnquiryStatus.FOLLOW_UP, EnquiryStatus.CLOSED, EnquiryStatus.CANCELLED],
    CONTACTED: [EnquiryStatus.FOLLOW_UP, EnquiryStatus.CLOSED, EnquiryStatus.CANCELLED],
    FOLLOW_UP: [EnquiryStatus.CONTACTED, EnquiryStatus.CLOSED, EnquiryStatus.CANCELLED],
    CONVERTED: [EnquiryStatus.CLOSED],
    CLOSED: [],
    CANCELLED: [],
  };

  async updateStatus(id: string, dto: UpdateEnquiryStatusDto, actor: AuthUser): Promise<unknown> {
    const enquiry = await this.prisma.enquiry.findFirst({ where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) } });
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    if (dto.status === EnquiryStatus.CONVERTED) {
      throw new BadRequestException('Use the convert endpoint to convert an enquiry');
    }
    if (!this.allowedStatusTransitions[enquiry.status].includes(dto.status)) {
      throw new BadRequestException(
        `Cannot change enquiry status from ${enquiry.status} to ${dto.status}`,
      );
    }

    const updated = await this.prisma.enquiry.update({
      where: { id },
      data: { status: dto.status },
    });
    await this.audit.log({
      action: 'ENQUIRY_STATUS_CHANGED',
      module: 'enquiries',
      entity: 'Enquiry',
      entityId: id,
      userId: actor.id,
      oldValues: { status: enquiry.status },
      newValues: { status: dto.status, note: dto.note },
    });
    return updated;
  }

  /**
   * Converts an enquiry into a booking inside a single transaction and records
   * the conversion on the enquiry.
   */
  async convertToBooking(
    id: string,
    dto: {
      customerId?: string;
      serviceId?: string;
      serviceLocationId?: string;
      preferredDate: string;
      preferredTime: string;
      remarks?: string;
      scheduledDate?: string;
      scheduledStartTime?: string;
      priority?: WorkOrderPriority;
      managerId?: string;
      assignedManagerId?: string;
      employeeIds?: string[];
      instructions?: string;
      serviceNotes?: string;
    },
    actor: AuthUser,
  ): Promise<unknown> {
    const enquiry = await this.prisma.enquiry.findUnique({ where: { id } });
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    if (actor.role !== Role.SUPER_ADMIN && enquiry.companyId !== actor.companyId) throw new NotFoundException('Enquiry not found');
    const actorId = actor.id;
    if (enquiry.convertedBookingId) {
      throw new BadRequestException('Enquiry has already been converted');
    }
    if (enquiry.status === EnquiryStatus.CLOSED || enquiry.status === EnquiryStatus.CANCELLED) {
      throw new BadRequestException('Closed or cancelled enquiries cannot be converted');
    }

    let customerId = enquiry.customerId ?? dto.customerId;
    const serviceId = dto.serviceId ?? enquiry.serviceId;
    const serviceLocationId = dto.serviceLocationId ?? enquiry.serviceLocationId;
    if (!serviceId) throw new BadRequestException('serviceId is required to convert this enquiry');
    if (!serviceLocationId) {
      throw new BadRequestException('serviceLocationId is required to convert this enquiry');
    }

    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new BadRequestException('Service does not exist');
    const address = await this.prisma.customerAddress.findUnique({
      where: { id: serviceLocationId },
      select: { id: true, customerId: true, isActive: true },
    });
    if (!address) throw new BadRequestException('Service location does not exist');
    customerId ??= address.customerId;
    if (address.customerId !== customerId) {
      throw new BadRequestException('Service location does not belong to the customer');
    }
    if (!address.isActive) throw new BadRequestException('Service location is inactive');

    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new BadRequestException('Customer does not exist');

    const preferredDate = new Date(dto.preferredDate);
    if (Number.isNaN(preferredDate.getTime())) {
      throw new BadRequestException('preferredDate is invalid');
    }
    if (preferredDate.getTime() < new Date().setHours(0, 0, 0, 0)) {
      throw new BadRequestException('preferredDate cannot be in the past');
    }

    const managerId = dto.managerId ?? dto.assignedManagerId ?? enquiry.assignedManagerId ?? undefined;
    const manager = managerId
      ? await this.prisma.manager.findUnique({
          where: { id: managerId },
          include: {
            user: { select: { id: true, isActive: true, role: true } },
          },
        })
      : null;
    if (managerId && (!manager || !manager.user.isActive || manager.user.role !== Role.MANAGER)) {
      throw new BadRequestException('Manager does not exist or is inactive');
    }

    const employeeIds = [...new Set(dto.employeeIds ?? [])];
    const employees = employeeIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: employeeIds } },
          include: { user: { select: { id: true, isActive: true } } },
        })
      : [];
    if (employees.length !== employeeIds.length) {
      throw new BadRequestException('One or more selected employees do not exist');
    }
    if (employees.some((employee) => !employee.user.isActive)) {
      throw new BadRequestException('Cannot assign a deactivated employee');
    }

    const createWorkOrder = Boolean(managerId || employeeIds.length);
    const bookingNumber = await this.sequences.next('BOOK');
    const workOrderNumber = createWorkOrder ? await this.sequences.next('WO') : undefined;
    const scheduledDate = dto.scheduledDate ? new Date(dto.scheduledDate) : preferredDate;
    const scheduledStartTime = dto.scheduledStartTime ?? dto.preferredTime;
    const [startHour, startMinute] = scheduledStartTime.split(':').map(Number);
    const scheduledEndTotal = (startHour * 60 + startMinute + service.estimatedDuration) % (24 * 60);
    const scheduledEndTime = `${String(Math.floor(scheduledEndTotal / 60)).padStart(2, '0')}:${String(scheduledEndTotal % 60).padStart(2, '0')}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const createdBooking = await tx.booking.create({
        data: {
          companyId: enquiry.companyId,
          bookingNumber,
          customerId,
          serviceId,
          serviceLocationId,
          baseServicePrice: service.basePrice,
          totalAmount: service.basePrice,
          preferredDate,
          preferredTime: dto.preferredTime,
          remarks: dto.remarks ?? enquiry.message ?? undefined,
          status: createWorkOrder ? BookingStatus.ASSIGNED : BookingStatus.REQUESTED,
          createdById: actorId,
        },
      });
      let workOrder: Prisma.WorkOrderGetPayload<{
        include: typeof convertedWorkOrderInclude;
      }> | null = null;

      if (createWorkOrder && workOrderNumber) {
        const createdWorkOrder = await tx.workOrder.create({
          data: {
            companyId: enquiry.companyId,
            workOrderNumber,
            bookingId: createdBooking.id,
            customerId,
            serviceId,
            serviceLocationId,
            createdById: actorId,
            priority: dto.priority ?? enquiry.priority,
            scheduledDate,
            scheduledStartTime,
            scheduledEndTime,
            instructions: dto.instructions ?? dto.serviceNotes ?? dto.remarks ?? enquiry.message ?? undefined,
            status: WorkOrderStatus.ASSIGNED,
            ...(manager ? { managerId: manager.id } : {}),
          },
        });
        if (employeeIds.length) {
          await tx.workAssignment.createMany({
            data: employeeIds.map((employeeId) => ({
              workOrderId: createdWorkOrder.id,
              employeeId,
              assignedById: actorId,
              status: WorkAssignmentStatus.ASSIGNED,
            })),
          });
        }
        await tx.workOrderStatusLog.create({
          data: {
            workOrderId: createdWorkOrder.id,
            fromStatus: null,
            toStatus: WorkOrderStatus.ASSIGNED,
            changedById: actorId,
            note: 'Work order created while converting enquiry',
          },
        });
        workOrder = await tx.workOrder.findUniqueOrThrow({
          where: { id: createdWorkOrder.id },
          include: convertedWorkOrderInclude,
        });
      }
      await tx.enquiry.update({
        where: { id },
        data: {
          status: EnquiryStatus.CONVERTED,
          customerId,
          serviceId,
          serviceLocationId,
          ...(manager ? { assignedManagerId: manager.id } : {}),
          convertedBookingId: createdBooking.id,
          convertedAt: new Date(),
        },
      });
      return { booking: createdBooking, workOrder };
    });

    await this.audit.log({
      action: 'CONVERT_ENQUIRY',
      module: 'enquiries',
      entity: 'Enquiry',
      entityId: id,
      userId: actorId,
      oldValues: { status: enquiry.status },
      newValues: {
        status: EnquiryStatus.CONVERTED,
        bookingNumber,
        ...(result.workOrder ? { workOrderNumber, assignedEmployeeCount: employeeIds.length } : {}),
      },
    });

    if (customer.userId) {
      await this.notifications.notify({
        userId: customer.userId,
        title: 'Booking received',
        message: `Your booking ${bookingNumber} has been created`,
        type: NotificationType.BOOKING_CREATED,
        referenceType: 'booking',
        referenceId: result.booking.id,
      });
    }

    if (result.workOrder) {
      const assigneeNotifications = [
        ...(manager?.user.id
          ? [
              {
                userId: manager.user.id,
                title: 'New work order',
                message: `Work order ${result.workOrder.workOrderNumber} has been created`,
              },
            ]
          : []),
        ...employees.map((employee) => ({
          userId: employee.user.id,
          title: 'New work assigned',
          message: `You have been assigned to work order ${result.workOrder!.workOrderNumber}`,
        })),
      ];
      await this.notifications.notifyMany(
        assigneeNotifications.map((item) => ({
          ...item,
          type: NotificationType.WORK_ASSIGNED,
          referenceType: 'workOrder',
          referenceId: result.workOrder!.id,
        })),
      );
    }

    return result.workOrder ? { ...result.booking, workOrder: result.workOrder } : result.booking;
  }
}
