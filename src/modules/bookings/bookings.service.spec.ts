import { BadRequestException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { describe, expect, it, jest } from '@jest/globals';
import { BookingsService } from './bookings.service';

const companyId = 'company-1';
const product = {
  id: 'product-1',
  name: 'Water filter',
  description: 'Replacement filter',
  price: new Prisma.Decimal('25.50'),
};

function setup(products = [product]) {
  const prisma = {
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 'customer-1', companyId, userId: 'customer-user' }) },
    service: { findUnique: jest.fn().mockResolvedValue({ id: 'service-1', companyId, isActive: true, basePrice: new Prisma.Decimal('100.00') }) },
    product: { findMany: jest.fn().mockResolvedValue(products) },
    customerAddress: { findFirst: jest.fn().mockResolvedValue({ id: 'location-1', isActive: true }) },
    booking: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data, include }) => ({ id: 'booking-1', ...data, include })),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new BookingsService(
    prisma as never,
    { log: jest.fn() } as never,
    { next: jest.fn().mockResolvedValue('BOOK-1') } as never,
    { notifyMany: jest.fn() } as never,
  );
  const actor = {
    id: 'customer-user',
    role: Role.CUSTOMER,
    customerId: 'customer-1',
    companyId,
    email: 'customer@example.test',
    isActive: true,
  };
  return { service, prisma, actor };
}

describe('BookingsService product selections', () => {
  it('snapshots company product prices and includes them in the booking total', async () => {
    const { service, prisma, actor } = setup();

    await service.create({
      serviceId: 'service-1',
      serviceLocationId: 'location-1',
      preferredDate: '2099-01-01',
      preferredTime: '10:00',
      products: [{ productId: 'product-1', quantity: 2 }],
    }, actor);

    const data = prisma.booking.create.mock.calls[0][0].data;
    expect(data.totalAmount.toString()).toBe('151');
    expect(data.bookingProducts.create).toEqual([{
      productId: 'product-1',
      productName: 'Water filter',
      description: 'Replacement filter',
      quantity: 2,
      unitPrice: new Prisma.Decimal('25.50'),
      lineTotal: new Prisma.Decimal('51.00'),
    }]);
  });

  it('rejects duplicate product selections instead of charging ambiguously', async () => {
    const { service, actor } = setup();
    const dto = {
      serviceId: 'service-1',
      serviceLocationId: 'location-1',
      preferredDate: '2099-01-01',
      preferredTime: '10:00',
      products: [
        { productId: 'product-1', quantity: 1 },
        { productId: 'product-1', quantity: 2 },
      ],
    };

    await expect(service.create(dto, actor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects products that are inactive, missing, or outside the customer company', async () => {
    const { service, prisma, actor } = setup([]);

    await expect(service.create({
      serviceId: 'service-1',
      serviceLocationId: 'location-1',
      preferredDate: '2099-01-01',
      preferredTime: '10:00',
      products: [{ productId: 'product-1', quantity: 1 }],
    }, actor)).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ companyId, isActive: true }),
    }));
  });
});
