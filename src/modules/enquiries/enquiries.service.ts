import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnquiryStatus, NotificationType, Prisma, Role } from '@prisma/client';
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
import {
  AssignEnquiryDto,
  CreateEnquiryDto,
  ListEnquiriesDto,
  UpdateEnquiryStatusDto,
} from './dto/enquiries.dto';

@Injectable()
export class EnquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(
    dto: CreateEnquiryDto,
    actor: { id: string; role: Role; customerId?: string },
  ): Promise<unknown> {
    if (dto.serviceId) {
      const service = await this.prisma.service.findUnique({ where: { id: dto.serviceId } });
      if (!service) throw new BadRequestException('Service does not exist');
    }
    if (dto.serviceLocationId) {
      const address = await this.prisma.customerAddress.findUnique({
        where: { id: dto.serviceLocationId },
      });
      if (!address) throw new BadRequestException('Service location does not exist');
      if (actor.customerId && address.customerId !== actor.customerId) {
        throw new ForbiddenException('Service location does not belong to you');
      }
    }

    const enquiryNumber = await this.sequences.next('ENQ');
    const enquiry = await this.prisma.enquiry.create({
      data: {
        enquiryNumber,
        customerId: actor.role === Role.CUSTOMER ? actor.customerId : undefined,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        serviceId: dto.serviceId,
        serviceLocationId: dto.serviceLocationId,
        message: dto.message,
        status: EnquiryStatus.NEW,
      },
    });

    await this.audit.log({
      action: 'CREATE_ENQUIRY',
      module: 'enquiries',
      entity: 'Enquiry',
      entityId: enquiry.id,
      userId: actor.id,
      newValues: { enquiryNumber, phone: dto.phone },
    });

    // Alert admins about every new enquiry.
    const admins = await this.prisma.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.SUPER_ADMIN] }, isActive: true },
      select: { id: true },
    });
    await this.notifications.notifyMany(
      admins.map((admin) => ({
        userId: admin.id,
        title: 'New enquiry',
        message: `Enquiry ${enquiryNumber} received from ${dto.name}`,
        type: NotificationType.NEW_ENQUIRY,
        referenceType: 'enquiry',
        referenceId: enquiry.id,
      })),
    );

    return enquiry;
  }

  async list(query: ListEnquiriesDto, actor: { id: string; role: Role }): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const scopeFilter =
      actor.role === Role.MANAGER
        ? { OR: [{ assignedManagerId: actor.id }, { assignedManagerId: null }] }
        : {};
    const where: Prisma.EnquiryWhereInput = {
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
        include: {
          service: { select: { id: true, name: true } },
          assignedManager: {
            select: { id: true, user: { select: { firstName: true, lastName: true } } },
          },
          customer: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.enquiry.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string): Promise<unknown> {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { id },
      include: {
        service: { select: { id: true, name: true } },
        assignedManager: {
          select: { id: true, user: { select: { firstName: true, lastName: true } } },
        },
        customer: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    return enquiry;
  }

  async assign(id: string, dto: AssignEnquiryDto, actorId: string): Promise<unknown> {
    const enquiry = await this.prisma.enquiry.findUnique({ where: { id } });
    if (!enquiry) throw new NotFoundException('Enquiry not found');

    const manager = await this.prisma.manager.findUnique({ where: { id: dto.managerId } });
    if (!manager) throw new BadRequestException('Manager does not exist');

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
      userId: actorId,
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

  async updateStatus(id: string, dto: UpdateEnquiryStatusDto, actorId: string): Promise<unknown> {
    const enquiry = await this.prisma.enquiry.findUnique({ where: { id } });
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
      userId: actorId,
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
    },
    actorId: string,
  ): Promise<unknown> {
    const enquiry = await this.prisma.enquiry.findUnique({ where: { id } });
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    if (enquiry.convertedBookingId) {
      throw new BadRequestException('Enquiry has already been converted');
    }
    if (enquiry.status === EnquiryStatus.CLOSED || enquiry.status === EnquiryStatus.CANCELLED) {
      throw new BadRequestException('Closed or cancelled enquiries cannot be converted');
    }

    const customerId = enquiry.customerId ?? dto.customerId;
    if (!customerId) {
      throw new BadRequestException('customerId is required to convert this enquiry');
    }
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new BadRequestException('Customer does not exist');

    const serviceId = dto.serviceId ?? enquiry.serviceId;
    const serviceLocationId = dto.serviceLocationId ?? enquiry.serviceLocationId;
    if (!serviceId) throw new BadRequestException('serviceId is required to convert this enquiry');
    if (!serviceLocationId) {
      throw new BadRequestException('serviceLocationId is required to convert this enquiry');
    }

    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new BadRequestException('Service does not exist');
    const address = await this.prisma.customerAddress.findFirst({
      where: { id: serviceLocationId, customerId },
    });
    if (!address) throw new BadRequestException('Service location does not belong to the customer');

    const preferredDate = new Date(dto.preferredDate);
    if (Number.isNaN(preferredDate.getTime())) {
      throw new BadRequestException('preferredDate is invalid');
    }
    if (preferredDate.getTime() < new Date().setHours(0, 0, 0, 0)) {
      throw new BadRequestException('preferredDate cannot be in the past');
    }

    const bookingNumber = await this.sequences.next('BOOK');
    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          bookingNumber,
          customerId,
          serviceId,
          serviceLocationId,
          preferredDate,
          preferredTime: dto.preferredTime,
          remarks: dto.remarks ?? enquiry.message ?? undefined,
          status: 'REQUESTED',
          createdById: actorId,
        },
      });
      await tx.enquiry.update({
        where: { id },
        data: {
          status: EnquiryStatus.CONVERTED,
          customerId,
          serviceId,
          serviceLocationId,
          convertedBookingId: created.id,
          convertedAt: new Date(),
        },
      });
      return created;
    });

    await this.audit.log({
      action: 'CONVERT_ENQUIRY',
      module: 'enquiries',
      entity: 'Enquiry',
      entityId: id,
      userId: actorId,
      oldValues: { status: enquiry.status },
      newValues: { status: EnquiryStatus.CONVERTED, bookingNumber },
    });

    await this.notifications.notify({
      userId: customer.userId,
      title: 'Booking received',
      message: `Your booking ${bookingNumber} has been created`,
      type: NotificationType.BOOKING_CREATED,
      referenceType: 'booking',
      referenceId: booking.id,
    });

    return booking;
  }
}
