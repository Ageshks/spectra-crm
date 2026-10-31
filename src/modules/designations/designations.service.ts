import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateDesignationDto,
  ListDesignationsDto,
  UpdateDesignationDto,
} from './dto/designations.dto';

@Injectable()
export class DesignationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListDesignationsDto): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const where: Prisma.DesignationWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.designation.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt', 'name']),
        include: { _count: { select: { employees: true } } },
      }),
      this.prisma.designation.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async create(dto: CreateDesignationDto, actorId: string): Promise<unknown> {
    const name = dto.name.trim();
    const existing = await this.prisma.designation.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A designation with this name already exists');

    const designation = await this.prisma.designation.create({ data: { name } });
    await this.audit.log({
      action: 'CREATE_DESIGNATION',
      module: 'designations',
      entity: 'Designation',
      entityId: designation.id,
      userId: actorId,
      newValues: { name },
    });
    return designation;
  }

  async getById(id: string): Promise<unknown> {
    const designation = await this.prisma.designation.findUnique({
      where: { id },
      include: { _count: { select: { employees: true } } },
    });
    if (!designation) throw new NotFoundException('Designation not found');
    return designation;
  }

  async update(id: string, dto: UpdateDesignationDto, actorId: string, actorRole: Role): Promise<unknown> {
    if (actorRole === Role.MANAGER && dto.isActive === false) {
      throw new ForbiddenException('Only admins can deactivate designations');
    }
    const existing = await this.prisma.designation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Designation not found');
    const name = dto.name?.trim();
    if (name) {
      const duplicate = await this.prisma.designation.findFirst({
        where: { id: { not: id }, name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException('A designation with this name already exists');
    }
    const designation = await this.prisma.designation.update({
      where: { id },
      data: { ...(name ? { name } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
    });
    await this.audit.log({
      action: 'UPDATE_DESIGNATION',
      module: 'designations',
      entity: 'Designation',
      entityId: id,
      userId: actorId,
      oldValues: { name: existing.name, isActive: existing.isActive },
      newValues: dto as Prisma.InputJsonValue,
    });
    return designation;
  }

  async deactivate(id: string, actorId: string): Promise<unknown> {
    const existing = await this.prisma.designation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Designation not found');
    const designation = await this.prisma.designation.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      action: 'DEACTIVATE_DESIGNATION',
      module: 'designations',
      entity: 'Designation',
      entityId: id,
      userId: actorId,
    });
    return designation;
  }
}
