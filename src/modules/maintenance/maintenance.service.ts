import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MaintenanceFrequency, MaintenanceStatus, Prisma, Role } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { AuthUser } from '../../common/types/auth.types';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
  SortOrder,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateMaintenanceDto,
  ListMaintenanceDto,
  UpdateMaintenanceDto,
} from './dto/maintenance.dto';

const maintenanceInclude = {
  service: { select: { id: true, name: true } },
  serviceLocation: {
    select: { id: true, locationName: true, address: true, city: true },
  },
  customer: {
    select: {
      id: true,
      user: { select: { id: true, firstName: true, lastName: true, phone: true } },
    },
  },
} satisfies Prisma.MaintenanceScheduleInclude;

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertCustomer(dto: { customerId?: string }, actor: AuthUser): string {
    if (actor.role === Role.CUSTOMER) {
      const own = actor.customerId;
      if (!own) throw new BadRequestException('No customer profile for this user');
      if (dto.customerId && dto.customerId !== own) {
        throw new BadRequestException('You cannot manage another customer schedule');
      }
      return own;
    }
    if (!dto.customerId) throw new BadRequestException('customerId is required');
    return dto.customerId;
  }

  async create(dto: CreateMaintenanceDto, actor: AuthUser): Promise<unknown> {
    const customerId = this.assertCustomer(dto, actor);
    const service = await this.prisma.service.findUnique({ where: { id: dto.serviceId } });
    if (!service) throw new BadRequestException('Service does not exist');
    const address = await this.prisma.customerAddress.findFirst({
      where: { id: dto.serviceLocationId, customerId },
    });
    if (!address) {
      throw new BadRequestException('Service location does not belong to this customer');
    }
    const created = await this.prisma.maintenanceSchedule.create({
      data: {
        customerId,
        serviceId: dto.serviceId,
        serviceLocationId: dto.serviceLocationId,
        lastServiceDate: dto.lastServiceDate ? new Date(dto.lastServiceDate) : undefined,
        nextServiceDate: new Date(dto.nextServiceDate),
        frequency: dto.frequency,
        customIntervalDays: dto.customIntervalDays,
        reminderDaysBefore: dto.reminderDaysBefore ?? 3,
        status: MaintenanceStatus.ACTIVE,
      },
      include: maintenanceInclude,
    });
    await this.audit.log({
      action: 'CREATE_MAINTENANCE', module: 'maintenance',
      entity: 'MaintenanceSchedule', entityId: created.id, userId: actor.id,
    });
    return created;
  }

  async list(
    query: ListMaintenanceDto,
    actor: AuthUser,
  ): Promise<PaginatedResult<unknown>> {
    const page = normalizePagination(query);
    const { skip, take } = page;
    const and: Prisma.MaintenanceScheduleWhereInput[] = [];
    if (actor.role === Role.CUSTOMER) {
      and.push({ customerId: actor.customerId ?? '__none__' });
    } else {
      if (query.customerId) and.push({ customerId: query.customerId });
      if (query.serviceId) and.push({ serviceId: query.serviceId });
    }
    if (query.status) and.push({ status: query.status });
    return this.listFiltered(and, query, page);
  }

  private async listFiltered(
    and: Prisma.MaintenanceScheduleWhereInput[],
    query: ListMaintenanceDto,
    page_: ReturnType<typeof normalizePagination>,
  ): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = page_;
    const filters = [...and];
    if (query.dueFrom || query.dueTo) {
      filters.push({
        nextServiceDate: {
          ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
          ...(query.dueTo ? { lte: new Date(query.dueTo) } : {}),
        },
      });
    }
    const where: Prisma.MaintenanceScheduleWhereInput = {
      ...(filters.length ? { AND: filters } : {}),
      ...(search
        ? {
            OR: [
              { service: { name: { contains: search, mode: 'insensitive' } } },
              { serviceLocation: { locationName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.maintenanceSchedule.findMany({
        where, skip, take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['nextServiceDate', 'createdAt', 'status']),
        include: maintenanceInclude,
      }),
      this.prisma.maintenanceSchedule.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string, actor: AuthUser): Promise<unknown> {
    const row = await this.prisma.maintenanceSchedule.findUnique({
      where: { id }, include: maintenanceInclude,
    });
    if (!row) throw new NotFoundException('Maintenance schedule not found');
    if (actor.role === Role.CUSTOMER && row.customerId !== actor.customerId) {
      throw new NotFoundException('Maintenance schedule not found');
    }
    return row;
  }

  async update(id: string, dto: UpdateMaintenanceDto, actor: AuthUser): Promise<unknown> {
    const row = await this.prisma.maintenanceSchedule.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Maintenance schedule not found');
    if (actor.role === Role.CUSTOMER && row.customerId !== actor.customerId) {
      throw new NotFoundException('Maintenance schedule not found');
    }
    const updated = await this.prisma.maintenanceSchedule.update({
      where: { id },
      data: {
        lastServiceDate: dto.lastServiceDate ? new Date(dto.lastServiceDate) : undefined,
        nextServiceDate: dto.nextServiceDate ? new Date(dto.nextServiceDate) : undefined,
        frequency: dto.frequency,
        customIntervalDays: dto.customIntervalDays,
        reminderDaysBefore: dto.reminderDaysBefore,
        status: dto.status,
      },
      include: maintenanceInclude,
    });
    await this.audit.log({
      action: 'UPDATE_MAINTENANCE', module: 'maintenance',
      entity: 'MaintenanceSchedule', entityId: id, userId: actor.id,
    });
    return updated;
  }

  /** Schedules due within the next N days (role-scoped). */
  async upcoming(days: number, actor: AuthUser): Promise<unknown> {
    const clamped = Math.min(365, Math.max(1, Math.floor(days) || 30));
    const now = new Date();
    const horizon = new Date(now.getTime() + clamped * 24 * 60 * 60 * 1000);
    const where: Prisma.MaintenanceScheduleWhereInput = {
      status: MaintenanceStatus.ACTIVE,
      nextServiceDate: { gte: now, lte: horizon },
      ...(actor.role === Role.CUSTOMER ? { customerId: actor.customerId ?? '__none__' } : {}),
    };
    return this.prisma.maintenanceSchedule.findMany({
      where,
      orderBy: { nextServiceDate: 'asc' },
      take: 100,
      include: maintenanceInclude,
    });
  }

  /** Marks a visit complete: last = today, next rolled forward by frequency. */
  async complete(id: string, actor: AuthUser): Promise<unknown> {
    const row = await this.prisma.maintenanceSchedule.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Maintenance schedule not found');
    const today = new Date();
    const next = this.addFrequency(today, row.frequency, row.customIntervalDays ?? undefined);
    const updated = await this.prisma.maintenanceSchedule.update({
      where: { id },
      data: { lastServiceDate: today, nextServiceDate: next, status: MaintenanceStatus.ACTIVE },
      include: maintenanceInclude,
    });
    await this.audit.log({
      action: 'COMPLETE_MAINTENANCE', module: 'maintenance',
      entity: 'MaintenanceSchedule', entityId: id, userId: actor.id,
      newValues: { nextServiceDate: next.toISOString() },
    });
    return updated;
  }

  /** Rolls upcoming maintenance forward; used by the reminder worker + report approval. */
  advance(from: Date, frequency: MaintenanceFrequency, customDays?: number): Date {
    return this.addFrequency(from, frequency, customDays);
  }

  private addFrequency(from: Date, frequency: MaintenanceFrequency, customDays?: number): Date {
    const d = new Date(from);
    switch (frequency) {
      case MaintenanceFrequency.WEEKLY:
        d.setDate(d.getDate() + 7);
        break;
      case MaintenanceFrequency.MONTHLY:
        d.setMonth(d.getMonth() + 1);
        break;
      case MaintenanceFrequency.QUARTERLY:
        d.setMonth(d.getMonth() + 3);
        break;
      case MaintenanceFrequency.HALF_YEARLY:
        d.setMonth(d.getMonth() + 6);
        break;
      case MaintenanceFrequency.YEARLY:
        d.setFullYear(d.getFullYear() + 1);
        break;
      case MaintenanceFrequency.CUSTOM:
      default:
        d.setDate(d.getDate() + (customDays && customDays > 0 ? customDays : 30));
        break;
    }
    return d;
  }
}
