import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { describe, expect, it, jest } from '@jest/globals';
import { OvertimeService } from './overtime.service';

const employeeId = 'employee-1';
const companyId = 'company-1';
const shiftStart = new Date('2026-11-12T00:00:00.000Z');

function setup(attendanceRecord: Record<string, unknown> | null = null) {
  const prisma = {
    employee: { findUnique: jest.fn().mockResolvedValue({ companyId }) },
    manager: { findUnique: jest.fn().mockResolvedValue({ companyId }) },
    workOrder: { findFirst: jest.fn().mockResolvedValue({ id: 'managed-work-order-1' }) },
    attendance: {
      findFirst: jest.fn().mockResolvedValue(attendanceRecord),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workAssignment: {
      findFirst: jest.fn().mockResolvedValue({ id: 'assignment-1' }),
    },
    overtime: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'overtime-1' }),
    },
    notification: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const attendance = {
    resolveEmployeeId: jest.fn().mockResolvedValue(employeeId),
    resolveManagerId: jest.fn().mockResolvedValue('manager-1'),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const service = new OvertimeService(
    prisma as never,
    audit as never,
    attendance as never,
    notifications as never,
  );
  const actor = {
    id: 'employee-user-1',
    role: Role.EMPLOYEE,
    employeeId,
    companyId,
    email: 'employee@example.test',
    isActive: true,
  };
  return { service, prisma, notifications, actor };
}

describe('OvertimeService shift length', () => {
  it('includes the one-hour break in the 8 hours 30 minutes shift', async () => {
    const record = {
      id: 'attendance-1',
      employeeId,
      date: shiftStart,
      checkInTime: shiftStart,
      checkOutTime: new Date('2026-11-12T09:31:00.000Z'),
      workingMinutes: 571,
    };
    const { service, prisma, actor } = setup(record);

    await service.request({
      date: '2026-11-12',
      breakMinutes: 60,
    }, actor);

    expect(prisma.overtime.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        durationMinutes: 61,
        breakMinutes: 60,
      }),
    }));
  });

  it('allows a manager with in-progress managed work to request overtime', async () => {
    const record = {
      id: 'manager-attendance-1',
      managerId: 'manager-1',
      date: shiftStart,
      checkInTime: shiftStart,
      checkOutTime: new Date('2026-11-12T09:00:00.000Z'),
      workingMinutes: 540,
    };
    const { service, prisma } = setup(record);
    const actor = {
      id: 'manager-user-1',
      role: Role.MANAGER,
      managerId: 'manager-1',
      companyId,
      email: 'manager@example.test',
      isActive: true,
    };

    await service.request({ date: '2026-11-12' }, actor);

    expect(prisma.overtime.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        managerId: 'manager-1',
        attendanceId: 'manager-attendance-1',
        durationMinutes: 30,
        breakMinutes: 60,
      }),
    }));
  });

  it('automatically checks out at 510 minutes', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-12T12:00:00.000Z'));
    const checkInTime = new Date('2026-11-12T02:00:00.000Z');
    const { service, prisma, notifications } = setup();
    prisma.attendance.findMany.mockResolvedValue([{
      id: 'attendance-1',
      employeeId,
      checkInTime,
      employee: { userId: 'employee-user-1', assignments: [] },
    }]);

    try {
      await service.autoCheckoutAfterStandardShift();
      expect(prisma.attendance.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          checkInTime: { lte: new Date('2026-11-12T03:30:00.000Z') },
        }),
      }));
      expect(prisma.attendance.updateMany).toHaveBeenCalledWith({
        where: { id: 'attendance-1', checkOutTime: null },
        data: { checkOutTime: new Date('2026-11-12T10:30:00.000Z'), workingMinutes: 510 },
      });
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Your attendance was checked out automatically after 8 hours 30 minutes.',
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends one overtime reminder ten minutes before the standard shift threshold', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-12T12:00:00.000Z'));
    const checkInTime = new Date('2026-11-12T03:39:30.000Z');
    const { service, prisma, notifications } = setup();
    prisma.attendance.findMany.mockResolvedValue([{
      id: 'attendance-1',
      employeeId,
      checkInTime,
      employee: { userId: 'employee-user-1', assignments: [{ id: 'assignment-1' }] },
    }]);

    try {
      await service.remindBeforeOvertimeEligibility();

      expect(prisma.attendance.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          checkInTime: {
            gt: new Date('2026-11-12T03:39:00.000Z'),
            lte: new Date('2026-11-12T03:40:00.000Z'),
          },
        }),
      }));
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'employee-user-1',
        type: 'OVERTIME_REMINDER',
        referenceId: 'attendance-1',
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects overtime before the full 8 hours 30 minutes shift is complete', async () => {
    const record = {
      id: 'attendance-1',
      employeeId,
      date: shiftStart,
      checkInTime: shiftStart,
      checkOutTime: new Date('2026-11-12T08:29:00.000Z'),
      workingMinutes: 509,
    };
    const { service, prisma, actor } = setup(record);

    await expect(service.request({
      date: '2026-11-12',
      breakMinutes: 60,
    }, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.overtime.create).not.toHaveBeenCalled();
  });
});
