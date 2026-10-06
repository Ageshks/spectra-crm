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
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { NotificationsService } from '../notifications/notifications.service';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { SequenceService } from '../../common/sequence/sequence.module';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser } from '../../common/types/auth.types';
import { CreateBookingDto, ListBookingsDto, UpdateBookingStatusDto } from './dto/bookings.dto';

const bookingInclude = {
  service: { select: { id: true, name: true, image: true, basePrice: true, estimatedDuration: true } },
  serviceLocation: {
    select: { id: true, locationName: true, address: true, city: true, state: true, pincode: true },
  },
  customer: {
    select: {
      id: true,
      user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
    },
  },
  workOrder: { select: { id: true, workOrderNumber: true, status: true, scheduledDate: true } },
} satisfies Prisma.BookingInclude;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly notifications: NotificationsService,
  ) {}

  private assertOwns(customerId: string | undefined, bookingCustomerId: string): void {
    if (!customerId || customerId !== bookingCustomerId) {
      throw new ForbiddenException('You are not allowed to access this booking');
    }
  }

  async create(dto: CreateBookingDto, actor: AuthUser): Promise<unknown> {
    const customerId =
      actor.role === Role.CUSTOMER ? actor.customerId : (dto.customerId ?? undefined);
    if (!customerId) {
      throw new BadRequestException('customerId is required');
    }

    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new BadRequestException('Customer does not exist');
    if (actor.role === Role.CUSTOMER && customer.id !== actor.customerId) {
      throw new ForbiddenException('You cannot book for another customer');
    }

    const service = await this.prisma.service.findUnique({ where: { id: dto.serviceId } });
    if (!service) throw new BadRequestException('Service does not exist');
    if (!service.isActive) throw new BadRequestException('Service is not available');

    const address = await this.prisma.customerAddress.findFirst({
      where: { id: dto.serviceLocationId, customerId },
    });
    if (!address) {
      throw new BadRequestException('Service location does not belong to this customer');
    }
    if (!address.isActive) {
      throw new BadRequestException('Service location is inactive');
    }

    const preferredDate = new Date(dto.preferredDate);
    if (Number.isNaN(preferredDate.getTime())) {
      throw new BadRequestException('preferredDate is invalid');
    }
    if (preferredDate.getTime() < new Date().setHours(0, 0, 0, 0)) {
      throw new BadRequestException('preferredDate cannot be in the past');
    }

    // Duplicate-request protection: same customer/service/location/day/time.
    const duplicate = await this.prisma.booking.findFirst({
      where: {
        customerId,
        serviceId: dto.serviceId,
        serviceLocationId: dto.serviceLocationId,
        preferredDate,
        preferredTime: dto.preferredTime,
        status: { notIn: ['CANCELLED'] },
      },
    });
    if (duplicate) {
      throw new BadRequestException(
        `Duplicate booking: ${duplicate.bookingNumber} already exists for this slot`,
      );
    }

    const bookingNumber = await this.sequences.next('BOOK');
    const booking = await this.prisma.booking.create({
      data: {
        bookingNumber,
        customerId,
        serviceId: dto.serviceId,
        serviceLocationId: dto.serviceLocationId,
        preferredDate,
        preferredTime: dto.preferredTime,
        remarks: dto.remarks,
        status: BookingStatus.REQUESTED,
        createdById: actor.id,
      },
      include: bookingInclude,
    });

    await this.audit.log({
      action: 'CREATE_BOOKING',
      module: 'bookings',
      entity: 'Booking',
      entityId: booking.id,
      userId: actor.id,
      newValues: { bookingNumber, serviceId: dto.serviceId },
    });

    const staff = await this.prisma.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER] }, isActive: true },
      select: { id: true },
    });
    await this.notifications.notifyMany([
      ...staff.map((s) => ({
        userId: s.id,
        title: 'New booking',
        message: `Booking ${bookingNumber} needs confirmation`,
        type: NotificationType.NEW_BOOKING as NotificationType,
        referenceType: 'booking',
        referenceId: booking.id,
      })),
      {
        userId: customer.userId,
        title: 'Booking created',
        message: `Your booking ${bookingNumber} has been received`,
        type: NotificationType.BOOKING_CREATED,
        referenceType: 'booking',
        referenceId: booking.id,
      },
    ]);

    return booking;
  }

  async list(query: ListBookingsDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);

    // Customers always get their own scope — never trust a client customerId.
    const scopedCustomerId =
      actor.role === Role.CUSTOMER ? actor.customerId : query.customerId;

    const where: Prisma.BookingWhereInput = {
      ...(scopedCustomerId ? { customerId: scopedCustomerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            preferredDate: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { bookingNumber: { contains: search, mode: 'insensitive' } },
              { customer: { user: { firstName: { contains: search, mode: 'insensitive' } } } },
              { customer: { user: { lastName: { contains: search, mode: 'insensitive' } } } },
              { customer: { user: { phone: { contains: search } } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt', 'preferredDate', 'status']),
        include: bookingInclude,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string, actor: AuthUser): Promise<unknown> {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: bookingInclude,
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (actor.role === Role.CUSTOMER) {
      this.assertOwns(actor.customerId, booking.customerId);
    }
    return booking;
  }

  private readonly allowedTransitions: Record<string, BookingStatus[]> = {
    [BookingStatus.REQUESTED]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
    [BookingStatus.CONFIRMED]: [BookingStatus.SCHEDULED, BookingStatus.CANCELLED],
    [BookingStatus.SCHEDULED]: [BookingStatus.ASSIGNED, BookingStatus.CANCELLED],
    [BookingStatus.ASSIGNED]: [BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED],
    [BookingStatus.IN_PROGRESS]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
    [BookingStatus.COMPLETED]: [],
    [BookingStatus.CANCELLED]: [],
  };

  async updateStatus(id: string, dto: UpdateBookingStatusDto, actor: AuthUser): Promise<unknown> {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (actor.role === Role.CUSTOMER) {
      // Customers may only cancel their own bookings, and only early on.
      this.assertOwns(actor.customerId, booking.customerId);
      if (dto.status !== BookingStatus.CANCELLED) {
        throw new ForbiddenException('Customers can only cancel bookings');
      }
      if (
        booking.status !== BookingStatus.REQUESTED &&
        booking.status !== BookingStatus.CONFIRMED
      ) {
        throw new BadRequestException('This booking can no longer be cancelled');
      }
    }

    if (!this.allowedTransitions[booking.status]?.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot change booking status from ${booking.status} to ${dto.status}`,
      );
    }
    if (dto.status === BookingStatus.CANCELLED && !dto.cancelReason && actor.role === Role.CUSTOMER) {
      throw new BadRequestException('cancelReason is required');
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: dto.status,
        confirmedAt: dto.status === BookingStatus.CONFIRMED ? new Date() : undefined,
        cancelledAt: dto.status === BookingStatus.CANCELLED ? new Date() : undefined,
        cancelReason: dto.status === BookingStatus.CANCELLED ? dto.cancelReason : undefined,
      },
      include: bookingInclude,
    });

    await this.audit.log({
      action: 'BOOKING_STATUS_CHANGED',
      module: 'bookings',
      entity: 'Booking',
      entityId: id,
      userId: actor.id,
      oldValues: { status: booking.status },
      newValues: { status: dto.status, cancelReason: dto.cancelReason },
    });

    const customerUser = await this.prisma.user.findUnique({
      where: { id: booking.customer.userId },
      select: { id: true },
    });
    if (customerUser) {
      const messages: Partial<Record<BookingStatus, [string, string, NotificationType]>> = {
        [BookingStatus.CONFIRMED]: [
          'Booking confirmed',
          `Your booking ${booking.bookingNumber} has been confirmed`,
          NotificationType.BOOKING_CONFIRMED,
        ],
        [BookingStatus.SCHEDULED]: [
          'Service scheduled',
          `Your service ${booking.bookingNumber} has been scheduled`,
          NotificationType.BOOKING_SCHEDULED,
        ],
        [BookingStatus.CANCELLED]: [
          'Booking cancelled',
          `Your booking ${booking.bookingNumber} has been cancelled`,
          NotificationType.GENERAL,
        ],
      };
      const message = messages[dto.status];
      if (message) {
        await this.notifications.notify({
          userId: customerUser.id,
          title: message[0],
          message: message[1],
          type: message[2],
          referenceType: 'booking',
          referenceId: booking.id,
        });
      }
    }

    return updated;
  }

  /** Internal status sync driven by work-order lifecycle (no notifications). */
  async syncStatus(bookingId: string, status: BookingStatus): Promise<void> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return;
    if (this.allowedTransitions[booking.status]?.includes(status)) {
      await this.prisma.booking.update({ where: { id: bookingId }, data: { status } });
    }
  }
}
