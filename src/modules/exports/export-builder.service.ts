import { Injectable, Logger } from '@nestjs/common';
import { ExportFormat, ExportStatus, Prisma, Role, ServiceReportStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  EXPORT_DEFAULT_ROWS,
  EXPORT_MAX_ROWS,
  EXPORT_RETENTION_HOURS,
  EXPORT_TYPES,
} from '../../common/constants';
import { AuthUser } from '../../common/types/auth.types';
import { PrismaService } from '../../database/prisma.service';
import { ExportStorageService } from './export-storage.service';
import { ListBookingsDto } from '../bookings/dto/bookings.dto';
import { ListWorkOrdersDto } from '../work-orders/dto/work-orders.dto';
import { ListAttendanceDto } from '../attendance/dto/attendance.dto';
import { ListOvertimeDto } from '../overtime/dto/overtime.dto';
import { ListLeaveDto } from '../leave/dto/leave.dto';
import { ListServiceReportsDto } from '../service-reports/dto/service-reports.dto';
import { ListEnquiriesDto } from '../enquiries/dto/enquiries.dto';
import { ListCustomersDto } from '../customers/dto/customers.dto';
import { AttendanceService } from '../attendance/attendance.service';
import { createObjectCsvWriter } from 'csv-writer';
import ExcelJS from 'exceljs';

interface ColumnDef {
  key: string;
  header: string;
}

interface FetchResult {
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
}

@Injectable()
export class ExportBuilderService {
  private readonly logger = new Logger(ExportBuilderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ExportStorageService,
    private readonly attendance: AttendanceService,
  ) {}

  async build(jobId: string): Promise<void> {
    const job = await this.prisma.exportJob.findUnique({ where: { id: jobId } });
    if (!job) {
      this.logger.warn(`Export job ${jobId} not found; skipping`);
      return;
    }
    await this.prisma.exportJob.update({
      where: { id: jobId },
      data: { status: ExportStatus.PROCESSING },
    });

    try {
      const actor = await this.resolveActor(job.userId);
      if (!actor.isActive) {
        throw new Error('Export owner is inactive');
      }

      const rawFilters =
        job.filters && typeof job.filters === 'object'
          ? (job.filters as Record<string, unknown>)
          : {};
      const rowLimit = Math.min(
        EXPORT_MAX_ROWS,
        Math.max(1, Number(rawFilters.rowLimit ?? EXPORT_DEFAULT_ROWS) || EXPORT_DEFAULT_ROWS),
      );

      const { columns, rows } = await this.fetchRows(job.type, rawFilters, actor, rowLimit);

      const relativePath = await this.storage.write(
        job.id,
        job.userId,
        job.format as 'CSV' | 'XLSX',
        async (fullPath: string) => {
          if (job.format === ExportFormat.XLSX) {
            await this.writeXlsx(fullPath, columns, rows);
          } else {
            await this.writeCsv(fullPath, columns, rows);
          }
        },
      );

      const expiresAt = new Date(Date.now() + EXPORT_RETENTION_HOURS * 60 * 60 * 1000);
      await this.prisma.exportJob.update({
        where: { id: jobId },
        data: {
          status: ExportStatus.COMPLETED,
          fileUrl: relativePath,
          rowCount: rows.length,
          completedAt: new Date(),
          expiresAt,
        },
      });
      this.logger.log(`Export job ${jobId} completed: ${rows.length} rows -> ${relativePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Export job ${jobId} failed: ${message}`);
      await this.prisma.exportJob
        .update({ where: { id: jobId }, data: { status: ExportStatus.FAILED, error: message } })
        .catch(() => undefined);
      throw error;
    }
  }

