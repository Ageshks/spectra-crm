import { Role } from '@prisma/client';
import { describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { LocalWorkPhotoStorageService } from '../../common/uploads/uploads.module';
import { WorkPhotosService } from './work-photos.service';

describe('WorkPhotosService report linking', () => {
  it('links an upload without a report id to the work order draft report', async () => {
    const report = {
      id: 'report-1',
      workOrderId: 'work-order-1',
      status: 'DRAFT',
    };
    const photo = { id: 'photo-1', serviceReportId: report.id };
    const prisma = {
      workOrder: {
        findUnique: jest.fn().mockResolvedValue({
          companyId: 'company-1',
          assignments: [{ employee: { userId: 'employee-user-1' } }],
        }),
      },
      serviceReport: {
        findUnique: jest.fn().mockResolvedValue(report),
        findFirst: jest.fn().mockResolvedValue({ id: report.id }),
      },
      workPhoto: { create: jest.fn().mockResolvedValue(photo) },
    };
    const storage = {
      save: jest.fn().mockResolvedValue({
        imageUrl: 'https://images.example/photo.jpg',
        thumbnailUrl: 'https://images.example/thumb.jpg',
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const service = new WorkPhotosService(
      prisma as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      storage as never,
      { get: jest.fn().mockReturnValue({ maxFileSize: 1024 }) } as never,
    );

    await service.upload({
      originalname: 'work.jpg',
      mimetype: 'image/jpeg',
      size: 10,
      buffer: Buffer.from('image'),
    } as Express.Multer.File, { workOrderId: 'work-order-1' }, {
      id: 'employee-user-1',
      email: 'employee@example.test',
      role: Role.EMPLOYEE,
      isActive: true,
      companyId: 'company-1',
    });

    expect(prisma.serviceReport.findUnique).toHaveBeenCalledWith({
      where: { workOrderId: 'work-order-1' },
    });
    expect(storage.save).toHaveBeenCalledWith(expect.objectContaining({ originalname: 'work.jpg' }));
    expect(prisma.workPhoto.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ serviceReportId: report.id }),
    }));
  });
});

describe('LocalWorkPhotoStorageService', () => {
  it('compresses photos to JPEG on disk and removes local files', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'spectra-work-photos-'));
    const storage = new LocalWorkPhotoStorageService({
      get: jest.fn().mockReturnValue(storageRoot),
    } as never);
    const input = await sharp({
      create: {
        width: 2400,
        height: 1800,
        channels: 3,
        background: { r: 24, g: 96, b: 180 },
      },
    }).png().toBuffer();

    try {
      const saved = await storage.save({ buffer: input } as Express.Multer.File);
      const stored = await readFile(join(storageRoot, 'work-photos', saved.publicId));

      expect(saved.imageUrl).toMatch(/^\/uploads\/work-photos\/[0-9a-f-]+\.jpg$/);
      expect(saved.format).toBe('jpg');
      expect(saved.width).toBe(1920);
      expect(saved.height).toBe(1440);
      expect(saved.bytes).toBeLessThan(input.length);
      expect(stored).toEqual(expect.any(Buffer));

      await storage.delete(saved.imageUrl);
      await expect(readFile(join(storageRoot, 'work-photos', saved.publicId))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
});