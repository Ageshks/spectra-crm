import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoiceItemCategory, Role, ServiceInvoiceStatus, WorkOrderStatus } from '@prisma/client';
import { describe, expect, it, jest } from '@jest/globals';
import { BillingService } from './billing.service';

const companyId = 'company-1';
const actor = { id: 'admin-1', email: 'admin@test.local', role: Role.ADMIN, isActive: true, companyId };

const work = (overrides: Record<string, unknown> = {}) => ({
  id: 'work-1', companyId, bookingId: 'booking-1', customerId: 'customer-1', serviceId: 'service-1',
  status: WorkOrderStatus.COMPLETED, completedAt: new Date(), managerId: 'manager-1',
  booking: { id: 'booking-1', bookingNumber: 'BK-1', baseServicePrice: 100 },
  customer: { id: 'customer-1', addresses: [{ id: 'location-1', gstStateCode: '29' }] },
  serviceLocationId: 'location-1',
  service: { id: 'service-1', name: 'Repair', basePrice: 100, gstRate: 18, gstInclusive: false },
  company: { gstStateCode: '29' }, assignments: [], ...overrides,
});

function setup() {
  const tx = {
    serviceInvoice: { create: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'invoice-1', customer: { user: { id: 'customer-user' } } }) },
    invoiceItem: { deleteMany: jest.fn() },
    invoiceApprovalHistory: { create: jest.fn() },
  };
  const prisma = {
    workOrder: { findFirst: jest.fn().mockResolvedValue(work()), findUnique: jest.fn().mockResolvedValue({ manager: null }) },
    employee: { findUnique: jest.fn().mockResolvedValue(null) },
    serviceInvoice: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn() },
    $transaction: jest.fn(async (callback: (txClient: typeof tx) => unknown) => callback(tx)),
    company: { findUnique: jest.fn() },
    setting: { findUnique: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    invoiceApprovalHistory: { findMany: jest.fn() },
  };
  const settings = { getBoolean: jest.fn().mockResolvedValue(false), set: jest.fn() };
  const audit = { log: jest.fn() };
  const notifications = { notify: jest.fn() };
  return { service: new BillingService(prisma as never, settings as never, audit as never, notifications as never), prisma, tx, settings };
}

