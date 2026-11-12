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
      findFirst: jest.fn(),
      delete: jest.fn().mockResolvedValue(savedEnquiry),
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

describe('EnquiriesService.remove', () => {
  it('deletes an enquiry in the admin company and audits the removal', async () => {
    const { service, prisma } = setup();
    const enquiry = {
      id: 'enquiry-1',
      enquiryNumber: 'ENQ-2026-000001',
      status: 'NEW',
      convertedBookingId: null,
      companyId: 'company-1',
    };
    prisma.enquiry.findFirst.mockResolvedValue(enquiry);

    await expect(service.remove('enquiry-1', {
      id: 'admin-1',
      role: Role.ADMIN,
      email: 'admin@example.com',
      isActive: true,
      companyId: 'company-1',
    })).resolves.toEqual({ id: 'enquiry-1', deleted: true });

    expect(prisma.enquiry.findFirst).toHaveBeenCalledWith({
      where: { id: 'enquiry-1', companyId: 'company-1' },
    });
    expect(prisma.enquiry.delete).toHaveBeenCalledWith({ where: { id: 'enquiry-1' } });
  });

  it('rejects manager deletion before accessing the enquiry', async () => {
    const { service, prisma } = setup();

    await expect(service.remove('enquiry-1', {
      id: 'manager-1',
      role: Role.MANAGER,
      email: 'manager@example.com',
      isActive: true,
      companyId: 'company-1',
    })).rejects.toThrow('Only admins can delete enquiries');

    expect(prisma.enquiry.findFirst).not.toHaveBeenCalled();
    expect(prisma.enquiry.delete).not.toHaveBeenCalled();
  });

  it('does not delete an enquiry converted to a booking', async () => {
    const { service, prisma } = setup();
    prisma.enquiry.findFirst.mockResolvedValue({
      id: 'enquiry-1',
      enquiryNumber: 'ENQ-2026-000001',
      status: 'CONVERTED',
      convertedBookingId: 'booking-1',
      companyId: 'company-1',
    });

    await expect(service.remove('enquiry-1', {
      id: 'admin-1',
      role: Role.ADMIN,
      email: 'admin@example.com',
      isActive: true,
      companyId: 'company-1',
    })).rejects.toThrow('Converted enquiries cannot be deleted');

    expect(prisma.enquiry.delete).not.toHaveBeenCalled();
  });
});
