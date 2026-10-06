import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { hashPassword } from '../../common/utils/password.util';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateAddressDto,
  CreateCustomerDto,
  ListCustomersDto,
  UpdateAddressDto,
  UpdateCustomerDto,
} from './dto/customers.dto';

const customerInclude = {
  user: {
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true,
      profilePhoto: true, isActive: true, isVerified: true, lastLoginAt: true,
      createdAt: true, updatedAt: true, role: true,
    },
  },
  addresses: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.CustomerInclude;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCustomersDto): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const where: Prisma.CustomerWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(search
        ? {
            OR: [
              { user: { firstName: { contains: search, mode: 'insensitive' } } },
              { user: { lastName: { contains: search, mode: 'insensitive' } } },
              { user: { email: { contains: search, mode: 'insensitive' } } },
              { user: { phone: { contains: search } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt'], 'createdAt'),
        include: customerInclude,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async create(dto: CreateCustomerDto, actorId: string): Promise<unknown> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await hashPassword(dto.password);
    const customer = await this.prisma.customer.create({
      data: {
        notes: dto.notes,
        user: {
          create: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            email,
            phone: dto.phone,
            passwordHash,
            role: Role.CUSTOMER,
            isVerified: true,
          },
        },
        ...(dto.address ? { addresses: { create: dto.address } } : {}),
      },
      include: customerInclude,
    });

    await this.audit.log({
      action: 'CREATE_CUSTOMER',
      module: 'customers',
      entity: 'Customer',
      entityId: customer.id,
      userId: actorId,
      newValues: { email, firstName: dto.firstName, lastName: dto.lastName },
    });
    return customer;
  }

  async getById(id: string): Promise<unknown> {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: customerInclude,
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async getByUserId(userId: string): Promise<unknown> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      include: customerInclude,
    });
    if (!customer) throw new NotFoundException('Customer profile not found');
    return customer;
  }

  async updateByUserId(userId: string, dto: UpdateCustomerDto, actorId: string): Promise<unknown> {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundException('Customer profile not found');

    const { notes, ...userFields } = dto;
    if (userFields.phone) {
      const clash = await this.prisma.user.findFirst({
        where: { phone: userFields.phone, NOT: { id: userId } },
      });
      if (clash) throw new BadRequestException('Phone number is already in use');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: userFields }),
      this.prisma.customer.update({
        where: { id: customer.id },
        data: { notes: notes ?? undefined },
      }),
    ]);

    await this.audit.log({
      action: 'UPDATE_CUSTOMER',
      module: 'customers',
      entity: 'Customer',
      entityId: customer.id,
      userId: actorId,
      newValues: dto as Prisma.InputJsonValue,
    });
    return this.getByUserId(userId);
  }

  async updateAdmin(id: string, dto: UpdateCustomerDto, actorId: string): Promise<unknown> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    await this.updateByUserId(customer.userId, dto, actorId);
    return this.getById(id);
  }

  // ---------------------------------------------------------------
  // Service locations (multiple per customer)
  // ---------------------------------------------------------------

  private async resolveCustomerId(userId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer profile not found');
    return customer.id;
  }

  async listAddresses(userId: string): Promise<unknown> {
    const customerId = await this.resolveCustomerId(userId);
    return this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAddress(userId: string, dto: CreateAddressDto, actorId: string): Promise<unknown> {
    const customerId = await this.resolveCustomerId(userId);
    const address = await this.prisma.customerAddress.create({
      data: { ...dto, customerId },
    });
    await this.audit.log({
      action: 'CREATE_SERVICE_LOCATION',
      module: 'customers',
      entity: 'CustomerAddress',
      entityId: address.id,
      userId: actorId,
      newValues: { locationName: dto.locationName, city: dto.city },
    });
    return address;
  }

  async updateAddress(
    userId: string,
    addressId: string,
    dto: UpdateAddressDto,
    actorId: string,
  ): Promise<unknown> {
    const customerId = await this.resolveCustomerId(userId);
    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    if (!existing) throw new NotFoundException('Service location not found');
    const updated = await this.prisma.customerAddress.update({
      where: { id: addressId },
      data: dto,
    });
    await this.audit.log({
      action: 'UPDATE_SERVICE_LOCATION',
      module: 'customers',
      entity: 'CustomerAddress',
      entityId: addressId,
      userId: actorId,
      oldValues: { locationName: existing.locationName, isActive: existing.isActive },
      newValues: dto as Prisma.InputJsonValue,
    });
    return updated;
  }

  /** Soft delete: the location is deactivated to preserve booking history. */
  async deactivateAddress(userId: string, addressId: string, actorId: string): Promise<unknown> {
    const customerId = await this.resolveCustomerId(userId);
    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    if (!existing) throw new NotFoundException('Service location not found');
    const updated = await this.prisma.customerAddress.update({
      where: { id: addressId },
      data: { isActive: false },
    });
    await this.audit.log({
      action: 'DEACTIVATE_SERVICE_LOCATION',
      module: 'customers',
      entity: 'CustomerAddress',
      entityId: addressId,
      userId: actorId,
    });
    return updated;
  }

  // ---------------------------------------------------------------
  // Service history (customer scope — strictly own records)
  // ---------------------------------------------------------------

  async serviceHistory(userId: string, query: { page?: number; limit?: number }): Promise<unknown> {
    const customerId = await this.resolveCustomerId(userId);
    const { skip, take, page, limit } = normalizePagination(query);

    const where: Prisma.BookingWhereInput = { customerId };
    const [bookings, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        skip,
        take,
        orderBy: { preferredDate: 'desc' },
        select: {
          id: true,
          bookingNumber: true,
          preferredDate: true,
          preferredTime: true,
          status: true,
          remarks: true,
          createdAt: true,
          service: { select: { id: true, name: true, image: true, basePrice: true, requiresMaintenance: true } },
          serviceLocation: { select: { id: true, locationName: true, address: true, city: true } },
          workOrder: {
            select: {
              id: true,
              workOrderNumber: true,
              status: true,
              priority: true,
              scheduledDate: true,
              scheduledStartTime: true,
              scheduledEndTime: true,
              completedAt: true,
              assignments: {
                select: {
                  status: true,
                  employee: {
                    select: { user: { select: { firstName: true, lastName: true, profilePhoto: true } } },
                  },
                },
              },
              serviceReport: {
                select: {
                  id: true,
                  reportNumber: true,
                  status: true,
                  submittedAt: true,
                  reviewedAt: true,
                  workSummary: true,
                  recommendations: true,
                  completionRemarks: true,
                  photos: { select: { id: true, imageUrl: true, thumbnailUrl: true, caption: true } },
                },
              },
              photos: {
                where: { serviceReportId: null },
                select: { id: true, imageUrl: true, thumbnailUrl: true, caption: true },
              },
            },
          },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    // Business rule #9: customers only ever see APPROVED reports.
    const data = await Promise.all(
      bookings.map(async (booking) => {
        const workOrder = booking.workOrder;
        const approvedReport =
          workOrder?.serviceReport && workOrder.serviceReport.status === 'APPROVED'
            ? workOrder.serviceReport
            : null;
        const maintenance = await this.prisma.maintenanceSchedule.findFirst({
          where: { customerId, serviceId: booking.service.id },
          orderBy: { nextServiceDate: 'asc' },
          select: { id: true, nextServiceDate: true, frequency: true, status: true },
        });
        const workDone =
          workOrder &&
          ['COMPLETED', 'UNDER_REVIEW', 'APPROVED', 'CORRECTION_REQUIRED'].includes(workOrder.status);
        return {
          booking,
          workOrder: workOrder
            ? {
                id: workOrder.id,
                workOrderNumber: workOrder.workOrderNumber,
                status: workOrder.status,
                priority: workOrder.priority,
                scheduledDate: workOrder.scheduledDate,
                scheduledStartTime: workOrder.scheduledStartTime,
                scheduledEndTime: workOrder.scheduledEndTime,
                completedAt: workOrder.completedAt,
                technicians: workOrder.assignments.map((a) => a.employee.user),
                photos: workDone
                  ? [...workOrder.photos, ...(approvedReport?.photos ?? [])]
                  : [],
              }
            : null,
          serviceReport: approvedReport,
          nextMaintenance: maintenance,
        };
      }),
    );

    return paginated(data, page, limit, total);
  }
}
