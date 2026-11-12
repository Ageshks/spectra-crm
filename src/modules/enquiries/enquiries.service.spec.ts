import { Role, WorkOrderPriority } from '@prisma/client';
import { describe, expect, it, jest } from '@jest/globals';
import { EnquiriesService } from './enquiries.service';

function setup(notificationFailure?: Error) {
  const savedEnquiry = { id: 'enquiry-1', enquiryNumber: 'ENQ-2026-000001' };
  const prisma = {
    company: {
      findFirst: jest.fn().mockResolvedValue({ id: 'company-1' }),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    service: {
      findFirst: jest.fn().mockResolvedValue({ id: 'service-1', companyId: 'company-1' }),
    },
    enquiry: {
      create: jest.fn().mockResolvedValue(savedEnquiry),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]),
    },
  };
  const notifications = {
    notifyMany: notificationFailure
      ? jest.fn().mockRejectedValue(notificationFailure)
      : jest.fn().mockResolvedValue(undefined),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const sequences = { next: jest.fn().mockResolvedValue('ENQ-2026-000001') };
  const service = new EnquiriesService(
    prisma as never,
    audit as never,
    sequences as never,
    notifications as never,
  );
  return { service, prisma, notifications, savedEnquiry };
}

describe('EnquiriesService.create', () => {
  const payload = {
    contactName: 'Alex Smith',
    phone: '9876543210',
    email: 'ALEX@example.com',
    company: 'Example Company',
    requestedService: 'ETP INSTALLATION',
    priority: WorkOrderPriority.NORMAL,
    customerMessage: 'Customer enquiry details',
  };
  const publicActor = { id: '', role: Role.CUSTOMER };

  it('creates an enquiry using the form field aliases without creating a customer', async () => {
    const { service, prisma } = setup();

    await service.create(payload, publicActor);

    expect(prisma.enquiry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-1',
        enquiryNumber: 'ENQ-2026-000001',
        name: 'Alex Smith',
        companyName: 'Example Company',
        phone: '9876543210',
        email: 'alex@example.com',
        serviceId: 'service-1',
        priority: WorkOrderPriority.NORMAL,
        message: 'Customer enquiry details',
        status: 'NEW',
      }),
    });
    expect(prisma.customer.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId: 'company-1' }),
    }));
  });

  it('returns the saved enquiry if notification processing fails', async () => {
    const { service, prisma, savedEnquiry } = setup(new Error('notification storage unavailable'));

    await expect(service.create(payload, publicActor)).resolves.toBe(savedEnquiry);

    expect(prisma.enquiry.create).toHaveBeenCalledTimes(1);
  });
});
