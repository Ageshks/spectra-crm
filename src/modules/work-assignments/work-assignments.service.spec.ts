import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, WorkAssignmentStatus, WorkOrderStatus } from '@prisma/client';
import { WorkAssignmentsService } from './work-assignments.service';

describe('WorkAssignmentsService mobile contracts', () => {
  const actor = {
    id: 'user-1',
    email: 'tech@example.test',
    role: Role.EMPLOYEE,
    isActive: true,
    employeeId: 'employee-1',
  };

  const makeAssignment = (overrides: Record<string, unknown> = {}) => ({
    id: 'assignment-1',
    employeeId: actor.employeeId,
    workOrderId: 'work-order-1',
    status: WorkAssignmentStatus.ASSIGNED,
    employee: { user: { id: actor.id, firstName: 'Field', lastName: 'Tech' } },
    workOrder: {
      id: 'work-order-1',
      status: WorkOrderStatus.ASSIGNED,
      bookingId: 'booking-1',
      workOrderNumber: 'WO-1',
    },
    ...overrides,
  });

  const setup = () => {
    const prisma = {
      $transaction: jest.fn(),
      workAssignment: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const notifications = { notifyMany: jest.fn().mockResolvedValue(undefined) };
    const bookings = { syncStatus: jest.fn().mockResolvedValue(undefined) };
    const statusService = { apply: jest.fn().mockResolvedValue(undefined) };
    prisma.$transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));
    return {
      prisma,
      audit,
      statusService,
      service: new WorkAssignmentsService(
        prisma as never,
        audit as never,
        notifications as never,
        bookings as never,
        statusService as never,
      ),
    };
  };

  it('lists the assignment database id separately from workOrderId', async () => {
    const { prisma, service } = setup();
    prisma.workAssignment.findMany.mockResolvedValue([
      { id: 'assignment-1', workOrderId: 'work-order-1', workOrder: { id: 'work-order-1' } },
    ]);
    prisma.workAssignment.count.mockResolvedValue(1);

    const response = await service.list({ page: 1, limit: 20 }, actor);

    expect(response.data[0]).toMatchObject({
      id: 'assignment-1',
      workOrderId: 'work-order-1',
      workOrder: { id: 'work-order-1' },
    });
    expect(prisma.workAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ AND: [{ employeeId: actor.employeeId }] }) }),
    );
  });

  it('accepts a valid assignment by its database id', async () => {
    const { prisma, service, statusService } = setup();
    const assignment = makeAssignment();
    const updated = makeAssignment({ status: WorkAssignmentStatus.ACCEPTED });
    prisma.workAssignment.findUnique.mockResolvedValueOnce(assignment);
    prisma.workAssignment.updateMany.mockResolvedValue({ count: 1 });
    prisma.workAssignment.findUniqueOrThrow.mockResolvedValue(updated);

    const response = await service.accept('assignment-1', actor);

    expect(response).toBe(updated);
    expect(prisma.workAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'assignment-1',
        employeeId: actor.employeeId,
        status: WorkAssignmentStatus.ASSIGNED,
      },
      data: expect.objectContaining({ status: WorkAssignmentStatus.ACCEPTED }),
    });
    expect(statusService.apply).toHaveBeenCalledWith(
      'work-order-1',
      WorkOrderStatus.ACCEPTED,
      expect.any(Object),
    );
  });

  it('returns 404 for an unknown assignment id', async () => {
    const { prisma, service } = setup();
    prisma.workAssignment.findUnique.mockResolvedValue(null);

    await expect(service.accept('missing-assignment', actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.workAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an assignment id owned by another employee', async () => {
    const { prisma, service } = setup();
    prisma.workAssignment.findUnique.mockResolvedValue(
      makeAssignment({ employeeId: 'another-employee' }),
    );

    await expect(service.accept('assignment-1', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.workAssignment.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an assignment that is no longer awaiting acceptance', async () => {
    const { prisma, service } = setup();
    prisma.workAssignment.findUnique.mockResolvedValue(
      makeAssignment({ status: WorkAssignmentStatus.ACCEPTED }),
    );

    await expect(service.accept('assignment-1', actor)).rejects.toThrow(
      'Only ASSIGNED work can be accepted (current: ACCEPTED)',
    );
    expect(prisma.workAssignment.updateMany).not.toHaveBeenCalled();
  });
});
