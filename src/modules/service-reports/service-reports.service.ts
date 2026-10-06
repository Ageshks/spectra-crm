import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  MaintenanceFrequency,
  MaintenanceStatus,
  NotificationType,
  Prisma,
  Role,
  ServiceReportStatus,
  WorkOrderStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingsService } from '../bookings/bookings.service';
import { WorkOrderStatusService } from '../work-orders/work-order-status.service';
import {
  normalizePagination,
  paginated,
  PaginatedResult,
  safeOrderBy,
} from '../../common/utils/pagination.util';
import { SequenceService } from '../../common/sequence/sequence.module';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser } from '../../common/types/auth.types';
import {
  CreateServiceReportDto,
  ListServiceReportsDto,
  ReportDecisionDto,
  UpdateServiceReportDto,
} from './dto/service-reports.dto';
const reportInclude = {
  employee: {
    select: {
      id: true,
      employeeNo: true,
      user: { select: { id: true, firstName: true, lastName: true, profilePhoto: true } },
    },
  },
  reviewedBy: { select: { id: true, firstName: true, lastName: true } },
  workOrder: {
    include: {
      customer: { select: { id: true, userId: true, user: { select: { firstName: true, lastName: true } } } },
      service: { select: { id: true, name: true, requiresMaintenance: true, defaultMaintenanceFrequency: true } },
      serviceLocation: { select: { id: true, locationName: true, address: true, city: true } },
      assignments: { select: { employeeId: true } },
    },
  },
  photos: { select: { id: true, imageUrl: true, thumbnailUrl: true, caption: true } },
} satisfies Prisma.ServiceReportInclude;

