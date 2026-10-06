import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  async create(dto: CreateCategoryDto, actorId: string): Promise<unknown> {
    const category = await this.prisma.serviceCategory.create({ data: dto });
    await this.audit.log({
      action: 'CREATE_CATEGORY',
      module: 'services',
      entity: 'ServiceCategory',
      entityId: category.id,
      userId: actorId,
      newValues: { name: dto.name },
    });
    return category;
  }

  async getById(id: string): Promise<unknown> {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id },
      include: { _count: { select: { services: true } } },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto, actorId: string): Promise<unknown> {
    const existing = await this.prisma.serviceCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');
    const category = await this.prisma.serviceCategory.update({ where: { id }, data: dto });
    await this.audit.log({
      action: 'UPDATE_CATEGORY',
      module: 'services',
      entity: 'ServiceCategory',
      entityId: id,
      userId: actorId,
      oldValues: { name: existing.name, isActive: existing.isActive },
      newValues: dto as Prisma.InputJsonValue,
    });
    return category;
  }

  /** Deletion is a soft deactivation to keep historical relations intact. */
  async deactivate(id: string, actorId: string): Promise<unknown> {
    const existing = await this.prisma.serviceCategory.findUnique({ where: { id } });
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
      userId: actorId,
    });
    return category;
  }
}
