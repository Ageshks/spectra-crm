import { Role } from '@prisma/client';
import { EmployeesService } from './employees.service';

describe('EmployeesService transfer targets', () => {
  it('lists active eligible technicians for an employee and excludes the caller', async () => {
    const prisma = {
      employee: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'target-employee',
            employeeNo: 'EMP-2',
            designation: 'Field Technician',
            designationRecord: { name: 'Field Technician' },
            user: { firstName: 'Target', lastName: 'Tech' },
          },
        ]),
      },
      workAssignment: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new EmployeesService(prisma as never, {} as never, {} as never);

    const response = await service.listTransferTargets({
      id: 'user-1',
      email: 'source@example.test',
      role: Role.EMPLOYEE,
      isActive: true,
      companyId: 'company-1',
      employeeId: 'source-employee',
    });

    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company-1',
          id: { not: 'source-employee' },
          user: { isActive: true },
          designationRecord: { is: { isActive: true, canUseFieldApp: true } },
        },
      }),
    );
    expect(response).toEqual([
      expect.objectContaining({
        id: 'target-employee',
        employeeId: 'target-employee',
        fullName: 'Target Tech',
        designation: 'Field Technician',
        isAvailable: true,
        availability: 'AVAILABLE',
        currentAssignmentCount: 0,
      }),
    ]);
  });
});
import { describe, expect, it, jest } from '@jest/globals';
