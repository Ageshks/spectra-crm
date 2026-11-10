import { ForbiddenException, Injectable } from '@nestjs/common';
import { ExpenseStatus, OvertimePaymentStatus, OvertimeStatus, Prisma, Role } from '@prisma/client';
import { AuthUser } from '../../common/types/auth.types';
import { PrismaService } from '../../database/prisma.service';
import { EarningsQueryDto } from './earnings.dto';

@Injectable()
export class EarningsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: EarningsQueryDto, actor: AuthUser): Promise<unknown> {
    const employeeIds = await this.resolveEmployeeScope(query.employeeId, actor);
    const dateFilter = query.month ? this.monthRange(query.month) : undefined;
    const employeeFilter = employeeIds ? { employeeId: { in: employeeIds } } : {};
    const [overtime, reimbursements] = await this.prisma.$transaction([
      this.prisma.overtime.aggregate({
        where: {
          ...employeeFilter,
          status: OvertimeStatus.APPROVED,
          paymentStatus: OvertimePaymentStatus.PAID,
          ...(dateFilter ? { paidAt: dateFilter } : {}),
        },
        _sum: { paymentAmount: true },
        _count: { id: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          ...employeeFilter,
          currency: 'INR',
          status: ExpenseStatus.APPROVED,
          ...(dateFilter ? { expenseDate: dateFilter } : {}),
        },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);
    const paidOvertime = overtime._sum.paymentAmount ?? new Prisma.Decimal(0);
    const approvedReimbursements = reimbursements._sum.amount ?? new Prisma.Decimal(0);
    return {
      employeeIds,
      month: query.month ?? null,
      currency: 'INR',
      paidOvertime: paidOvertime.toString(),
      approvedReimbursements: approvedReimbursements.toString(),
      total: paidOvertime.add(approvedReimbursements).toString(),
      counts: {
        paidOvertimeEntries: overtime._count.id,
        approvedExpenses: reimbursements._count.id,
      },
      basis: {
        overtime: 'Approved overtime with a recorded payment amount, grouped by paidAt.',
        reimbursements: 'Approved expenses grouped by expenseDate; approval does not mean paid.',
      },
    };
  }

  private async resolveEmployeeScope(employeeId: string | undefined, actor: AuthUser): Promise<string[] | null> {
    if (actor.role === Role.EMPLOYEE) {
      const employee = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
      if (!employee) throw new ForbiddenException('Employee profile not found');
      if (employeeId && employeeId !== employee.id) throw new ForbiddenException('You can only view your own earnings');
      return [employee.id];
    }
    if (actor.role === Role.MANAGER) {
      if (!actor.managerId) throw new ForbiddenException('Manager profile not found');
      if (employeeId) {
        const assignment = await this.prisma.workAssignment.findFirst({
          where: { employeeId, workOrder: { companyId: actor.companyId ?? '__none__', managerId: actor.managerId } },
          select: { id: true },
        });
        if (!assignment) throw new ForbiddenException('Employee is outside your authorized team');
        return [employeeId];
      }
      const employees = await this.prisma.employee.findMany({
        where: { companyId: actor.companyId ?? '__none__', assignments: { some: { workOrder: { companyId: actor.companyId ?? '__none__', managerId: actor.managerId } } } },
        select: { id: true },
        distinct: ['id'],
      });
      return employees.map((employee) => employee.id);
    }
    if (actor.role === Role.SUPER_ADMIN) return employeeId ? [employeeId] : null;
    if (employeeId) {
      const employee = await this.prisma.employee.findFirst({
        where: { id: employeeId, companyId: actor.companyId ?? '__none__' },
        select: { id: true },
      });
      if (!employee) throw new ForbiddenException('Employee is outside your company');
      return [employee.id];
    }
    const employees = await this.prisma.employee.findMany({
      where: { companyId: actor.companyId ?? '__none__' },
      select: { id: true },
    });
    return employees.map(({ id }) => id);
  }

  private monthRange(month: string): { gte: Date; lt: Date } {
    const [year, value] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, value - 1, 1));
    return { gte: start, lt: new Date(Date.UTC(year, value, 1)) };
  }
}
