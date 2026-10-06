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
import { SequenceService } from '../../common/sequence/sequence.module';
import { PrismaService } from '../../database/prisma.service';
import { CreateEmployeeDto, ListEmployeesDto, UpdateEmployeeDto } from './dto/employees.dto';

const employeeSelect = {
  id: true,
  employeeNo: true,
  joiningDate: true,
  designation: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true,
      profilePhoto: true, isActive: true, isVerified: true, lastLoginAt: true,
    },
  },
} satisfies Prisma.EmployeeSelect;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  async list(query: ListEmployeesDto): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const where: Prisma.EmployeeWhereInput = {
      ...(query.designation ? { designation: { equals: query.designation, mode: 'insensitive' } } : {}),
      ...(search
        ? {
            OR: [
              { user: { firstName: { contains: search, mode: 'insensitive' } } },
              { user: { lastName: { contains: search, mode: 'insensitive' } } },
              { user: { email: { contains: search, mode: 'insensitive' } } },
              { user: { phone: { contains: search } } },
              { employeeNo: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt', 'joiningDate']),
        select: employeeSelect,
      }),
      this.prisma.employee.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async create(dto: CreateEmployeeDto, actorId: string): Promise<unknown> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const employeeNo = await this.sequences.next('EMP');
    const passwordHash = await hashPassword(dto.password);
    const employee = await this.prisma.employee.create({
      data: {
        employeeNo,
        joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : undefined,
        designation: dto.designation,
        user: {
          create: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            email,
            phone: dto.phone,
            passwordHash,
            role: Role.EMPLOYEE,
            isVerified: true,
          },
        },
      },
      select: employeeSelect,
    });

    await this.audit.log({
      action: 'CREATE_EMPLOYEE',
      module: 'employees',
      entity: 'Employee',
      entityId: employee.id,
      userId: actorId,
      newValues: { email, employeeNo },
    });
    return employee;
  }

  async getById(id: string): Promise<unknown> {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      select: employeeSelect,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async getByUserId(userId: string): Promise<unknown> {
    const employee = await this.prisma.employee.findUnique({
      where: { userId },
      select: { ...employeeSelect, userId: true },
    });
    if (!employee) throw new NotFoundException('Employee profile not found');
    return employee;
  }

  async update(id: string, dto: UpdateEmployeeDto, actorId: string): Promise<unknown> {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const { isActive, joiningDate, designation, ...userFields } = dto;
    if (userFields.phone) {
      const clash = await this.prisma.user.findFirst({
        where: { phone: userFields.phone, NOT: { id: employee.userId } },
      });
      if (clash) throw new BadRequestException('Phone number is already in use');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: employee.userId },
        data: { ...userFields, isActive: isActive ?? undefined },
      }),
      this.prisma.employee.update({
        where: { id },
        data: {
          joiningDate: joiningDate ? new Date(joiningDate) : undefined,
          designation: designation ?? undefined,
        },
      }),
    ]);

    await this.audit.log({
      action: 'UPDATE_EMPLOYEE',
      module: 'employees',
      entity: 'Employee',
      entityId: id,
      userId: actorId,
      newValues: dto as Prisma.InputJsonValue,
    });
    return this.getById(id);
  }

  async setStatus(id: string, isActive: boolean, actorId: string): Promise<unknown> {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');
    await this.prisma.user.update({
      where: { id: employee.userId },
      data: { isActive },
    });
    await this.audit.log({
      action: isActive ? 'ACTIVATE_EMPLOYEE' : 'DEACTIVATE_EMPLOYEE',
      module: 'employees',
      entity: 'Employee',
      entityId: id,
      userId: actorId,
      newValues: { isActive },
    });
    return this.getById(id);
  }

  // ---------------------------------------------------------------
  // Employee-scoped operational views (admin / manager)
  // ---------------------------------------------------------------

  async assignedWork(employeeId: string, query: { page?: number; limit?: number }): Promise<unknown> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('Employee not found');
    const { skip, take, page, limit } = normalizePagination(query);
    const where: Prisma.WorkAssignmentWhereInput = { employeeId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workAssignment.findMany({
        where,
        skip,
        take,
        orderBy: { assignedAt: 'desc' },
        include: {
          workOrder: {
            include: {
              customer: { include: { user: { select: { firstName: true, lastName: true, phone: true } } } },
              service: { select: { id: true, name: true } },
              serviceLocation: { select: { id: true, locationName: true, address: true, city: true } },
            },
          },
        },
      }),
      this.prisma.workAssignment.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async attendance(employeeId: string, query: { page?: number; limit?: number; startDate?: string; endDate?: string }): Promise<unknown> {
    const { skip, take, page, limit } = normalizePagination(query);
    const where: Prisma.AttendanceWhereInput = {
      employeeId,
      ...(query.startDate || query.endDate
        ? {
            date: {
              ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
              ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({ where, skip, take, orderBy: { date: 'desc' } }),
      this.prisma.attendance.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async overtimes(employeeId: string, query: { page?: number; limit?: number }): Promise<unknown> {
    const { skip, take, page, limit } = normalizePagination(query);
    const where: Prisma.OvertimeWhereInput = { employeeId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.overtime.findMany({ where, skip, take, orderBy: { date: 'desc' } }),
      this.prisma.overtime.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async leaves(employeeId: string, query: { page?: number; limit?: number }): Promise<unknown> {
    const { skip, take, page, limit } = normalizePagination(query);
    const where: Prisma.LeaveWhereInput = { employeeId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.leave.findMany({ where, skip, take, orderBy: { startDate: 'desc' } }),
      this.prisma.leave.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async reports(employeeId: string, query: { page?: number; limit?: number }): Promise<unknown> {
    const { skip, take, page, limit } = normalizePagination(query);
    const where: Prisma.ServiceReportWhereInput = { employeeId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.serviceReport.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { workOrder: { select: { id: true, workOrderNumber: true, status: true } } },
      }),
      this.prisma.serviceReport.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }
}