  private async resolveActor(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        customer: { select: { id: true } },
        employee: { select: { id: true } },
        manager: { select: { id: true } },
      },
    });
    if (!user) throw new Error('Export owner not found');
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      customerId: user.customer?.id,
      employeeId: user.employee?.id,
      managerId: user.manager?.id,
    };
  }

  private async fetchRows(
    type: string,
    rawFilters: Record<string, unknown>,
    actor: AuthUser,
    rowLimit: number,
  ): Promise<FetchResult> {
    switch (type) {
      case EXPORT_TYPES.BOOKINGS:
        return this.fetchBookings(rawFilters, actor, rowLimit);
      case EXPORT_TYPES.WORK_ORDERS:
        return this.fetchWorkOrders(rawFilters, actor, rowLimit);
      case EXPORT_TYPES.ATTENDANCE:
        return this.fetchAttendance(rawFilters, actor, rowLimit);
      case EXPORT_TYPES.OVERTIME:
        return this.fetchOvertime(rawFilters, actor, rowLimit);
      case EXPORT_TYPES.LEAVE:
        return this.fetchLeave(rawFilters, actor, rowLimit);
      case EXPORT_TYPES.SERVICE_REPORTS:
        return this.fetchServiceReports(rawFilters, actor, rowLimit);
      case EXPORT_TYPES.ENQUIRIES:
        return this.fetchEnquiries(rawFilters, actor, rowLimit);
      case EXPORT_TYPES.CUSTOMERS:
        return this.fetchCustomers(rawFilters, actor, rowLimit);
      default:
        throw new Error(`Unsupported export type: ${type}`);
    }
  }

  private async fetchBookings(
    rawFilters: Record<string, unknown>,
    actor: AuthUser,
    rowLimit: number,
  ): Promise<FetchResult> {
    const dto = await this.validateFilters(ListBookingsDto, rawFilters);
    const scopedCustomerId = actor.role === Role.CUSTOMER ? actor.customerId : dto.customerId;
    const where: Prisma.BookingWhereInput = {
      ...(scopedCustomerId ? { customerId: scopedCustomerId } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.serviceId ? { serviceId: dto.serviceId } : {}),
      ...(dto.dateFrom || dto.dateTo
        ? {
            preferredDate: {
              ...(dto.dateFrom ? { gte: new Date(dto.dateFrom) } : {}),
              ...(dto.dateTo ? { lte: new Date(dto.dateTo) } : {}),
            },
          }
        : {}),
    };
    const items = await this.prisma.booking.findMany({
      where,
      take: rowLimit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { name: true } },
      },
    });
    const columns: ColumnDef[] = [
      { key: 'bookingNumber', header: 'Booking Number' },
      { key: 'status', header: 'Status' },
      { key: 'customer', header: 'Customer' },
      { key: 'service', header: 'Service' },
      { key: 'preferredDate', header: 'Preferred Date' },
      { key: 'preferredTime', header: 'Preferred Time' },
      { key: 'remarks', header: 'Remarks' },
      { key: 'createdAt', header: 'Created At' },
      { key: 'cancelledAt', header: 'Cancelled At' },
      { key: 'cancelReason', header: 'Cancel Reason' },
    ];
    const rows = items.map((b) => ({
      bookingNumber: b.bookingNumber,
      status: b.status,
      customer: `${b.customer?.user?.firstName ?? ''} ${b.customer?.user?.lastName ?? ''}`.trim(),
      service: b.service?.name ?? '',
      preferredDate: b.preferredDate ? b.preferredDate.toISOString().slice(0, 10) : '',
      preferredTime: b.preferredTime,
      remarks: b.remarks ?? '',
      createdAt: b.createdAt ? b.createdAt.toISOString() : '',
      cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : '',
      cancelReason: b.cancelReason ?? '',
    }));
    return { columns, rows };
  }

  private async fetchWorkOrders(
    rawFilters: Record<string, unknown>,
    actor: AuthUser,
    rowLimit: number,
  ): Promise<FetchResult> {
    const dto = await this.validateFilters(ListWorkOrdersDto, rawFilters);
    const and: Prisma.WorkOrderWhereInput[] = [];
    if (dto.status) and.push({ status: dto.status });
    if (dto.priority) and.push({ priority: dto.priority });
    if (dto.customerId) and.push({ customerId: dto.customerId });
    if (dto.managerId) and.push({ managerId: dto.managerId });
    if (dto.employeeId) and.push({ assignments: { some: { employeeId: dto.employeeId } } });
    if (dto.scheduledFrom || dto.scheduledTo) {
      and.push({
        scheduledDate: {
          ...(dto.scheduledFrom ? { gte: new Date(dto.scheduledFrom) } : {}),
          ...(dto.scheduledTo ? { lte: new Date(dto.scheduledTo) } : {}),
        },
      });
    }
    if (actor.role === Role.CUSTOMER) and.push({ customerId: actor.customerId ?? '__none__' });
    if (actor.role === Role.EMPLOYEE) and.push({ assignments: { some: { employee: { userId: actor.id } } } });
    if (actor.role === Role.MANAGER) {
      and.push({ OR: [{ managerId: actor.managerId ?? '__none__' }, { managerId: null }] });
    }
    const where: Prisma.WorkOrderWhereInput = and.length ? { AND: and } : {};
    const items = await this.prisma.workOrder.findMany({
      where,
      take: rowLimit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { name: true } },
        manager: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    });
    const columns: ColumnDef[] = [
      { key: 'workOrderNumber', header: 'Work Order Number' },
      { key: 'status', header: 'Status' },
      { key: 'priority', header: 'Priority' },
      { key: 'customer', header: 'Customer' },
      { key: 'service', header: 'Service' },
      { key: 'manager', header: 'Manager' },
      { key: 'scheduledDate', header: 'Scheduled Date' },
      { key: 'scheduledStartTime', header: 'Scheduled Start' },
      { key: 'scheduledEndTime', header: 'Scheduled End' },
      { key: 'completedAt', header: 'Completed At' },
      { key: 'createdAt', header: 'Created At' },
      { key: 'instructions', header: 'Instructions' },
    ];
    const rows = items.map((w) => ({
      workOrderNumber: w.workOrderNumber,
      status: w.status,
      priority: w.priority,
      customer: `${w.customer?.user?.firstName ?? ''} ${w.customer?.user?.lastName ?? ''}`.trim(),
      service: w.service?.name ?? '',
      manager: w.manager ? `${w.manager.user?.firstName ?? ''} ${w.manager.user?.lastName ?? ''}`.trim() : '',
      scheduledDate: w.scheduledDate ? w.scheduledDate.toISOString().slice(0, 10) : '',
      scheduledStartTime: w.scheduledStartTime ?? '',
      scheduledEndTime: w.scheduledEndTime ?? '',
      completedAt: w.completedAt ? w.completedAt.toISOString() : '',
      createdAt: w.createdAt ? w.createdAt.toISOString() : '',
      instructions: w.instructions ?? '',
    }));
    return { columns, rows };
  }

  private async fetchAttendance(
    rawFilters: Record<string, unknown>,
    actor: AuthUser,
    rowLimit: number,
  ): Promise<FetchResult> {
    const dto = await this.validateFilters(ListAttendanceDto, rawFilters);
    const and: Prisma.AttendanceWhereInput[] = [];
    if (actor.role === Role.EMPLOYEE || actor.role === Role.MANAGER) {
      and.push(await this.resolveStaffWhere(actor));
    } else {
      if (dto.employeeId) and.push({ employeeId: dto.employeeId });
      if (dto.managerId) and.push({ managerId: dto.managerId });
    }
    if (dto.status) and.push({ status: dto.status });
    if (dto.dateFrom || dto.dateTo) {
      and.push({
        date: {
          ...(dto.dateFrom ? { gte: new Date(dto.dateFrom) } : {}),
          ...(dto.dateTo ? { lte: new Date(dto.dateTo) } : {}),
        },
      });
    }
    const where: Prisma.AttendanceWhereInput = and.length ? { AND: and } : {};
    const items = await this.prisma.attendance.findMany({
      where,
      take: rowLimit,
      orderBy: { date: 'desc' },
      include: {
        employee: { include: { user: { select: { firstName: true, lastName: true } } } },
        manager: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    });
    const columns: ColumnDef[] = [
      { key: 'date', header: 'Date' },
      { key: 'staff', header: 'Staff' },
      { key: 'checkInTime', header: 'Check In' },
      { key: 'checkOutTime', header: 'Check Out' },
      { key: 'workingMinutes', header: 'Working Minutes' },
      { key: 'status', header: 'Status' },
      { key: 'checkInLatitude', header: 'Check In Latitude' },
      { key: 'checkInLongitude', header: 'Check In Longitude' },
    ];
    const rows = items.map((a) => ({
      date: a.date ? a.date.toISOString().slice(0, 10) : '',
      staff: a.employee
        ? `${a.employee.user?.firstName ?? ''} ${a.employee.user?.lastName ?? ''}`.trim()
        : a.manager
          ? `${a.manager.user?.firstName ?? ''} ${a.manager.user?.lastName ?? ''}`.trim()
          : '',
      checkInTime: a.checkInTime ? a.checkInTime.toISOString() : '',
      checkOutTime: a.checkOutTime ? a.checkOutTime.toISOString() : '',
      workingMinutes: a.workingMinutes ?? '',
      status: a.status,
      checkInLatitude: a.checkInLatitude ?? '',
      checkInLongitude: a.checkInLongitude ?? '',
    }));
    return { columns, rows };
  }

  private async resolveStaffWhere(actor: AuthUser): Promise<Prisma.AttendanceWhereInput> {
    if (actor.role === Role.EMPLOYEE) {
      const employeeId = await this.attendance.resolveEmployeeId(actor);
      return { employeeId };
    }
    const manager = await this.prisma.manager.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (!manager) throw new Error('Manager profile not found');
    return { managerId: manager.id };
  }

  private async fetchOvertime(
    rawFilters: Record<string, unknown>,
    actor: AuthUser,
    rowLimit: number,
  ): Promise<FetchResult> {
    const dto = await this.validateFilters(ListOvertimeDto, rawFilters);
    const and: Prisma.OvertimeWhereInput[] = [];
    if (actor.role === Role.EMPLOYEE) {
      and.push({ employeeId: await this.attendance.resolveEmployeeId(actor) });
    } else if (dto.employeeId) {
      and.push({ employeeId: dto.employeeId });
    }
    if (dto.status) and.push({ status: dto.status });
    if (dto.dateFrom || dto.dateTo) {
      and.push({
        date: {
          ...(dto.dateFrom ? { gte: new Date(dto.dateFrom) } : {}),
          ...(dto.dateTo ? { lte: new Date(dto.dateTo) } : {}),
        },
      });
    }
    const where: Prisma.OvertimeWhereInput = and.length ? { AND: and } : {};
    const items = await this.prisma.overtime.findMany({
      where,
      take: rowLimit,
      orderBy: { date: 'desc' },
      include: { employee: { include: { user: { select: { firstName: true, lastName: true } } } } },
    });
    const columns: ColumnDef[] = [
      { key: 'date', header: 'Date' },
      { key: 'employee', header: 'Employee' },
      { key: 'startTime', header: 'Start Time' },
      { key: 'endTime', header: 'End Time' },
      { key: 'durationMinutes', header: 'Duration (min)' },
      { key: 'reason', header: 'Reason' },
      { key: 'status', header: 'Status' },
      { key: 'paymentAmount', header: 'Payment Amount' },
      { key: 'paymentStatus', header: 'Payment Status' },
      { key: 'paidAt', header: 'Paid At' },
      { key: 'createdAt', header: 'Created At' },
    ];
    const rows = items.map((o) => ({
      date: o.date ? o.date.toISOString().slice(0, 10) : '',
      employee: `${o.employee?.user?.firstName ?? ''} ${o.employee?.user?.lastName ?? ''}`.trim(),
      startTime: o.startTime,
      endTime: o.endTime,
      durationMinutes: o.durationMinutes,
      reason: o.reason ?? '',
      status: o.status,
      paymentAmount: o.paymentAmount != null ? Number(o.paymentAmount) : '',
      paymentStatus: o.paymentStatus,
      paidAt: o.paidAt ? o.paidAt.toISOString() : '',
      createdAt: o.createdAt ? o.createdAt.toISOString() : '',
    }));
    return { columns, rows };
  }

  private async fetchLeave(
    rawFilters: Record<string, unknown>,
    actor: AuthUser,
    rowLimit: number,
  ): Promise<FetchResult> {
    const dto = await this.validateFilters(ListLeaveDto, rawFilters);
    const and: Prisma.LeaveWhereInput[] = [];
    if (actor.role === Role.EMPLOYEE) {
      and.push({ employeeId: await this.attendance.resolveEmployeeId(actor) });
    } else if (dto.employeeId) {
      and.push({ employeeId: dto.employeeId });
    }
    if (dto.status) and.push({ status: dto.status });
    if (dto.leaveType) and.push({ leaveType: dto.leaveType });
    const where: Prisma.LeaveWhereInput = and.length ? { AND: and } : {};
    const items = await this.prisma.leave.findMany({
      where,
      take: rowLimit,
      orderBy: { startDate: 'desc' },
      include: { employee: { include: { user: { select: { firstName: true, lastName: true } } } } },
    });
    const columns: ColumnDef[] = [
      { key: 'leaveType', header: 'Leave Type' },
      { key: 'employee', header: 'Employee' },
      { key: 'startDate', header: 'Start Date' },
      { key: 'endDate', header: 'End Date' },
      { key: 'reason', header: 'Reason' },
      { key: 'status', header: 'Status' },
      { key: 'approvedAt', header: 'Approved At' },
      { key: 'createdAt', header: 'Created At' },
    ];
    const rows = items.map((l) => ({
      leaveType: l.leaveType,
      employee: `${l.employee?.user?.firstName ?? ''} ${l.employee?.user?.lastName ?? ''}`.trim(),
      startDate: l.startDate ? l.startDate.toISOString().slice(0, 10) : '',
      endDate: l.endDate ? l.endDate.toISOString().slice(0, 10) : '',
      reason: l.reason,
      status: l.status,
      approvedAt: l.approvedAt ? l.approvedAt.toISOString() : '',
      createdAt: l.createdAt ? l.createdAt.toISOString() : '',
    }));
    return { columns, rows };
  }

  private async fetchServiceReports(
    rawFilters: Record<string, unknown>,
    actor: AuthUser,
    rowLimit: number,
  ): Promise<FetchResult> {
    const dto = await this.validateFilters(ListServiceReportsDto, rawFilters);
    const and: Prisma.ServiceReportWhereInput[] = [];
    if (dto.status) and.push({ status: dto.status });
    if (dto.workOrderId) and.push({ workOrderId: dto.workOrderId });
    if (dto.employeeId) and.push({ employeeId: dto.employeeId });
    if (actor.role === Role.EMPLOYEE) and.push({ employee: { userId: actor.id } });
    if (actor.role === Role.CUSTOMER) {
      and.push({ status: ServiceReportStatus.APPROVED });
      and.push({ workOrder: { customerId: actor.customerId ?? '__none__' } });
    }
    const where: Prisma.ServiceReportWhereInput = and.length ? { AND: and } : {};
    const items = await this.prisma.serviceReport.findMany({
      where,
      take: rowLimit,
      orderBy: { createdAt: 'desc' },
      include: {
        workOrder: { select: { workOrderNumber: true } },
        employee: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    });
    const columns: ColumnDef[] = [
      { key: 'reportNumber', header: 'Report Number' },
      { key: 'status', header: 'Status' },
      { key: 'workOrderNumber', header: 'Work Order Number' },
      { key: 'employee', header: 'Employee' },
      { key: 'workSummary', header: 'Work Summary' },
      { key: 'workPerformed', header: 'Work Performed' },
      { key: 'issuesFound', header: 'Issues Found' },
      { key: 'materialsUsed', header: 'Materials Used' },
      { key: 'recommendations', header: 'Recommendations' },
      { key: 'submittedAt', header: 'Submitted At' },
      { key: 'reviewedAt', header: 'Reviewed At' },
      { key: 'createdAt', header: 'Created At' },
    ];
    const rows = items.map((r) => ({
      reportNumber: r.reportNumber,
      status: r.status,
      workOrderNumber: r.workOrder?.workOrderNumber ?? '',
      employee: `${r.employee?.user?.firstName ?? ''} ${r.employee?.user?.lastName ?? ''}`.trim(),
      workSummary: r.workSummary,
      workPerformed: r.workPerformed,
      issuesFound: r.issuesFound ?? '',
      materialsUsed: r.materialsUsed ?? '',
      recommendations: r.recommendations ?? '',
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : '',
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : '',
      createdAt: r.createdAt ? r.createdAt.toISOString() : '',
    }));
    return { columns, rows };
  }

  private async fetchEnquiries(
    rawFilters: Record<string, unknown>,
    actor: AuthUser,
    rowLimit: number,
  ): Promise<FetchResult> {
    const dto = await this.validateFilters(ListEnquiriesDto, rawFilters);
    const scopeFilter = actor.role === Role.MANAGER ? { OR: [{ assignedManagerId: actor.id }, { assignedManagerId: null }] } : {};
    const where: Prisma.EnquiryWhereInput = {
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.assignedManagerId ? { assignedManagerId: dto.assignedManagerId } : {}),
      ...scopeFilter,
    };
    const items = await this.prisma.enquiry.findMany({
      where,
      take: rowLimit,
      orderBy: { createdAt: 'desc' },
      include: {
        service: { select: { name: true } },
        assignedManager: { include: { user: { select: { firstName: true, lastName: true } } } },
        customer: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    });
    const columns: ColumnDef[] = [
      { key: 'enquiryNumber', header: 'Enquiry Number' },
      { key: 'name', header: 'Name' },
      { key: 'phone', header: 'Phone' },
      { key: 'email', header: 'Email' },
      { key: 'status', header: 'Status' },
      { key: 'service', header: 'Service' },
      { key: 'assignedManager', header: 'Assigned Manager' },
      { key: 'customer', header: 'Customer' },
      { key: 'createdAt', header: 'Created At' },
      { key: 'convertedAt', header: 'Converted At' },
    ];
    const rows = items.map((e) => ({
      enquiryNumber: e.enquiryNumber,
      name: e.name,
      phone: e.phone,
      email: e.email ?? '',
      status: e.status,
      service: e.service?.name ?? '',
      assignedManager: e.assignedManager ? `${e.assignedManager.user?.firstName ?? ''} ${e.assignedManager.user?.lastName ?? ''}`.trim() : '',
      customer: e.customer ? `${e.customer.user?.firstName ?? ''} ${e.customer.user?.lastName ?? ''}`.trim() : '',
      createdAt: e.createdAt ? e.createdAt.toISOString() : '',
      convertedAt: e.convertedAt ? e.convertedAt.toISOString() : '',
    }));
    return { columns, rows };
  }

  private async fetchCustomers(
    rawFilters: Record<string, unknown>,
    actor: AuthUser,
    rowLimit: number,
  ): Promise<FetchResult> {
    const dto = await this.validateFilters(ListCustomersDto, rawFilters);
    const where: Prisma.CustomerWhereInput = {
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
    const items = await this.prisma.customer.findMany({
      where,
      take: rowLimit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { firstName: true, lastName: true, email: true, phone: true } } },
    });
    const columns: ColumnDef[] = [
      { key: 'firstName', header: 'First Name' },
      { key: 'lastName', header: 'Last Name' },
      { key: 'email', header: 'Email' },
      { key: 'phone', header: 'Phone' },
      { key: 'isActive', header: 'Active' },
      { key: 'notes', header: 'Notes' },
      { key: 'createdAt', header: 'Created At' },
    ];
    const rows = items.map((c) => ({
      firstName: c.user?.firstName ?? '',
      lastName: c.user?.lastName ?? '',
      email: c.user?.email ?? '',
      phone: c.user?.phone ?? '',
      isActive: c.isActive,
      notes: c.notes ?? '',
      createdAt: c.createdAt ? c.createdAt.toISOString() : '',
    }));
    return { columns, rows };
  }

  private async validateFilters<T extends object>(cls: new () => T, raw: Record<string, unknown>): Promise<T> {
    const { rowLimit, ...rest } = raw ?? {};
    void rowLimit;
    const instance = plainToInstance(cls, rest, { enableImplicitConversion: true });
    const errors = await validate(instance as object);
    if (errors.length) {
      const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
      throw new Error(`Invalid export filters: ${messages.join('; ')}`);
    }
    return instance;
  }

  private async writeCsv(fullPath: string, columns: ColumnDef[], rows: Record<string, unknown>[]): Promise<void> {
    const writer = createObjectCsvWriter({
      path: fullPath,
      header: columns.map((c) => ({ id: c.key, title: c.header })),
    });
    await writer.writeRecords(rows);
  }

  private async writeXlsx(fullPath: string, columns: ColumnDef[], rows: Record<string, unknown>[]): Promise<void> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Export');
    ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: 24 }));
    for (const row of rows) ws.addRow(row);
    ws.getRow(1).font = { bold: true };
    await wb.xlsx.writeFile(fullPath);
  }
}