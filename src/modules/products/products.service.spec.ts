import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { describe, expect, it, jest } from '@jest/globals';
import { ProductsService } from './products.service';

const actor = {
  id: 'manager-user',
  role: Role.MANAGER,
  companyId: 'company-1',
} as const;

const imageFile = (name: string): Express.Multer.File =>
  ({
    originalname: name,
    mimetype: 'image/jpeg',
    size: 10,
    buffer: Buffer.from('image'),
  }) as Express.Multer.File;

function setup() {
  const prisma = {
    company: { findFirst: jest.fn().mockResolvedValue({ id: 'company-1' }) },
    $transaction: jest.fn().mockResolvedValue([[{ id: 'active-product' }], 1]),
    product: {
      create: jest.fn().mockResolvedValue({ id: 'product-1', name: 'Filter', photos: [] }),
      findMany: jest.fn().mockResolvedValue([{ id: 'active-product' }]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue({ id: 'active-product' }),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const cloudinary = {
    uploadImage: jest.fn().mockImplementation((file: Express.Multer.File) =>
      Promise.resolve({
        imageUrl: `https://images.test/${file.originalname}`,
        thumbnailUrl: `https://images.test/thumb/${file.originalname}`,
        publicId: file.originalname,
        format: 'jpg',
        bytes: file.size,
      }),
    ),
    deleteImage: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new ProductsService(prisma as never, audit as never, cloudinary as never),
    prisma,
    cloudinary,
  };
}

describe('ProductsService', () => {
  it('lists only active products for the requested company for app users', async () => {
    const { service, prisma } = setup();

    await service.listPublic({ companySlug: 'Example-Co', isActive: false });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          company: { isActive: true, slug: 'example-co' },
        },
      }),
    );
    expect(prisma.product.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          company: { isActive: true, slug: 'example-co' },
        },
      }),
    );
  });

  it('gets only active products through the public product endpoint', async () => {
    const { service, prisma } = setup();

    await service.getPublicById('active-product');

    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'active-product',
          isActive: true,
          company: { isActive: true },
        },
      }),
    );
  });

  it('creates a company product with up to two uploaded photos for a manager', async () => {
    const { service, prisma, cloudinary } = setup();
    const files = [imageFile('front.jpg'), imageFile('back.jpg')];

    await service.create({ name: ' Filter ', description: ' Clean water ', price: 99.5 }, files, actor);

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          name: 'Filter',
          description: 'Clean water',
          price: 99.5,
          photos: {
            create: [
              expect.objectContaining({ publicId: 'front.jpg', position: 0 }),
              expect.objectContaining({ publicId: 'back.jpg', position: 1 }),
            ],
          },
        }),
      }),
    );
    expect(cloudinary.uploadImage).toHaveBeenCalledTimes(2);
  });

  it('rejects more than two product photos', async () => {
    const { service, prisma, cloudinary } = setup();

    await expect(
      service.create(
        { name: 'Filter', price: 99.5 },
        [imageFile('one.jpg'), imageFile('two.jpg'), imageFile('three.jpg')],
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('prevents a manager from creating a product for another company', async () => {
    const { service, prisma } = setup();

    await expect(
      service.create({ companyId: 'company-2', name: 'Filter', price: 99.5 }, [], actor),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.company.findFirst).not.toHaveBeenCalled();
  });
});
