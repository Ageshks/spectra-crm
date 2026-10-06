import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { CreateServiceDto, ListServicesDto, UpdateServiceDto } from './dto/services.dto';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListServicesDto): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const where: Prisma.ServiceWhereInput = {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt', 'name', 'basePrice']),
        include: { category: { select: { id: true, name: true } } },
      }),
      this.prisma.service.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string): Promise<unknown> {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: { category: { select: { id: true, name: true, image: true } } },
    });
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }

  async create(dto: CreateServiceDto, actorId: string): Promise<unknown> {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) throw new BadRequestException('Category does not exist');

    const service = await this.prisma.service.create({
      data: {
        name: dto.name,
        categoryId: dto.categoryId,
        description: dto.description,
        image: dto.image,
        estimatedDuration: dto.estimatedDuration,
        basePrice: dto.basePrice,
        requiresMaintenance: dto.requiresMaintenance ?? false,
        defaultMaintenanceFrequency: dto.defaultMaintenanceFrequency ?? null,
        isActive: dto.isActive ?? true,
      },
      include: { category: { select: { id: true, name: true } } },
    });

    await this.audit.log({
      action: 'CREATE_SERVICE',
      module: 'services',
      entity: 'Service',
      entityId: service.id,
      userId: actorId,
      newValues: { name: dto.name, basePrice: dto.basePrice },
    });
    return service;
  }

  async update(id: string, dto: UpdateServiceDto, actorId: string): Promise<unknown> {
    const existing = await this.prisma.service.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Service not found');
    if (dto.categoryId) {
      const category = await this.prisma.serviceCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) throw new BadRequestException('Category does not exist');
    }

    const service = await this.prisma.service.update({
      where: { id },
      data: {
        ...dto,
        basePrice: dto.basePrice ?? undefined,
        defaultMaintenanceFrequency:
          dto.defaultMaintenanceFrequency === null
            ? null
            : (dto.defaultMaintenanceFrequency ?? undefined),
      },
      include: { category: { select: { id: true, name: true } } },
    });

    await this.audit.log({
      action: 'UPDATE_SERVICE',
      module: 'services',
      entity: 'Service',
      entityId: id,
      userId: actorId,
      oldValues: {
        name: existing.name,
        isActive: existing.isActive,
        basePrice: Number(existing.basePrice),
      },
      newValues: dto as Prisma.InputJsonValue,
    });
    return service;
  }

  async setStatus(id: string, isActive: boolean, actorId: string): Promise<unknown> {
    const existing = await this.prisma.service.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Service not found');
    const service = await this.prisma.service.update({ where: { id }, data: { isActive } });
    await this.audit.log({
      action: isActive ? 'ACTIVATE_SERVICE' : 'DEACTIVATE_SERVICE',
      module: 'services',
      entity: 'Service',
      entityId: id,
      userId: actorId,
      newValues: { isActive },
    });
    return service;
  }

  /** Hard delete only when nothing references the service; otherwise deactivate. */
  async remove(id: string, actorId: string): Promise<unknown> {
    const existing = await this.prisma.service.findUnique({
      where: { id },
      include: { _count: { select: { bookings: true, workOrders: true, maintenanceSchedules: true } } },
    });
    if (!existing) throw new NotFoundException('Service not found');
    const references =
      existing._count.bookings + existing._count.workOrders + existing._count.maintenanceSchedules;
    if (references > 0) {
      await this.setStatus(id, false, actorId);
      return { id, deleted: false, deactivated: true };
    }
    await this.prisma.service.delete({ where: { id } });
    await this.audit.log({
      action: 'DELETE_SERVICE',
      module: 'services',
      entity: 'Service',
      entityId: id,
      userId: actorId,
      oldValues: { name: existing.name },
    });
    return { id, deleted: true };
  }
}
