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
import { AuthUser } from '../../common/types/auth.types';
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

  async list(query: ListManagersDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const where: Prisma.ManagerWhereInput = {
      companyId: actor.role === Role.SUPER_ADMIN ? undefined : actor.companyId ?? '__none__',
      user: {
        role: Role.MANAGER,
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
    };
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

  async create(dto: CreateManagerDto, actor: AuthUser): Promise<unknown> {
    const companyId = actor.role === Role.SUPER_ADMIN ? dto.companyId : actor.companyId;
    if (!companyId || !await this.prisma.company.findFirst({ where: { id: companyId, isActive: true }, select: { id: true } })) {
      throw new BadRequestException('An active company is required to create a manager');
    }
    if (actor.role !== Role.SUPER_ADMIN && dto.companyId && dto.companyId !== actor.companyId) {
      throw new BadRequestException('You cannot create managers in another company');
    }
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await hashPassword(dto.password);
    const manager = await this.prisma.manager.create({
      data: {
        title: dto.title,
        company: { connect: { id: companyId } },
        joinedAt: new Date(),
        user: {
          create: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            email,
            phone: dto.phone,
            passwordHash,
            role: Role.MANAGER,
            companyId,
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
      userId: actor.id,
      newValues: { email },
    });
    return manager;
  }

  async getById(id: string, actor?: AuthUser): Promise<unknown> {
    const manager = await this.prisma.manager.findFirst({ where: { id, ...(actor && actor.role !== Role.SUPER_ADMIN ? { companyId: actor.companyId ?? '__none__' } : {}) }, select: managerSelect });
    if (!manager) throw new NotFoundException('Manager not found');
    return manager;
  }

  async update(id: string, dto: UpdateManagerDto, actor: AuthUser): Promise<unknown> {
    const manager = await this.prisma.manager.findFirst({ where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) } });
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
      userId: actor.id,
      newValues: dto as Prisma.InputJsonValue,
    });
    return this.getById(id, actor);
  }

  async setStatus(id: string, isActive: boolean, actor: AuthUser): Promise<unknown> {
    const manager = await this.prisma.manager.findFirst({ where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) } });
    if (!manager) throw new NotFoundException('Manager not found');
    await this.prisma.user.update({ where: { id: manager.userId }, data: { isActive } });
    await this.audit.log({
      action: isActive ? 'ACTIVATE_MANAGER' : 'DEACTIVATE_MANAGER',
      module: 'managers',
      entity: 'Manager',
      entityId: id,
      userId: actor.id,
      newValues: { isActive },
    });
    return this.getById(id, actor);
  }
}
