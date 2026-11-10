import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { Role, WorkOrderStatus } from '@prisma/client';
import { ServiceReportsService } from './service-reports.service';

describe('ServiceReportsService assignment ownership', () => {
  const actor = {
    id: 'staff-user-id',
    email: 'staff@example.test',
    role: Role.EMPLOYEE,
    isActive: true,
    // Deliberately stale to ensure the database user/employee relation is authoritative.
    employeeId: 'stale-employee-id',
  };

  const setup = (assigned = true) => {
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 'actual-employee-id' }) },
      workAssignment: { findFirst: jest.fn().mockResolvedValue(assigned ? { id: 'assignment-id' } : null) },
      workOrder: { findUnique: jest.fn().mockResolvedValue({ id: 'work-order-id', status: WorkOrderStatus.COMPLETED }) },
      serviceReport: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'report-id', employeeId: 'actual-employee-id' }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const sequences = { next: jest.fn().mockResolvedValue('RPT-1') };
    const notifications = {};
    const bookings = {};
    const statusService = {};
    const service = new ServiceReportsService(
      prisma as never,
      audit as never,
      sequences as never,
      notifications as never,
      bookings as never,
      statusService as never,
    );
    return { prisma, service };
  };

  it('derives the employee profile from the authenticated user before checking an assignment', async () => {
    const { prisma, service } = setup();
    await service.create({ workOrderId: 'work-order-id' } as never, actor);

    expect(prisma.employee.findUnique).toHaveBeenCalledWith({
      where: { userId: actor.id },
      select: { id: true },
    });
    expect(prisma.workAssignment.findFirst).toHaveBeenCalledWith({
      where: { workOrderId: 'work-order-id', employeeId: 'actual-employee-id' },
    });
    expect(prisma.serviceReport.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ employeeId: 'actual-employee-id' }),
    }));
  });

  it('keeps assignment enforcement when the employee has no matching work assignment', async () => {
    const { prisma, service } = setup(false);
    await expect(service.create({ workOrderId: 'work-order-id' } as never, actor))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.serviceReport.create).not.toHaveBeenCalled();
  });
});
