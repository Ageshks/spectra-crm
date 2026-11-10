import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpenseStatus, Prisma, Role } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { AuthUser } from '../../common/types/auth.types';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { CreateExpenseDto, ExpenseDecisionDto, ListExpensesDto } from './dto/expenses.dto';

const expenseInclude = {
  employee: {
    select: {
      id: true,
      employeeNo: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  reviewer: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ExpenseInclude;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
  ) {}

  async submit(dto: CreateExpenseDto, actor: AuthUser): Promise<unknown> {
    const employeeId = await this.attendance.resolveEmployeeId(actor);
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { companyId: true } });
    if (!employee || (actor.role !== Role.SUPER_ADMIN && employee.companyId !== actor.companyId)) throw new ForbiddenException('Employee is outside your company');
    const expenseDate = new Date(`${dto.expenseDate.slice(0, 10)}T00:00:00.000Z`);
    const expense = await this.prisma.expense.create({
      data: {
        employeeId,
        amount: new Prisma.Decimal(dto.amount.toFixed(2)),
        category: dto.category,
        expenseDate,
        description: dto.description,
        receiptUrl: dto.receiptUrl,
        status: ExpenseStatus.PENDING,
      },
      include: expenseInclude,
    });
    await this.audit.log({
      action: 'SUBMIT_EXPENSE',
      module: 'expenses',
      entity: 'Expense',
      entityId: expense.id,
      userId: actor.id,
      newValues: {
        amount: dto.amount.toFixed(2),
        category: dto.category,
        expenseDate: expenseDate.toISOString(),
      } as Prisma.InputJsonValue,
    });
    return expense;
  }

  async list(query: ListExpensesDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder } = normalizePagination(query);
    const and: Prisma.ExpenseWhereInput[] = [];
    if (actor.role !== Role.SUPER_ADMIN) and.push({ employee: { companyId: actor.companyId ?? '__none__' } });
    if (actor.role === Role.EMPLOYEE) {
      and.push({ employeeId: await this.attendance.resolveEmployeeId(actor) });
    }
    if (actor.role === Role.MANAGER) {
      and.push({ employee: { assignments: { some: { workOrder: { managerId: actor.managerId ?? '__none__' } } } } });
    }
    if (query.status) and.push({ status: query.status });
    if (query.dateFrom || query.dateTo) {
      and.push({
        expenseDate: {
          ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
        },
      });
    }
    const where: Prisma.ExpenseWhereInput = and.length ? { AND: and } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.expense.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['expenseDate', 'createdAt', 'status', 'amount']),
        include: expenseInclude,
      }),
      this.prisma.expense.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string, actor: AuthUser): Promise<unknown> {
    const expense = await this.prisma.expense.findUnique({ where: { id }, include: expenseInclude });
    if (!expense) throw new NotFoundException('Expense not found');
    if (actor.role === Role.EMPLOYEE) {
      const employeeId = await this.attendance.resolveEmployeeId(actor);
      if (expense.employeeId !== employeeId) {
        throw new ForbiddenException('You cannot access another employee expense');
      }
    }
    if (actor.role === Role.MANAGER && !await this.isInManagerTeam(expense.employeeId, actor.managerId)) {
      throw new ForbiddenException('You are not authorized to access this expense');
    }
    if (actor.role !== Role.SUPER_ADMIN && (await this.prisma.employee.findUnique({ where: { id: expense.employeeId }, select: { companyId: true } }))?.companyId !== actor.companyId) throw new ForbiddenException('Expense is outside your company');
    return expense;
  }

  async decide(id: string, dto: ExpenseDecisionDto, actor: AuthUser): Promise<unknown> {
    const existing = await this.prisma.expense.findUnique({ where: { id }, select: { employeeId: true } });
    if (!existing) throw new NotFoundException('Expense not found');
    if (actor.role === Role.MANAGER && !await this.isInManagerTeam(existing.employeeId, actor.managerId)) {
      throw new ForbiddenException('You are not authorized to decide this expense');
    }
    if (actor.role !== Role.SUPER_ADMIN && (await this.prisma.employee.findUnique({ where: { id: existing.employeeId }, select: { companyId: true } }))?.companyId !== actor.companyId) throw new ForbiddenException('Expense is outside your company');
    const result = await this.prisma.expense.updateMany({
      where: { id, status: ExpenseStatus.PENDING },
      data: {
        status: dto.decision,
        reviewerId: actor.id,
        reviewedAt: new Date(),
        reviewNote: dto.note,
      },
    });
    if (result.count === 0) {
      const expense = await this.prisma.expense.findUnique({ where: { id }, select: { status: true } });
      if (!expense) throw new NotFoundException('Expense not found');
      throw new BadRequestException(`Expense is already ${expense.status}`);
    }
    await this.audit.log({
      action: dto.decision === ExpenseStatus.APPROVED ? 'APPROVE_EXPENSE' : 'REJECT_EXPENSE',
      module: 'expenses',
      entity: 'Expense',
      entityId: id,
      userId: actor.id,
      newValues: { decision: dto.decision, note: dto.note } as Prisma.InputJsonValue,
    });
    return this.prisma.expense.findUnique({ where: { id }, include: expenseInclude });
  }

  private async isInManagerTeam(employeeId: string, managerId?: string): Promise<boolean> {
    if (!managerId) return false;
    const assignment = await this.prisma.workAssignment.findFirst({
      where: { employeeId, workOrder: { managerId } },
      select: { id: true },
    });
    return !!assignment;
  }
}
