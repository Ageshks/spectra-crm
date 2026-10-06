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
import { CreateManagerDto, ListManagersDto, UpdateManagerDto } from './dto/managers.dto';

const managerSelect = {
  id: true,
  title: true,
  joinedAt: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true,
      profilePhoto: true, isActive: true, lastLoginAt: true,
    },
  },
} satisfies Prisma.ManagerSelect;

@Injectable()
export class ManagersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListManagersDto): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const where: Prisma.ManagerWhereInput = search
      ? {
          OR: [
            { user: { firstName: { contains: search, mode: 'insensitive' } } },
            { user: { lastName: { contains: search, mode: 'insensitive' } } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { user: { phone: { contains: search } } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.manager.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt', 'joinedAt']),
        select: managerSelect,
      }),
      this.prisma.manager.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async create(dto: CreateManagerDto, actorId: string): Promise<unknown> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await hashPassword(dto.password);
    const manager = await this.prisma.manager.create({
      data: {
        title: dto.title,
        joinedAt: new Date(),
        user: {
          create: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            email,
            phone: dto.phone,
            passwordHash,
            role: Role.MANAGER,
            isVerified: true,
          },
        },
      },
      select: managerSelect,
    });

    await this.audit.log({
      action: 'CREATE_MANAGER',
      module: 'managers',
      entity: 'Manager',
      entityId: manager.id,
      userId: actorId,
      newValues: { email },
    });
    return manager;
  }

  async getById(id: string): Promise<unknown> {
    const manager = await this.prisma.manager.findUnique({ where: { id }, select: managerSelect });
    if (!manager) throw new NotFoundException('Manager not found');
    return manager;
  }

  async update(id: string, dto: UpdateManagerDto, actorId: string): Promise<unknown> {
    const manager = await this.prisma.manager.findUnique({ where: { id } });
    if (!manager) throw new NotFoundException('Manager not found');

    const { isActive, title, ...userFields } = dto;
    if (userFields.phone) {
      const clash = await this.prisma.user.findFirst({
        where: { phone: userFields.phone, NOT: { id: manager.userId } },
      });
      if (clash) throw new BadRequestException('Phone number is already in use');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: manager.userId },
        data: { ...userFields, isActive: isActive ?? undefined },
      }),
      this.prisma.manager.update({ where: { id }, data: { title: title ?? undefined } }),
    ]);

    await this.audit.log({
      action: 'UPDATE_MANAGER',
      module: 'managers',
      entity: 'Manager',
      entityId: id,
      userId: actorId,
      newValues: dto as Prisma.InputJsonValue,
    });
    return this.getById(id);
  }

  async setStatus(id: string, isActive: boolean, actorId: string): Promise<unknown> {
    const manager = await this.prisma.manager.findUnique({ where: { id } });
    if (!manager) throw new NotFoundException('Manager not found');
    await this.prisma.user.update({ where: { id: manager.userId }, data: { isActive } });
    await this.audit.log({
      action: isActive ? 'ACTIVATE_MANAGER' : 'DEACTIVATE_MANAGER',
      module: 'managers',
      entity: 'Manager',
      entityId: id,
      userId: actorId,
      newValues: { isActive },
    });
    return this.getById(id);
  }
}
