import { AttendanceStatus, Role } from '@prisma/client';
import { describe, expect, it, jest } from '@jest/globals';
import { AttendanceService } from './attendance.service';

describe('AttendanceService check-in status', () => {
  it('does not mark a check-in late based on office start time', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-18T12:00:00.000Z'));
    const record = {
      id: 'attendance-1',
      employeeId: 'employee-1',
      checkInTime: new Date('2026-11-18T12:00:00.000Z'),
      status: AttendanceStatus.PRESENT,
    };
    const prisma = {
      attendance: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(record),
      },
    };
    const service = new AttendanceService(
      prisma as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      { getBoolean: jest.fn().mockResolvedValue(false) } as never,
      { isWorkingDate: jest.fn().mockResolvedValue(true) } as never,
    );

    try {
      await service.checkIn({}, {
        id: 'employee-user-1',
        email: 'employee@example.test',
        role: Role.EMPLOYEE,
        isActive: true,
        companyId: 'company-1',
        employeeId: 'employee-1',
      });

      expect(prisma.attendance.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: AttendanceStatus.PRESENT }),
      }));
    } finally {
      jest.useRealTimers();
    }
  });
});