describe('BillingService', () => {
  it('calculates service price, charges, discount and intra-state GST on the backend', async () => {
    const { service, tx } = setup();
    tx.serviceInvoice.create.mockResolvedValue({ id: 'invoice-1' });

    await service.create({
      workOrderId: 'work-1', discountAmount: 10,
      items: [{ category: InvoiceItemCategory.MATERIAL, description: 'Filter', quantity: 1, unitPrice: 20 }],
    }, actor);

    const data = tx.serviceInvoice.create.mock.calls[0][0].data;
    expect(data.baseServicePrice.toString()).toBe('100');
    expect(data.subtotal.toString()).toBe('110');
    expect(data.taxableAmount.toString()).toBe('110');
    expect(data.gstAmount.toString()).toBe('19.8');
    expect(data.cgstAmount.toString()).toBe('9.9');
    expect(data.sgstAmount.toString()).toBe('9.9');
    expect(data.igstAmount.toString()).toBe('0');
    expect(data.finalAmount.toString()).toBe('129.8');
  });

  it('calculates inter-state GST as IGST', async () => {
    const { service, prisma, tx } = setup();
    prisma.workOrder.findFirst.mockResolvedValue(work({ customer: { id: 'customer-1', addresses: [{ id: 'location-1', gstStateCode: '27' }] } }));
    tx.serviceInvoice.create.mockResolvedValue({ id: 'invoice-1' });

    await service.create({ workOrderId: 'work-1' }, actor);

    const data = tx.serviceInvoice.create.mock.calls[0][0].data;
    expect(data.igstAmount.toString()).toBe('18');
    expect(data.cgstAmount.toString()).toBe('0');
    expect(data.sgstAmount.toString()).toBe('0');
  });

  it('allows a technician assigned to the completed work to create a draft using the booking price snapshot', async () => {
    const { service, prisma, tx } = setup();
    prisma.workOrder.findFirst.mockResolvedValue(work({ assignments: [{ employeeId: 'employee-1', status: 'COMPLETED' }] }));
    tx.serviceInvoice.create.mockResolvedValue({ id: 'invoice-1' });
    const technician = { ...actor, id: 'tech-user', role: Role.EMPLOYEE, employeeId: 'employee-1' };

    await service.create({ workOrderId: 'work-1' }, technician);

    expect(tx.serviceInvoice.create.mock.calls[0][0].data.baseServicePrice.toString()).toBe('100');
    expect(tx.serviceInvoice.create.mock.calls[0][0].data.createdById).toBe('tech-user');
  });

  it('rejects billing creation for a technician not assigned to the work order', async () => {
    const { service } = setup();
    const technician = { ...actor, role: Role.EMPLOYEE, employeeId: 'employee-2' };
    await expect(service.create({ workOrderId: 'work-1' }, technician)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents self approval by default', async () => {
    const { service, prisma } = setup();
    prisma.serviceInvoice.findFirst.mockResolvedValue({
      id: 'invoice-1', companyId, status: ServiceInvoiceStatus.PENDING_APPROVAL, createdById: actor.id,
      workOrder: { id: 'work-1', workOrderNumber: 'WO-1', managerId: 'manager-1' },
    });
    await expect(service.decide('invoice-1', true, undefined, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('supports resubmitting a rejected draft for approval', async () => {
    const { service, prisma, tx } = setup();
    prisma.serviceInvoice.findFirst.mockResolvedValue({
      id: 'invoice-1', companyId, workOrderId: 'work-1', status: ServiceInvoiceStatus.REJECTED, createdById: actor.id,
      workOrder: { id: 'work-1', workOrderNumber: 'WO-1', managerId: 'manager-1' },
    });

    await service.submit('invoice-1', actor);

    expect(tx.serviceInvoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'invoice-1', status: ServiceInvoiceStatus.REJECTED },
      data: expect.objectContaining({ status: ServiceInvoiceStatus.PENDING_APPROVAL, rejectionReason: null }),
    }));
    expect(tx.invoiceApprovalHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'RESUBMITTED' }) }));
  });

  it('does not expose a pre-final invoice to the customer', async () => {
    const { service, prisma } = setup();
    prisma.serviceInvoice.findFirst.mockResolvedValue({
      id: 'invoice-1', companyId, status: ServiceInvoiceStatus.PENDING_APPROVAL, customerId: 'customer-1',
      workOrder: { id: 'work-1', workOrderNumber: 'WO-1', managerId: 'manager-1' },
    });
    const customer = { ...actor, id: 'customer-user', role: Role.CUSTOMER };

    await expect(service.get('invoice-1', customer)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a work order outside the actor company', async () => {
    const { service, prisma } = setup();
    prisma.workOrder.findFirst.mockResolvedValue(null);
    await expect(service.create({ workOrderId: 'other-company-work' }, { ...actor, companyId: 'company-other' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows the authorized manager to approve submitted billing', async () => {
    const { service, prisma, tx } = setup();
    prisma.serviceInvoice.findFirst.mockResolvedValue({
      id: 'invoice-1', companyId, status: ServiceInvoiceStatus.PENDING_APPROVAL, createdById: 'employee-1',
      workOrder: { id: 'work-1', workOrderNumber: 'WO-1', managerId: 'manager-1' },
    });
    const manager = { ...actor, id: 'manager-user', role: Role.MANAGER, managerId: 'manager-1' };

    await service.decide('invoice-1', true, 'Checked', manager);

    expect(tx.serviceInvoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'invoice-1', status: ServiceInvoiceStatus.PENDING_APPROVAL },
      data: expect.objectContaining({ status: ServiceInvoiceStatus.APPROVED, approvedById: 'manager-user' }),
    }));
    expect(tx.invoiceApprovalHistory.create).toHaveBeenCalled();
  });

  it('finalizes only through the admin endpoint and records the transition', async () => {
    const { service, prisma, tx } = setup();
    prisma.serviceInvoice.findFirst.mockResolvedValue({
      id: 'invoice-1', companyId, status: ServiceInvoiceStatus.APPROVED,
      workOrder: { id: 'work-1', workOrderNumber: 'WO-1', managerId: 'manager-1' },
    });

    await service.finalize('invoice-1', actor);

    expect(tx.serviceInvoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'invoice-1', status: ServiceInvoiceStatus.APPROVED },
      data: expect.objectContaining({ status: ServiceInvoiceStatus.FINALIZED, finalizedById: actor.id }),
    }));
    expect(tx.invoiceApprovalHistory.create).toHaveBeenCalled();
  });

  it('does not allow a draft to be finalized', async () => {
    const { service, prisma } = setup();
    prisma.serviceInvoice.findFirst.mockResolvedValue({
      id: 'invoice-1', companyId, status: ServiceInvoiceStatus.DRAFT,
      workOrder: { id: 'work-1', workOrderNumber: 'WO-1', managerId: 'manager-1' },
    });
    await expect(service.finalize('invoice-1', actor)).rejects.toBeInstanceOf(BadRequestException);
  });
});
