import { Role, WorkAssignmentStatus, WorkOrderStatus, WorkTransferStatus } from '@prisma/client';
import { WorkTransfersService } from './work-transfers.service';

describe('WorkTransfersService employee request contract', () => {
  it('creates a manager-pending transfer without requiring a typed reason', async () => {
    const transfer = {
      id: 'transfer-1',
      workOrderId: 'work-order-1',
      fromEmployeeId: 'source-employee',
      toEmployeeId: 'target-employee',
      status: WorkTransferStatus.PENDING,
    };
    const prisma = {
      workOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'work-order-1',
          workOrderNumber: 'WO-1',
          status: WorkOrderStatus.ASSIGNED,
          manager: null,
        }),
      },
      workAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'assignment-1',
          workOrderId: 'work-order-1',
          employeeId: 'source-employee',
          status: WorkAssignmentStatus.ACCEPTED,
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'target-employee',
          user: { id: 'target-user', isActive: true },
          designationRecord: {
            id: 'designation-1',
            name: 'Field Technician',
            isActive: true,
            canUseFieldApp: true,
          },
        }),
      },
      workTransfer: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(transfer),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const notifications = { notifyMany: jest.fn().mockResolvedValue(undefined) };
    const service = new WorkTransfersService(prisma as never, audit as never, notifications as never);
    const actor = {
      id: 'source-user',
      email: 'source@example.test',
      role: Role.EMPLOYEE,
      isActive: true,
      employeeId: 'source-employee',
    };

    const response = await service.request(
      {
        workOrderId: 'work-order-1',
        toEmployeeId: 'target-employee',
        reason: '',
      },
      actor,
    );

    expect(response).toBe(transfer);
    expect(prisma.employee.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'target-employee' } }),
    );
    expect(prisma.workAssignment.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeId: 'target-employee' }) }),
    );
    expect(prisma.workTransfer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workOrderId: 'work-order-1',
          fromEmployeeId: 'source-employee',
          toEmployeeId: 'target-employee',
          reason: 'Technician unavailable',
          status: WorkTransferStatus.PENDING,
        }),
      }),
    );
  });

  it('rejects a transfer request when the target technician is busy', async () => {
    const prisma = {
      workOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'work-order-1',
          workOrderNumber: 'WO-1',
          status: WorkOrderStatus.ASSIGNED,
          companyId: 'company-1',
          manager: null,
        }),
      },
      workAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'assignment-1',
          workOrderId: 'work-order-1',
          employeeId: 'source-employee',
          status: WorkAssignmentStatus.ACCEPTED,
        }),
        count: jest.fn().mockResolvedValue(1),
      },
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'target-employee',
          companyId: 'company-1',
          user: { id: 'target-user', isActive: true },
          designationRecord: { isActive: true, canUseFieldApp: true },
        }),
      },
      workTransfer: { findFirst: jest.fn(), create: jest.fn() },
      user: { findMany: jest.fn() },
    };
    const service = new WorkTransfersService(
      prisma as never,
      { log: jest.fn() } as never,
      { notifyMany: jest.fn() } as never,
    );

    await expect(service.request(
      {
        workOrderId: 'work-order-1',
        toEmployeeId: 'target-employee',
        reason: 'I am unable to complete this assignment',
      },
      {
        id: 'source-user',
        email: 'source@example.test',
        role: Role.EMPLOYEE,
        isActive: true,
        companyId: 'company-1',
        employeeId: 'source-employee',
      },
    )).rejects.toThrow('Target employee is not available');
    expect(prisma.workTransfer.create).not.toHaveBeenCalled();
  });
});
import { describe, expect, it, jest } from '@jest/globals';
