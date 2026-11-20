import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
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
import { LocalWorkPhotoStorageService } from '../../common/uploads/uploads.module';
import {
  CreateServiceReportDto,
  CreateReportLocationDto,
  ListServiceReportsDto,
  ReportDecisionDto,
  ReviewServiceReportUpdateDto,
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
  locations: {
    orderBy: { recordedAt: 'asc' },
    select: { id: true, latitude: true, longitude: true, capturedAt: true, recordedAt: true },
  },
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
    private readonly photoStorage: LocalWorkPhotoStorageService,
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
    if (actor.role === Role.MANAGER && report.workOrder.managerId !== actor.managerId) {
      throw new ForbiddenException('You are not authorized to access this report');
    }
    if (actor.role !== Role.SUPER_ADMIN && report.workOrder.companyId !== actor.companyId) {
      throw new ForbiddenException('Report is outside your company');
    }
  }

  private async requireAssignedEmployee(workOrderId: string, actor: AuthUser): Promise<string> {
    const employee = await this.prisma.employee.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    });
    if (!employee) throw new ForbiddenException('Employee profile required for this account');
    const assignment = await this.prisma.workAssignment.findFirst({
      where: { workOrderId, employeeId: employee.id },
    });
    if (!assignment) {
      throw new ForbiddenException('You are not assigned to this work order');
    }
    return employee.id;
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
    if (actor.role === Role.MANAGER) {
      and.push({ workOrder: { managerId: actor.managerId ?? '__none__' } });
    }
    if (actor.role !== Role.SUPER_ADMIN) and.push({ workOrder: { companyId: actor.companyId ?? '__none__' } });
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

  async getPdf(id: string, actor: AuthUser): Promise<{ fileName: string; content: Buffer }> {
    const report = await this.load(id);
    this.assertAccess(report, actor);
    const photoRows = report.photos.length
      ? await this.prisma.workPhoto.findMany({
          where: { id: { in: report.photos.map((photo) => photo.id) } },
          select: {
            id: true,
            imageUrl: true,
            content: { select: { imageData: true } },
          },
        })
      : [];
    const photos = await Promise.all(report.photos.map(async (photo) => {
      const stored = photoRows.find((row) => row.id === photo.id);
      const source = stored?.content?.imageData
        ? Buffer.from(stored.content.imageData)
        : stored ? await this.photoStorage.read(stored.imageUrl) : null;
      if (!source) return null;
      const { data, info } = await sharp(source)
        .rotate()
        .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 76, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      return { caption: photo.caption || 'Work photo', imageData: data, width: info.width, height: info.height };
    }));
    const customerUser = report.workOrder.customer.user;
    const customer = [customerUser?.firstName, customerUser?.lastName]
      .filter(Boolean).join(' ');
    const technician = [report.employee.user.firstName, report.employee.user.lastName]
      .filter(Boolean).join(' ');
    const location = report.workOrder.serviceLocation;
    const lines = [
      `SERVICE REPORT: ${report.reportNumber}`,
      `Status: ${report.status}`,
      `Work order: ${report.workOrder.workOrderNumber}`,
      `Work order status: ${report.workOrder.status}`,
      `Priority: ${report.workOrder.priority}`,
      `Customer: ${customer || 'Not provided'}`,
      `Technician: ${technician || 'Not provided'} (${report.employee.employeeNo})`,
      `Service: ${report.workOrder.service.name}`,
      `Location: ${[location?.locationName, location?.address, location?.city].filter(Boolean).join(', ') || 'Not provided'}`,
      `Scheduled: ${report.workOrder.scheduledDate?.toISOString().slice(0, 10) ?? 'Not scheduled'} ${[report.workOrder.scheduledStartTime, report.workOrder.scheduledEndTime].filter(Boolean).join(' - ')}`,
      `Work completed: ${report.workOrder.completedAt?.toISOString() ?? 'Not recorded'}`,
      `Instructions: ${report.workOrder.instructions || '—'}`,
      `Submitted: ${report.submittedAt?.toISOString() ?? 'Not submitted'}`,
      `Last updated: ${report.updatedAt.toISOString()}`,
      `Reviewed: ${report.reviewedAt?.toISOString() ?? 'Not reviewed'}`,
      `Reviewed by: ${[report.reviewedBy?.firstName, report.reviewedBy?.lastName].filter(Boolean).join(' ') || 'Not reviewed'}`,
      '',
      'WORK SUMMARY', report.workSummary || '—',
      '', 'WORK PERFORMED', report.workPerformed || '—',
      '', 'ISSUES FOUND', report.issuesFound || '—',
      '', 'MATERIALS USED', report.materialsUsed || '—',
      '', 'RECOMMENDATIONS', report.recommendations || '—',
      '', 'COMPLETION REMARKS', report.completionRemarks || '—',
      '', 'ATTACHED PHOTOS',
      ...(report.photos.length ? report.photos.map((photo, index) =>
        `${index + 1}. ${photo.caption || 'Work photo'}`) : ['No photos attached']),
      '', 'RECORDED LOCATIONS',
      ...(report.locations.length ? report.locations.map((point, index) =>
        `${index + 1}. ${point.latitude}, ${point.longitude} at ${(point.capturedAt ?? point.recordedAt).toISOString()}`) : ['No locations recorded']),
    ];
    return {
      fileName: `${report.reportNumber || 'service-report'}.pdf`,
      content: this.buildReportPdf(lines, photos.filter((photo): photo is NonNullable<typeof photo> => photo !== null)),
    };
  }

  async create(dto: CreateServiceReportDto, actor: AuthUser): Promise<unknown> {
    const employeeId = await this.requireAssignedEmployee(dto.workOrderId, actor);
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id: dto.workOrderId } });
    if (!workOrder) throw new NotFoundException('Work order not found');
    if (workOrder.companyId !== actor.companyId) throw new ForbiddenException('Work order is outside your company');
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
        workSummary: dto.workSummary ?? '',
        workPerformed: dto.workPerformed ?? '',
        issuesFound: dto.issuesFound,
        materialsUsed: dto.materialsUsed,
        recommendations: dto.recommendations,
        completionRemarks: dto.completionRemarks,
        status: ServiceReportStatus.DRAFT,
      },
      include: reportInclude,
    });
    await this.prisma.workPhoto.updateMany({
      where: { workOrderId: workOrder.id, serviceReportId: null },
      data: { serviceReportId: report.id },
    });
    const reportPhotos = await this.prisma.workPhoto.findMany({
      where: { serviceReportId: report.id },
      select: { id: true, imageUrl: true, thumbnailUrl: true, caption: true },
    });
    const reportWithPhotos = { ...report, photos: reportPhotos };

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
    return reportWithPhotos;
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

  async editInReview(
    id: string,
    dto: ReviewServiceReportUpdateDto,
    actor: AuthUser,
  ): Promise<unknown> {
    const reviewerRoles: Role[] = [Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN];
    if (!reviewerRoles.includes(actor.role)) {
      throw new ForbiddenException('Only reviewers can edit a submitted report');
    }
    const report = await this.load(id);
    this.assertAccess(report, actor);
    if (
      report.status !== ServiceReportStatus.SUBMITTED &&
      report.status !== ServiceReportStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException('Only submitted reports awaiting review can be edited');
    }
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Provide at least one report field to update');
    }
    const updated = await this.prisma.serviceReport.update({
      where: { id },
      data: dto,
      include: reportInclude,
    });
    await this.audit.log({
      action: 'EDIT_SERVICE_REPORT_DURING_REVIEW',
      module: 'service-reports',
      entity: 'ServiceReport',
      entityId: id,
      userId: actor.id,
      oldValues: {
        workSummary: report.workSummary,
        workPerformed: report.workPerformed,
        issuesFound: report.issuesFound,
        materialsUsed: report.materialsUsed,
        recommendations: report.recommendations,
        completionRemarks: report.completionRemarks,
      },
      newValues: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async deleteDraft(id: string, actor: AuthUser): Promise<{ deleted: true }> {
    const report = await this.load(id);
    this.assertAccess(report, actor);
    if (report.status !== ServiceReportStatus.DRAFT) {
      throw new BadRequestException('Only draft reports can be deleted');
    }
    await this.prisma.serviceReport.delete({ where: { id } });
    await this.audit.log({
      action: 'DELETE_SERVICE_REPORT_DRAFT',
      module: 'service-reports',
      entity: 'ServiceReport',
      entityId: id,
      userId: actor.id,
      oldValues: { status: report.status },
    });
    return { deleted: true };
  }

  async addLocation(id: string, dto: CreateReportLocationDto, actor: AuthUser): Promise<unknown> {
    const report = await this.load(id);
    this.assertAccess(report, actor);
    if (actor.role !== Role.EMPLOYEE || report.employee.user.id !== actor.id) {
      throw new ForbiddenException('Only the assigned employee can record report GPS locations');
    }
    return this.prisma.serviceReportLocation.create({
      data: {
        serviceReportId: report.id,
        submittedById: actor.id,
        latitude: new Prisma.Decimal(dto.latitude),
        longitude: new Prisma.Decimal(dto.longitude),
        capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : undefined,
      },
      select: { id: true, serviceReportId: true, latitude: true, longitude: true, capturedAt: true, recordedAt: true },
    });
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
    if (!report.workSummary.trim() || !report.workPerformed.trim()) {
      throw new BadRequestException('workSummary and workPerformed are required before submission');
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
    this.assertAccess(report, actor);
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
      ...(report.workOrder.customer.userId ? [{
        userId: report.workOrder.customer.userId,
        title: 'Service report approved',
        message: `Your service report ${report.reportNumber} is now available`,
        type: NotificationType.REPORT_APPROVED,
        referenceType: 'serviceReport',
        referenceId: id,
      }] : []),
    ]);

    return updated;
  }

  /** Manager requests corrections (rule #8); employee gets a push notification. */
  async requestCorrection(id: string, actor: AuthUser, dto: ReportDecisionDto): Promise<unknown> {
    const report = await this.load(id);
    this.assertAccess(report, actor);
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

  private buildReportPdf(
    inputLines: string[],
    attachedPhotos: Array<{ caption: string; imageData: Buffer; width: number; height: number }>,
  ): Buffer {
    const sections = new Set([
      'WORK SUMMARY', 'WORK PERFORMED', 'ISSUES FOUND', 'MATERIALS USED',
      'RECOMMENDATIONS', 'COMPLETION REMARKS', 'ATTACHED PHOTOS', 'RECORDED LOCATIONS',
    ]);
    const printableLines = inputLines.flatMap((input) => {
      const ascii = input.replace(/[^\x20-\x7E]/g, '?');
      const words = ascii.split(/\s+/).filter(Boolean);
      if (!words.length) return [''];
      const wrapped: string[] = [];
      let line = '';
      for (const word of words) {
        if (line && `${line} ${word}`.length > 92) {
          wrapped.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) wrapped.push(line);
      return wrapped;
    });
    const linesPerPage = 43;
    const pages: string[][] = [];
    let currentPage: string[] = [];
    for (const line of printableLines) {
      const isSection = sections.has(line);
      const cost = isSection ? 2 : 1;
      if (currentPage.length + cost > linesPerPage) {
        pages.push(currentPage);
        currentPage = [];
      }
      currentPage.push(line);
    }
    if (currentPage.length || !pages.length) pages.push(currentPage);
    const totalPages = pages.length + attachedPhotos.length;
    const escape = (value: string) => value.replace(/[\\()]/g, '\\$&');
    const text = (value: string, x: number, y: number, size: number, bold = false, color = '0.16 0.22 0.20') =>
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg 1 0 0 1 ${x} ${y} Tm (${escape(value)}) Tj ET`;
    const contactLine = 'CHENGALAM SOUTH, KOTTAYAM | +91 9567700335, +91 8075364268 | project@specterra.in | www.specterra.in';
    const objects: Buffer[] = [
      Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
      Buffer.from(`<< /Type /Pages /Kids [${Array.from({ length: totalPages }, (_, index) => `${7 + attachedPhotos.length + index * 2} 0 R`).join(' ')}] /Count ${totalPages} >>`),
      Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
      Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'),
    ];
    const logo = readFileSync(join(__dirname, 'assets', 'specterra-logo.jpg'));
    objects.push(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width 500 /Height 244 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.length} >>\nstream\n`, 'ascii'),
      logo,
      Buffer.from('\nendstream', 'ascii'),
    ]));
    const watermark = readFileSync(join(__dirname, 'assets', 'specterra-watermark.jpg'));
    objects.push(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width 500 /Height 244 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${watermark.length} >>\nstream\n`, 'ascii'),
      watermark,
      Buffer.from('\nendstream', 'ascii'),
    ]));
    attachedPhotos.forEach((photo) => {
      objects.push(Buffer.concat([
        Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${photo.width} /Height ${photo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${photo.imageData.length} >>\nstream\n`, 'ascii'),
        photo.imageData,
        Buffer.from('\nendstream', 'ascii'),
      ]));
    });

    pages.forEach((page, pageIndex) => {
      const commands: string[] = [];
      commands.push('0.12 0.12 0.12 RG 12 12 588 818 re S');
      commands.push('q 300 0 0 146 156 325 cm /Watermark Do Q');
      commands.push('q 100 0 0 48.8 256 757 cm /Logo Do Q');
      commands.push(text('An ISO 9001:2015 (QMS) Certified Company', 181, 744, 12, true, '0.08 0.16 0.28'));
      commands.push(text(contactLine, 84, 725, 8.4, true, '0.12 0.22 0.36'));
      commands.push('0.72 0.76 0.80 RG 42 710 m 570 710 l S');
      let y = 685;
      for (const line of page) {
        if (!line) {
          y -= 6;
          continue;
        }
        if (sections.has(line)) {
          commands.push('0.91 0.96 0.93 rg 42 ' + (y - 4) + ' 528 18 re f');
          commands.push(text(line, 50, y + 1, 9, true, '0.02 0.35 0.25'));
          y -= 22;
        } else {
          const heading = pageIndex === 0 && line.startsWith('SERVICE REPORT:');
          commands.push(text(line, 48, y, heading ? 11 : 9, heading, heading ? '0.02 0.35 0.25' : '0.16 0.22 0.20'));
          y -= heading ? 17 : 14;
        }
      }
      commands.push('0.72 0.76 0.80 RG 42 43 m 570 43 l S');
      commands.push(text(contactLine, 84, 27, 8.4, true, '0.12 0.22 0.36'));
      commands.push(text(`PAGE ${pageIndex + 1} OF ${totalPages}`, 510, 16, 6, true, '0.12 0.22 0.36'));
      const stream = Buffer.from(commands.join('\n'), 'ascii');
      const pageObjectId = 7 + attachedPhotos.length + pageIndex * 2;
      const contentObjectId = pageObjectId + 1;
      objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Logo 5 0 R /Watermark 6 0 R >> >> /Contents ${contentObjectId} 0 R >>`, 'ascii'));
      objects.push(Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'ascii'),
        stream,
        Buffer.from('\nendstream', 'ascii'),
      ]));
    });

    attachedPhotos.forEach((photo, photoIndex) => {
      const pageIndex = pages.length + photoIndex;
      const pageObjectId = 7 + attachedPhotos.length + pageIndex * 2;
      const contentObjectId = pageObjectId + 1;
      const scale = Math.min(516 / photo.width, 520 / photo.height);
      const width = Math.round(photo.width * scale);
      const height = Math.round(photo.height * scale);
      const x = Math.round((612 - width) / 2);
      const y = 100 + Math.round((520 - height) / 2);
      const caption = photo.caption.replace(/[^\x20-\x7E]/g, '?').slice(0, 100);
      const commands = [
        '0.12 0.12 0.12 RG 12 12 588 818 re S',
        'q 300 0 0 146 156 325 cm /Watermark Do Q',
        'q 100 0 0 48.8 256 757 cm /Logo Do Q',
        text('An ISO 9001:2015 (QMS) Certified Company', 181, 744, 12, true, '0.08 0.16 0.28'),
        text(contactLine, 84, 725, 8.4, true, '0.12 0.22 0.36'),
        '0.72 0.76 0.80 RG 42 710 m 570 710 l S',
        text('ATTACHED FIELD PHOTO', 42, 682, 13, true, '0.08 0.16 0.28'),
        text(caption, 48, 656, 10, true),
        `0.88 0.91 0.89 RG ${x - 1} ${y - 1} ${width + 2} ${height + 2} re S`,
        `q ${width} 0 0 ${height} ${x} ${y} cm /Photo Do Q`,
        '0.72 0.76 0.80 RG 42 43 m 570 43 l S',
        text(contactLine, 84, 27, 8.4, true, '0.12 0.22 0.36'),
        text(`PAGE ${pageIndex + 1} OF ${totalPages}`, 510, 16, 6, true, '0.12 0.22 0.36'),
      ].join('\n');
      const stream = Buffer.from(commands, 'ascii');
      const imageObjectId = 7 + photoIndex;
      objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Logo 5 0 R /Watermark 6 0 R /Photo ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`, 'ascii'));
      objects.push(Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'ascii'),
        stream,
        Buffer.from('\nendstream', 'ascii'),
      ]));
    });

    const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'ascii')];
    const offsets = [0];
    let bodyLength = chunks[0].length;
    for (let index = 0; index < objects.length; index++) {
      offsets.push(bodyLength);
      const header = Buffer.from(`${index + 1} 0 obj\n`, 'ascii');
      const footer = Buffer.from('\nendobj\n', 'ascii');
      chunks.push(header, objects[index], footer);
      bodyLength += header.length + objects[index].length + footer.length;
    }
    const xref = bodyLength;
    let xrefText = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) xrefText += `${String(offset).padStart(10, '0')} 00000 n \n`;
    xrefText += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    chunks.push(Buffer.from(xrefText, 'ascii'));
    return Buffer.concat(chunks);
  }
}
