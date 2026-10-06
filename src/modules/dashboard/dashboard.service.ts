import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser } from '../../common/types/auth.types';

/**
 * Role-scoped dashboard aggregations (§36). Each method issues independent
 * count/findMany queries in parallel via Promise.all — no N+1, no giant joins.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private todayRange(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  async admin(): Promise<Record<string, unknown>> {
    const { start, end } = this.todayRange();
    const upcomingCutoff = new Date();
    upcomingCutoff.setDate(upcomingCutoff.getDate() + 14);

    const [
      totalCustomers,
      employeeCount,
      newEnquiries,
      pendingBookings,
      totalBookings,
      scheduledServices,
      activeWorkOrders,
      completedWorks,
      pendingApprovals,
      upcomingMaintenance,
      todayPresent,
      todayLate,
      pendingOvertime,
    ] = await Promise.all([
      this.prisma.customer.count(),
      this.prisma.employee.count(),
      this.prisma.enquiry.count({ where: { status: 'NEW' } }),
      this.prisma.booking.count({ where: { status: 'REQUESTED' } }),
      this.prisma.booking.count(),
      this.prisma.workOrder.count({
        where: { scheduledDate: { gte: start }, status: { notIn: ['COMPLETED', 'APPROVED', 'CANCELLED'] } },
      }),
      this.prisma.workOrder.count({
        where: { status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD'] } },
      }),
      this.prisma.workOrder.count({ where: { status: 'COMPLETED' } }),
      this.prisma.serviceReport.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.maintenanceSchedule.count({
        where: { nextServiceDate: { lte: upcomingCutoff }, status: 'ACTIVE' },
      }),
      this.prisma.attendance.count({ where: { date: { gte: start, lte: end }, status: 'PRESENT' } }),
      this.prisma.attendance.count({ where: { date: { gte: start, lte: end }, status: 'LATE' } }),
      this.prisma.overtime.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      totalCustomers,
      employeeCount,
      newEnquiries,
      pendingBookings,
      totalBookings,
      scheduledServices,
      activeWorkOrders,
      completedWorks,
      pendingApprovals,
      upcomingMaintenance,
      attendanceSummary: { presentToday: todayPresent, lateToday: todayLate },
      overtimeSummary: { pending: pendingOvertime },
    };
  }

  async manager(actor: AuthUser): Promise<Record<string, unknown>> {
    const { start, end } = this.todayRange();
    const scope = actor.managerId ? { managerId: actor.managerId } : {};
    const reportScope = actor.managerId
      ? { workOrder: { managerId: actor.managerId } }
      : {};

    const [
      assignedWorks,
      pendingWorks,
      inProgressWorks,
      completedWorks,
      correctionRequests,
      pendingReports,
      todaysSchedule,
    ] = await Promise.all([
      this.prisma.workOrder.count({ where: { ...scope } }),
      this.prisma.workOrder.count({ where: { ...scope, status: 'ASSIGNED' } }),
      this.prisma.workOrder.count({ where: { ...scope, status: 'IN_PROGRESS' } }),
      this.prisma.workOrder.count({
        where: { ...scope, status: { in: ['COMPLETED', 'APPROVED'] } },
      }),
      this.prisma.serviceReport.count({
        where: { ...reportScope, status: 'CORRECTION_REQUIRED' },
      }),
      this.prisma.serviceReport.count({ where: { ...reportScope, status: 'SUBMITTED' } }),
      this.prisma.workOrder.findMany({
        where: { ...scope, scheduledDate: { gte: start, lte: end } },
        orderBy: { scheduledDate: 'asc' },
        take: 20,
        select: {
          id: true, workOrderNumber: true, status: true, priority: true,
          scheduledDate: true,
          service: { select: { id: true, name: true } },
          customer: {
            select: {
              id: true,
              user: { select: { firstName: true, lastName: true, phone: true } },
            },
          },
        },
      }),
    ]);

    return {
      assignedWorks, pendingWorks, inProgressWorks, completedWorks,
      correctionRequests, pendingReports, todaysSchedule,
    };
  }

  async employee(actor: AuthUser): Promise<Record<string, unknown>> {
    const { start, end } = this.todayRange();
    const employee = actor.employeeId
      ? { id: actor.employeeId }
      : await this.prisma.employee.findUnique({
          where: { userId: actor.id },
          select: { id: true },
        });
    if (!employee) {
      return {
        attendanceToday: null, assignedWorks: 0, pendingWorks: 0,
        inProgressWorks: 0, completedWorks: 0, todaysSchedule: [],
      };
    }
    const assignmentScope = { employeeId: employee.id };
    const orderScope = { assignments: { some: { ...assignmentScope } } };

    const [
      attendanceToday,
      assignedWorks,
      pendingWorks,
      inProgressWorks,
      completedWorks,
      todaysSchedule,
    ] = await Promise.all([
      this.prisma.attendance.findFirst({
        where: { employeeId: employee.id, date: { gte: start, lte: end } },
      }),
      this.prisma.workAssignment.count({ where: { ...assignmentScope } }),
      this.prisma.workAssignment.count({ where: { ...assignmentScope, status: 'ASSIGNED' } }),
      this.prisma.workAssignment.count({ where: { ...assignmentScope, status: 'IN_PROGRESS' } }),
      this.prisma.workAssignment.count({ where: { ...assignmentScope, status: 'COMPLETED' } }),
      this.prisma.workOrder.findMany({
        where: { ...orderScope, scheduledDate: { gte: start, lte: end } },
        orderBy: { scheduledDate: 'asc' },
        take: 20,
        select: {
          id: true, workOrderNumber: true, status: true, scheduledDate: true,
          service: { select: { id: true, name: true } },
          serviceLocation: {
            select: { id: true, locationName: true, address: true, city: true },
          },
        },
      }),
    ]);

    return {
      attendanceToday, assignedWorks, pendingWorks,
      inProgressWorks, completedWorks, todaysSchedule,
    };
  }

  async customer(actor: AuthUser): Promise<Record<string, unknown>> {
    const customerId =
      actor.customerId ??
      (await this.prisma.customer.findUnique({
        where: { userId: actor.id },
        select: { id: true },
      }))?.id;
    if (!customerId) {
      return { activeBookings: 0, completedServices: 0, upcomingMaintenance: [], recentHistory: [] };
    }
    const upcomingCutoff = new Date();
    upcomingCutoff.setDate(upcomingCutoff.getDate() + 30);

    const [activeBookings, completedServices, upcomingMaintenance, recentHistory] =
      await Promise.all([
        this.prisma.booking.count({
          where: { customerId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        }),
        this.prisma.booking.count({ where: { customerId, status: 'COMPLETED' } }),
        this.prisma.maintenanceSchedule.findMany({
          where: { customerId, status: 'ACTIVE', nextServiceDate: { lte: upcomingCutoff } },
          orderBy: { nextServiceDate: 'asc' },
          take: 10,
          include: {
            service: { select: { id: true, name: true } },
            serviceLocation: { select: { id: true, locationName: true, city: true } },
          },
        }),
        this.prisma.booking.findMany({
          where: { customerId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true, bookingNumber: true, status: true, preferredDate: true,
            service: { select: { id: true, name: true } },
          },
        }),
      ]);

    return { activeBookings, completedServices, upcomingMaintenance, recentHistory };
  }
}