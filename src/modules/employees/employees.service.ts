import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, WorkAssignmentStatus, WorkOrderStatus } from '@prisma/client';
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
import { AuthUser } from '../../common/types/auth.types';
import { CreateEmployeeDto, ListEmployeesDto, UpdateEmployeeDto } from './dto/employees.dto';

const employeeSelect = {
  id: true,
  employeeNo: true,
  joiningDate: true,
  designationId: true,
  designation: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true,
      profilePhoto: true, isActive: true, isVerified: true, lastLoginAt: true, role: true,
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

  async list(query: ListEmployeesDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const where: Prisma.EmployeeWhereInput = {
      companyId: actor.role === Role.SUPER_ADMIN ? undefined : actor.companyId ?? '__none__',
      ...(actor.role === Role.MANAGER ? { assignments: { some: { workOrder: { managerId: actor.managerId ?? '__none__' } } } } : {}),
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

  async listTransferTargets(actor: AuthUser): Promise<unknown[]> {
    if (actor.role !== Role.EMPLOYEE || !actor.employeeId) {
      throw new ForbiddenException('An employee profile is required to list transfer targets');
    }

    const employees = await this.prisma.employee.findMany({
      where: {
        id: { not: actor.employeeId },
        companyId: actor.companyId ?? '__none__',
        user: { isActive: true },
        designationRecord: {
          is: { isActive: true, canUseFieldApp: true },
        },
      },
      select: {
        id: true,
        employeeNo: true,
        designation: true,
        designationRecord: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    });
    if (employees.length === 0) return [];

    const activeAssignments = await this.prisma.workAssignment.groupBy({
      by: ['employeeId'],
      where: {
        employeeId: { in: employees.map((employee) => employee.id) },
        status: {
          in: [
            WorkAssignmentStatus.ASSIGNED,
            WorkAssignmentStatus.ACCEPTED,
            WorkAssignmentStatus.IN_PROGRESS,
          ],
        },
        workOrder: {
          status: {
            in: [
              WorkOrderStatus.ASSIGNED,
              WorkOrderStatus.ACCEPTED,
              WorkOrderStatus.IN_PROGRESS,
              WorkOrderStatus.ON_HOLD,
              WorkOrderStatus.CORRECTION_REQUIRED,
            ],
          },
        },
      },
      _count: { _all: true },
    });
    const assignmentCounts = new Map(
      activeAssignments.map((row) => [row.employeeId, row._count._all]),
    );

    return employees.map((employee) => {
      const currentAssignmentCount = assignmentCounts.get(employee.id) ?? 0;
      const firstName = employee.user.firstName;
      const lastName = employee.user.lastName;
      return {
        id: employee.id,
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        designation: employee.designationRecord?.name ?? employee.designation,
        isAvailable: currentAssignmentCount === 0,
        availability: currentAssignmentCount === 0 ? 'AVAILABLE' : 'BUSY',
        currentAssignmentCount,
      };
    });
  }

  async create(dto: CreateEmployeeDto, actor: AuthUser): Promise<unknown> {
    const companyId = actor.role === Role.SUPER_ADMIN ? dto.companyId : actor.companyId;
    if (!companyId || !await this.prisma.company.findFirst({ where: { id: companyId, isActive: true }, select: { id: true } })) {
      throw new BadRequestException('An active company is required to create an employee');
    }
    if (actor.role !== Role.SUPER_ADMIN && dto.companyId && dto.companyId !== actor.companyId) {
      throw new ForbiddenException('You cannot create employees in another company');
    }
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    let designationId: string | undefined;
    let designation = dto.designation?.trim();
    if (dto.designationId) {
      const selectedDesignation = await this.prisma.designation.findFirst({
        where: { id: dto.designationId, isActive: true },
        select: { id: true, name: true },
      });
      if (!selectedDesignation) throw new BadRequestException('Designation does not exist or is inactive');
      designationId = selectedDesignation.id;
      designation = selectedDesignation.name;
    } else if (designation) {
      const matchingDesignation = await this.prisma.designation.findFirst({
        where: { name: { equals: designation, mode: 'insensitive' }, isActive: true },
        select: { id: true, name: true },
      });
      if (matchingDesignation) {
        designationId = matchingDesignation.id;
        designation = matchingDesignation.name;
      }
    }

    const employeeSequence = await this.sequences.next('EMP');
    const sequenceParts = employeeSequence.match(/^EMP-(\d{4})-(\d+)$/);
    if (!sequenceParts) throw new BadRequestException('Could not generate employee ID');
    const employeeNo = `${dto.employeeIdFormat ?? 'SGPLEMP'}${sequenceParts[1]}${sequenceParts[2]}`;
    const passwordHash = await hashPassword(dto.password);
    const managerDesignation = this.isManagerDesignation(designation);
    const employee = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email,
          phone: dto.phone,
          passwordHash,
          role: managerDesignation ? Role.MANAGER : Role.EMPLOYEE,
          company: { connect: { id: companyId } },
          isVerified: true,
        },
      });
      const createdEmployee = await tx.employee.create({
        data: {
          employeeNo,
          company: { connect: { id: companyId } },
          joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : undefined,
          designation,
          designationRecord: designationId ? { connect: { id: designationId } } : undefined,
          user: { connect: { id: user.id } },
        },
        select: employeeSelect,
      });
      if (managerDesignation) {
        await tx.manager.create({
          data: {
            user: { connect: { id: user.id } },
            company: { connect: { id: companyId } },
            title: designation,
            joinedAt: dto.joiningDate ? new Date(dto.joiningDate) : new Date(),
          },
        });
      }
      return createdEmployee;
    });

    await this.audit.log({
      action: 'CREATE_EMPLOYEE',
      module: 'employees',
      entity: 'Employee',
      entityId: employee.id,
      userId: actor.id,
      newValues: { email, employeeNo },
    });
    return employee;
  }

  async getById(id: string, actor?: AuthUser): Promise<unknown> {
    const employee = await this.prisma.employee.findFirst({
      where: { id, ...(actor && actor.role !== Role.SUPER_ADMIN ? { companyId: actor.companyId ?? '__none__' } : {}), ...(actor?.role === Role.MANAGER ? { assignments: { some: { workOrder: { managerId: actor.managerId ?? '__none__' } } } } : {}) },
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

  async update(id: string, dto: UpdateEmployeeDto, actor: AuthUser): Promise<unknown> {
    const employee = await this.prisma.employee.findFirst({
      where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) },
      include: { user: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const { isActive, joiningDate, designation: legacyDesignation, designationId, ...userFields } = dto;
    if (userFields.phone) {
      const clash = await this.prisma.user.findFirst({
        where: { phone: userFields.phone, NOT: { id: employee.userId } },
      });
      if (clash) throw new BadRequestException('Phone number is already in use');
    }

    let designation: string | undefined;
    let resolvedDesignationId: string | null | undefined;
    if (designationId) {
      const selectedDesignation = await this.prisma.designation.findFirst({
        where: { id: designationId, isActive: true },
        select: { id: true, name: true },
      });
      if (!selectedDesignation) throw new BadRequestException('Designation does not exist or is inactive');
      designation = selectedDesignation.name;
      resolvedDesignationId = selectedDesignation.id;
    } else if (legacyDesignation !== undefined) {
      designation = legacyDesignation.trim();
      const matchingDesignation = designation
        ? await this.prisma.designation.findFirst({
            where: { name: { equals: designation, mode: 'insensitive' }, isActive: true },
            select: { id: true, name: true },
          })
        : null;
      resolvedDesignationId = matchingDesignation?.id ?? null;
      if (matchingDesignation) designation = matchingDesignation.name;
    }

    const targetDesignation = designation === undefined ? employee.designation : designation;
    const managerDesignation = this.isManagerDesignation(targetDesignation);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: employee.userId },
        data: {
          ...userFields,
          isActive: isActive ?? undefined,
          ...(managerDesignation
            ? { role: Role.MANAGER }
            : employee.user.role === Role.MANAGER
              ? { role: Role.EMPLOYEE }
              : {}),
        },
      });
      await tx.employee.update({
        where: { id },
        data: {
          joiningDate: joiningDate ? new Date(joiningDate) : undefined,
          designation,
          designationId: resolvedDesignationId,
        },
      });
      if (managerDesignation) {
        await tx.manager.upsert({
          where: { userId: employee.userId },
          create: {
            userId: employee.userId,
            companyId: employee.companyId,
            title: targetDesignation,
            joinedAt: joiningDate ? new Date(joiningDate) : employee.joiningDate ?? new Date(),
          },
          update: { title: targetDesignation },
        });
      }
      // Keep an existing manager profile for historical work orders and attendance.
      // Its user role is changed above, so it no longer appears in the active manager list.
    });

    await this.audit.log({
      action: 'UPDATE_EMPLOYEE',
      module: 'employees',
      entity: 'Employee',
      entityId: id,
      userId: actor.id,
      newValues: dto as Prisma.InputJsonValue,
    });
    return this.getById(id, actor);
  }

  async setStatus(id: string, isActive: boolean, actor: AuthUser): Promise<unknown> {
    const employee = await this.prisma.employee.findFirst({ where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) } });
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
      userId: actor.id,
      newValues: { isActive },
    });
    return this.getById(id, actor);
  }

  private isManagerDesignation(value: string | null | undefined): boolean {
    return value?.trim().toLocaleLowerCase() === 'manager';
  }

  // ---------------------------------------------------------------
  // Employee-scoped operational views (admin / manager)
  // ---------------------------------------------------------------
  async remove(id: string, actor: AuthUser): Promise<unknown> {
    const existing = await this.prisma.employee.findFirst({
      where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) },
      include: {
        _count: {
          select: {
            assignments: true,
            transfersFrom: true,
            transfersTo: true,
            reports: true,
            attendances: true,
            overtimes: true,
            leaves: true,
          },
        },
      },
    });
    if (!existing) throw new NotFoundException('Employee not found');

    const references =
      existing._count.assignments +
      existing._count.transfersFrom +
      existing._count.transfersTo +
      existing._count.reports +
      existing._count.attendances +
      existing._count.overtimes +
      existing._count.leaves;

    if (references > 0) {
      await this.prisma.user.update({
        where: { id: existing.userId },
        data: { isActive: false },
      });
      await this.audit.log({
        action: 'DEACTIVATE_EMPLOYEE',
        module: 'employees',
        entity: 'Employee',
        entityId: id,
        userId: actor.id,
        oldValues: { isActive: true },
        newValues: { isActive: false },
      });
      return { id, deleted: false, deactivated: true };
    }

    await this.prisma.$transaction([
      this.prisma.employee.delete({ where: { id } }),
      this.prisma.user.delete({ where: { id: existing.userId } }),
    ]);
    await this.audit.log({
      action: 'DELETE_EMPLOYEE',
      module: 'employees',
      entity: 'Employee',
      entityId: id,
      userId: actor.id,
      oldValues: { employeeNo: existing.employeeNo },
    });
    return { id, deleted: true };
  }


  private async assertEmployeeAccessible(employeeId: string, actor: AuthUser): Promise<void> {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }),
        ...(actor.role === Role.MANAGER ? { assignments: { some: { workOrder: { managerId: actor.managerId ?? '__none__' } } } } : {}),
      },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  async assignedWork(employeeId: string, query: { page?: number; limit?: number }, actor: AuthUser): Promise<unknown> {
    await this.assertEmployeeAccessible(employeeId, actor);
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

  async attendance(employeeId: string, query: { page?: number; limit?: number; startDate?: string; endDate?: string }, actor: AuthUser): Promise<unknown> {
    await this.assertEmployeeAccessible(employeeId, actor);
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

  async overtimes(employeeId: string, query: { page?: number; limit?: number }, actor: AuthUser): Promise<unknown> {
    await this.assertEmployeeAccessible(employeeId, actor);
    const { skip, take, page, limit } = normalizePagination(query);
    const where: Prisma.OvertimeWhereInput = { employeeId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.overtime.findMany({ where, skip, take, orderBy: { date: 'desc' } }),
      this.prisma.overtime.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async leaves(employeeId: string, query: { page?: number; limit?: number }, actor: AuthUser): Promise<unknown> {
    await this.assertEmployeeAccessible(employeeId, actor);
    const { skip, take, page, limit } = normalizePagination(query);
    const where: Prisma.LeaveWhereInput = { employeeId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.leave.findMany({ where, skip, take, orderBy: { startDate: 'desc' } }),
      this.prisma.leave.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async reports(employeeId: string, query: { page?: number; limit?: number }, actor: AuthUser): Promise<unknown> {
    await this.assertEmployeeAccessible(employeeId, actor);
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
