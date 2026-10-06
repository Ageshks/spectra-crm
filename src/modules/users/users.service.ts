import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { normalizePagination, paginated, PaginatedResult, safeOrderBy } from '../../common/utils/pagination.util';
import { pickUser, SafeUser } from '../../common/utils/user.util';
import { PrismaService } from '../../database/prisma.service';
import { ListUsersDto, UpdateMeDto, UpdateUserStatusDto } from './dto/users.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersDto, actor: { id: string; role: Role }): Promise<PaginatedResult<SafeUser>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          }
        : {}),
      ...(actor.role === Role.SUPER_ADMIN ? {} : { role: { not: Role.SUPER_ADMIN } }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt', 'firstName', 'lastName', 'email', 'lastLoginAt']),
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true,
          role: true, profilePhoto: true, isActive: true, isVerified: true,
          lastLoginAt: true, createdAt: true, updatedAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginated(items as SafeUser[], page, limit, total);
  }

  async getById(id: string): Promise<SafeUser & Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true } },
        employee: { select: { id: true, employeeNo: true, designation: true, joiningDate: true } },
        manager: { select: { id: true, title: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { customer, employee, manager, ...safe } = user;
    return { ...pickUser(safe), customerId: customer?.id, employeeId: employee?.id, managerId: manager?.id };
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.phone) {
      const clash = await this.prisma.user.findFirst({
        where: { phone: dto.phone, NOT: { id: userId } },
      });
      if (clash) throw new BadRequestException('Phone number is already in use');
    }

    const updated = await this.prisma.user.update({ where: { id: userId }, data: dto });
    await this.audit.log({
      action: 'UPDATE_PROFILE',
      module: 'users',
      entity: 'User',
      entityId: userId,
      userId,
      oldValues: { firstName: user.firstName, lastName: user.lastName, phone: user.phone },
      newValues: dto as Prisma.InputJsonValue,
    });
    return pickUser(updated);
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto, actor: { id: string; role: Role }): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.id === actor.id) throw new BadRequestException('You cannot change your own account status');
    if (user.role === Role.SUPER_ADMIN && actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only a super admin can change a super admin account');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive: dto.isActive },
    });
    await this.audit.log({
      action: dto.isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      module: 'users',
      entity: 'User',
      entityId: id,
      userId: actor.id,
      oldValues: { isActive: user.isActive },
      newValues: { isActive: dto.isActive },
    });
    return pickUser(updated);
  }
}