@Injectable()
export class ServiceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly notifications: NotificationsService,
    private readonly bookings: BookingsService,
    private readonly statusService: WorkOrderStatusService,
  ) {}

  private async load(id: string): Promise<Prisma.ServiceReportGetPayload<{ include: typeof reportInclude }>> {
    const report = await this.prisma.serviceReport.findUnique({ where: { id }, include: reportInclude });
    if (!report) throw new NotFoundException('Service report not found');
    return report;
  }

  /** Ownership: employee can only touch own reports; customers only see APPROVED ones. */
  private assertAccess(report: Prisma.ServiceReportGetPayload<{ include: typeof reportInclude }>, actor: AuthUser): void {
    if (actor.role === Role.EMPLOYEE && report.employee.user.id !== actor.id) {
      throw new ForbiddenException('This report does not belong to you');
    }
    if (actor.role === Role.CUSTOMER) {
      // Rule #9: customers only ever see approved reports.
      if (report.workOrder.customerId !== actor.customerId) {
        throw new ForbiddenException('You are not allowed to access this report');
      }
      if (report.status !== ServiceReportStatus.APPROVED) {
        throw new ForbiddenException('Only approved reports are visible to customers');
      }
    }
  }

  private async requireAssignedEmployee(workOrderId: string, actor: AuthUser): Promise<string> {
    if (!actor.employeeId) throw new ForbiddenException('Employee profile required');
    const assignment = await this.prisma.workAssignment.findFirst({
      where: { workOrderId, employeeId: actor.employeeId },
    });
    if (!assignment) {
      throw new ForbiddenException('You are not assigned to this work order');
    }
    return actor.employeeId;
  }

  async list(
    query: ListServiceReportsDto,
    actor: AuthUser,
  ): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const and: Prisma.ServiceReportWhereInput[] = [];
    if (query.status) and.push({ status: query.status });
    if (query.workOrderId) and.push({ workOrderId: query.workOrderId });
    if (query.employeeId) and.push({ employeeId: query.employeeId });
    if (actor.role === Role.EMPLOYEE) {
      and.push({ employee: { userId: actor.id } });
    }
    if (actor.role === Role.CUSTOMER) {
      // Rule #9: customers only ever see approved reports of their own orders.
      and.push({ status: ServiceReportStatus.APPROVED });
      and.push({ workOrder: { customerId: actor.customerId ?? '__none__' } });
    }
    const where: Prisma.ServiceReportWhereInput = {
      ...(and.length ? { AND: and } : {}),
      ...(search
        ? {
            OR: [
              { reportNumber: { contains: search, mode: 'insensitive' } },
              { workSummary: { contains: search, mode: 'insensitive' } },
              { workOrder: { workOrderNumber: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.serviceReport.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt', 'submittedAt', 'status']),
        include: reportInclude,
      }),
      this.prisma.serviceReport.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async getById(id: string, actor: AuthUser): Promise<unknown> {
    const report = await this.load(id);
    this.assertAccess(report, actor);
    return report;
  }

  async create(dto: CreateServiceReportDto, actor: AuthUser): Promise<unknown> {
    const employeeId = await this.requireAssignedEmployee(dto.workOrderId, actor);
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id: dto.workOrderId } });
    if (!workOrder) throw new NotFoundException('Work order not found');
    if (
      workOrder.status !== WorkOrderStatus.COMPLETED &&
      workOrder.status !== WorkOrderStatus.UNDER_REVIEW &&
      workOrder.status !== WorkOrderStatus.CORRECTION_REQUIRED
    ) {
      throw new BadRequestException('A service report requires COMPLETED field work');
    }
    const existing = await this.prisma.serviceReport.findUnique({
      where: { workOrderId: workOrder.id },
    });
    if (existing) {
      throw new BadRequestException(`Report ${existing.reportNumber} already exists for this work order`);
    }

    const reportNumber = await this.sequences.next('REPORT');
    const report = await this.prisma.serviceReport.create({
      data: {
        reportNumber,
        workOrderId: workOrder.id,
        employeeId,
        workSummary: dto.workSummary,
        workPerformed: dto.workPerformed,
        issuesFound: dto.issuesFound,
        materialsUsed: dto.materialsUsed,
        recommendations: dto.recommendations,
        completionRemarks: dto.completionRemarks,
        status: ServiceReportStatus.DRAFT,
      },
      include: reportInclude,
    });

    await this.audit.log({
      action: 'CREATE_SERVICE_REPORT',
      module: 'service-reports',
      entity: 'ServiceReport',
      entityId: report.id,
      userId: actor.id,
      newValues: { reportNumber, workOrderId: workOrder.id },
    });

    if (dto.submit) {
      return this.submit(report.id, actor, {});
    }
    return report;
  }

  async update(id: string, dto: UpdateServiceReportDto, actor: AuthUser): Promise<unknown> {
    const report = await this.load(id);
    this.assertAccess(report, actor);
    if (actor.role === Role.EMPLOYEE && report.employee.user.id !== actor.id) {
      throw new ForbiddenException('This report does not belong to you');
    }
    if (
      report.status !== ServiceReportStatus.DRAFT &&
      report.status !== ServiceReportStatus.CORRECTION_REQUIRED
    ) {
      throw new BadRequestException(
        `A ${report.status} report can no longer be edited`,
      );
    }

    const updated = await this.prisma.serviceReport.update({
      where: { id },
      data: dto,
      include: reportInclude,
    });
    await this.audit.log({
      action: 'UPDATE_SERVICE_REPORT',
      module: 'service-reports',
      entity: 'ServiceReport',
      entityId: id,
      userId: actor.id,
      newValues: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  /** Employee submits (or resubmits after corrections) the report. */
  async submit(id: string, actor: AuthUser, dto: ReportDecisionDto): Promise<unknown> {
    const report = await this.load(id);
    this.assertAccess(report, actor);
    if (
      report.status !== ServiceReportStatus.DRAFT &&
      report.status !== ServiceReportStatus.CORRECTION_REQUIRED
    ) {
      throw new BadRequestException(`A ${report.status} report cannot be submitted`);
    }

    const wasCorrection = report.status === ServiceReportStatus.CORRECTION_REQUIRED;

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.serviceReport.update({
        where: { id },
        data: { status: ServiceReportStatus.SUBMITTED, submittedAt: new Date() },
        include: reportInclude,
      });

      // Move the work order into review using only valid transitions.
      if (report.workOrder.status === WorkOrderStatus.COMPLETED) {
        await this.statusService.applyWithExisting(
          report.workOrderId,
          WorkOrderStatus.COMPLETED,
          WorkOrderStatus.UNDER_REVIEW,
          { actorId: actor.id, note: 'Report submitted for review' },
          tx,
        );
      } else if (
        report.workOrder.status === WorkOrderStatus.CORRECTION_REQUIRED &&
        wasCorrection
      ) {
        await this.statusService.applyChain(
          report.workOrderId,
          [WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED, WorkOrderStatus.UNDER_REVIEW],
          { actorId: actor.id, note: dto.note ?? 'Correction submitted for re-review' },
          tx,
        );
      }
      return saved;
    });

    await this.audit.log({
      action: 'SUBMIT_SERVICE_REPORT',
      module: 'service-reports',
      entity: 'ServiceReport',
      entityId: id,
      userId: actor.id,
      oldValues: { status: report.status },
      newValues: { status: ServiceReportStatus.SUBMITTED },
    });

    const reviewers = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: [Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN] } },
      select: { id: true },
    });
    await this.notifications.notifyMany([
      ...reviewers.map((r) => ({
        userId: r.id,
        title: 'Report submitted',
        message: `Report ${report.reportNumber} awaits review`,
        type: NotificationType.REPORT_SUBMITTED as NotificationType,
        referenceType: 'serviceReport',
        referenceId: id,
      })),
      {
        userId: report.employee.user.id,
        title: wasCorrection ? 'Correction submitted' : 'Report submitted',
        message: `Your report ${report.reportNumber} has been submitted`,
        type: NotificationType.REPORT_SUBMITTED,
        referenceType: 'serviceReport',
        referenceId: id,
      },
    ]);

    return updated;
  }

  /** Manager approves a submitted report (rule #7). */
  async approve(id: string, actor: AuthUser, dto: ReportDecisionDto): Promise<unknown> {
    const report = await this.load(id);
    if (
      report.status !== ServiceReportStatus.SUBMITTED &&
      report.status !== ServiceReportStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException(`A ${report.status} report cannot be approved`);
    }
    if (report.workOrder.status !== WorkOrderStatus.UNDER_REVIEW) {
      throw new BadRequestException('The work order is not under review');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.serviceReport.update({
        where: { id },
        data: {
          status: ServiceReportStatus.APPROVED,
          reviewedAt: new Date(),
          reviewedById: actor.id,
        },
        include: reportInclude,
      });
      await this.statusService.applyWithExisting(
        report.workOrderId,
        WorkOrderStatus.UNDER_REVIEW,
        WorkOrderStatus.APPROVED,
        { actorId: actor.id, note: dto.note ?? 'Report approved' },
        tx,
      );
      return saved;
    });

    await this.bookings.syncStatus(report.workOrder.bookingId, BookingStatus.COMPLETED);

    // Roll the maintenance schedule forward when the service requires it.
    if (report.workOrder.service.requiresMaintenance) {
      await this.rollMaintenanceForward(report);
    }

    await this.audit.log({
      action: 'APPROVE_SERVICE_REPORT',
      module: 'service-reports',
      entity: 'ServiceReport',
      entityId: id,
      userId: actor.id,
      oldValues: { status: report.status },
      newValues: { status: ServiceReportStatus.APPROVED, note: dto.note },
    });

    await this.notifications.notifyMany([
      {
        userId: report.employee.user.id,
        title: 'Work approved',
        message: `Report ${report.reportNumber} has been approved`,
        type: NotificationType.WORK_APPROVED,
        referenceType: 'serviceReport',
        referenceId: id,
      },
      {
        userId: report.workOrder.customer.userId,
        title: 'Service report approved',
        message: `Your service report ${report.reportNumber} is now available`,
        type: NotificationType.REPORT_APPROVED,
        referenceType: 'serviceReport',
        referenceId: id,
      },
    ]);

    return updated;
  }

  /** Manager requests corrections (rule #8); employee gets a push notification. */
  async requestCorrection(id: string, actor: AuthUser, dto: ReportDecisionDto): Promise<unknown> {
    const report = await this.load(id);
    if (
      report.status !== ServiceReportStatus.SUBMITTED &&
      report.status !== ServiceReportStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException(`A ${report.status} report cannot be corrected`);
    }
    if (!dto.note) {
      throw new BadRequestException('A note describing the required correction is mandatory');
    }
    if (report.workOrder.status !== WorkOrderStatus.UNDER_REVIEW) {
      throw new BadRequestException('The work order is not under review');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.serviceReport.update({
        where: { id },
        data: {
          status: ServiceReportStatus.CORRECTION_REQUIRED,
          reviewedAt: new Date(),
          reviewedById: actor.id,
        },
        include: reportInclude,
      });
      await this.statusService.applyWithExisting(
        report.workOrderId,
        WorkOrderStatus.UNDER_REVIEW,
        WorkOrderStatus.CORRECTION_REQUIRED,
        { actorId: actor.id, note: dto.note },
        tx,
      );
      return saved;
    });

    await this.audit.log({
      action: 'REPORT_CORRECTION_REQUESTED',
      module: 'service-reports',
      entity: 'ServiceReport',
      entityId: id,
      userId: actor.id,
      oldValues: { status: report.status },
      newValues: { status: ServiceReportStatus.CORRECTION_REQUIRED, note: dto.note },
    });

    await this.notifications.notify({
      userId: report.employee.user.id,
      title: 'Correction requested',
      message: `Report ${report.reportNumber}: ${dto.note}`,
      type: NotificationType.REPORT_CORRECTION_REQUESTED,
      referenceType: 'serviceReport',
      referenceId: id,
    });

    return updated;
  }

  /** Roll maintenance forward: last = today, next = today + frequency. */
  private async rollMaintenanceForward(report: { workOrder: Record<string, unknown> } & Record<string, unknown>): Promise<void> {
    const wo = report.workOrder as unknown as {
      customerId: string;
      serviceId: string;
      serviceLocationId: string;
      service: { defaultMaintenanceFrequency?: MaintenanceFrequency | null };
    };
    const frequency = wo.service.defaultMaintenanceFrequency ?? MaintenanceFrequency.QUARTERLY;
    const last = new Date();
    const next = this.addFrequency(last, frequency);
    const existing = await this.prisma.maintenanceSchedule.findFirst({
      where: {
        customerId: wo.customerId,
        serviceId: wo.serviceId,
        serviceLocationId: wo.serviceLocationId,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      await this.prisma.maintenanceSchedule.update({
        where: { id: existing.id },
        data: {
          lastServiceDate: last,
          nextServiceDate: next,
          frequency,
          status: MaintenanceStatus.ACTIVE,
        },
      });
    } else {
      await this.prisma.maintenanceSchedule.create({
        data: {
          customerId: wo.customerId,
          serviceId: wo.serviceId,
          serviceLocationId: wo.serviceLocationId,
          lastServiceDate: last,
          nextServiceDate: next,
          frequency,
          status: MaintenanceStatus.ACTIVE,
        },
      });
    }
  }

  private addFrequency(from: Date, frequency: MaintenanceFrequency): Date {
    const d = new Date(from);
    switch (frequency) {
      case MaintenanceFrequency.WEEKLY:
        d.setDate(d.getDate() + 7);
        break;
      case MaintenanceFrequency.MONTHLY:
        d.setMonth(d.getMonth() + 1);
        break;
      case MaintenanceFrequency.HALF_YEARLY:
        d.setMonth(d.getMonth() + 6);
        break;
      case MaintenanceFrequency.YEARLY:
        d.setFullYear(d.getFullYear() + 1);
        break;
      case MaintenanceFrequency.CUSTOM:
        d.setMonth(d.getMonth() + 1);
        break;
      case MaintenanceFrequency.QUARTERLY:
      default:
        d.setMonth(d.getMonth() + 3);
        break;
    }
    return d;
  }
}
