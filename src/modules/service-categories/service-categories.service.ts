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
import {
  CreateCategoryDto,
  ListCategoriesDto,
  UpdateCategoryDto,
} from './dto/service-categories.dto';

@Injectable()
export class ServiceCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCategoriesDto): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const where: Prisma.ServiceCategoryWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.companySlug ? { company: { slug: query.companySlug } } : { company: { slug: 'default' } }),
      ...(search
        ? { name: { contains: search, mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.serviceCategory.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt', 'name']),
        include: { _count: { select: { services: true } } },
      }),
      this.prisma.serviceCategory.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async create(dto: CreateCategoryDto, actor: AuthUser): Promise<unknown> {
    const companyId = actor.role === Role.SUPER_ADMIN ? dto.companyId ?? actor.companyId : actor.companyId;
    if (!companyId) throw new BadRequestException('companyId is required');
    if (actor.role !== Role.SUPER_ADMIN && dto.companyId && dto.companyId !== actor.companyId) throw new BadRequestException('Cross-company catalog access is not allowed');
    const category = await this.prisma.serviceCategory.create({ data: { ...dto, companyId } });
    await this.audit.log({
      action: 'CREATE_CATEGORY',
      module: 'services',
      entity: 'ServiceCategory',
      entityId: category.id,
      userId: actor.id,
      newValues: { name: dto.name },
    });
    return category;
  }

  async getById(id: string, actor?: AuthUser): Promise<unknown> {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { id, ...(actor && actor.role !== Role.SUPER_ADMIN ? { companyId: actor.companyId ?? '__none__' } : {}) },
      include: { _count: { select: { services: true } } },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto, actor: AuthUser): Promise<unknown> {
    const existing = await this.prisma.serviceCategory.findFirst({ where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) } });
    if (!existing) throw new NotFoundException('Category not found');
    const category = await this.prisma.serviceCategory.update({ where: { id }, data: dto });
    await this.audit.log({
      action: 'UPDATE_CATEGORY',
      module: 'services',
      entity: 'ServiceCategory',
      entityId: id,
      userId: actor.id,
      oldValues: { name: existing.name, isActive: existing.isActive },
      newValues: dto as Prisma.InputJsonValue,
    });
    return category;
  }

  /** Deletion is a soft deactivation to keep historical relations intact. */
  async deactivate(id: string, actor: AuthUser): Promise<unknown> {
    const existing = await this.prisma.serviceCategory.findFirst({ where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) } });
    if (!existing) throw new NotFoundException('Category not found');
    const category = await this.prisma.serviceCategory.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      action: 'DEACTIVATE_CATEGORY',
      module: 'services',
      entity: 'ServiceCategory',
      entityId: id,
      userId: actor.id,
    });
    return category;
  }
}
