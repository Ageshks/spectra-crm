import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuthUser } from '../../common/types/auth.types';
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
      company: { slug: query.companySlug ?? 'default' },
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
        select: {
          id: true, companyId: true, categoryId: true, name: true, description: true, image: true,
          estimatedDuration: true, basePrice: true, requiresMaintenance: true,
          defaultMaintenanceFrequency: true, isActive: true, createdAt: true, updatedAt: true,
          category: { select: { id: true, name: true } },
        },
      }),
      this.prisma.service.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string, actor?: AuthUser): Promise<unknown> {
    const service = await this.prisma.service.findFirst({
      where: { id, ...(actor && actor.role !== Role.SUPER_ADMIN ? { companyId: actor.companyId ?? '__none__' } : {}) },
      include: { category: { select: { id: true, name: true, image: true } } },
    });
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }

  async create(dto: CreateServiceDto, actor: AuthUser): Promise<unknown> {
    const companyId = actor.role === Role.SUPER_ADMIN ? dto.companyId ?? actor.companyId : actor.companyId;
    if (!companyId) throw new BadRequestException('companyId is required');
    if (actor.role !== Role.SUPER_ADMIN && dto.companyId && dto.companyId !== actor.companyId) throw new BadRequestException('Cross-company catalog access is not allowed');
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) throw new BadRequestException('Category does not exist');
    if (category.companyId !== companyId) throw new BadRequestException('Category belongs to another company');

    const service = await this.prisma.service.create({
      data: {
        companyId,
        name: dto.name,
        categoryId: dto.categoryId,
        description: dto.description,
        image: dto.image,
        estimatedDuration: dto.estimatedDuration,
        basePrice: dto.basePrice,
        gstRate: dto.gstRate ?? 0,
        gstInclusive: dto.gstInclusive ?? false,
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
      userId: actor.id,
      newValues: { name: dto.name, basePrice: dto.basePrice },
    });
    return service;
  }

  async update(id: string, dto: UpdateServiceDto, actor: AuthUser): Promise<unknown> {
    const existing = await this.prisma.service.findFirst({ where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) } });
    if (!existing) throw new NotFoundException('Service not found');
    if (dto.categoryId) {
      const category = await this.prisma.serviceCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) throw new BadRequestException('Category does not exist');
      if (category.companyId !== existing.companyId) throw new BadRequestException('Category belongs to another company');
    }

    const service = await this.prisma.service.update({
      where: { id },
      data: {
        ...dto,
        estimatedDuration: dto.estimatedDuration ?? undefined,
        basePrice: dto.basePrice ?? undefined,
        gstRate: dto.gstRate ?? undefined,
        gstInclusive: dto.gstInclusive ?? undefined,
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
      userId: actor.id,
      oldValues: {
        name: existing.name,
        isActive: existing.isActive,
        basePrice: Number(existing.basePrice),
      },
      newValues: dto as Prisma.InputJsonValue,
    });
    return service;
  }

  async setStatus(id: string, isActive: boolean, actor: AuthUser): Promise<unknown> {
    const existing = await this.prisma.service.findFirst({ where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) } });
    if (!existing) throw new NotFoundException('Service not found');
    const service = await this.prisma.service.update({ where: { id }, data: { isActive } });
    await this.audit.log({
      action: isActive ? 'ACTIVATE_SERVICE' : 'DEACTIVATE_SERVICE',
      module: 'services',
      entity: 'Service',
      entityId: id,
      userId: actor.id,
      newValues: { isActive },
    });
    return service;
  }

  /** Hard delete only when nothing references the service; otherwise deactivate. */
  async remove(id: string, actor: AuthUser): Promise<unknown> {
    const existing = await this.prisma.service.findFirst({
      where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) },
      include: { _count: { select: { bookings: true, workOrders: true, maintenanceSchedules: true } } },
    });
    if (!existing) throw new NotFoundException('Service not found');
    const references =
      existing._count.bookings + existing._count.workOrders + existing._count.maintenanceSchedules;
    if (references > 0) {
      await this.setStatus(id, false, actor);
      return { id, deleted: false, deactivated: true };
    }
    await this.prisma.service.delete({ where: { id } });
    await this.audit.log({
      action: 'DELETE_SERVICE',
      module: 'services',
      entity: 'Service',
      entityId: id,
      userId: actor.id,
      oldValues: { name: existing.name },
    });
    return { id, deleted: true };
  }
}
