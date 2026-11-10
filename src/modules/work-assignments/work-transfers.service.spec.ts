import { Role, WorkAssignmentStatus, WorkOrderStatus, WorkTransferStatus } from '@prisma/client';
import { WorkTransfersService } from './work-transfers.service';

describe('WorkTransfersService employee request contract', () => {
  it('creates a manager-pending transfer to an eligible employee profile id', async () => {
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
        reason: 'I am unable to complete this assignment',
      },
      actor,
    );

    expect(response).toBe(transfer);
    expect(prisma.employee.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'target-employee' } }),
    );
    expect(prisma.workTransfer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workOrderId: 'work-order-1',
          fromEmployeeId: 'source-employee',
          toEmployeeId: 'target-employee',
          status: WorkTransferStatus.PENDING,
        }),
      }),
    );
  });
});
import { describe, expect, it, jest } from '@jest/globals';
