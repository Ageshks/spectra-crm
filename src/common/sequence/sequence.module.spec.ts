import { describe, expect, it, jest } from '@jest/globals';
import { SequenceService } from './sequence.module';

describe('SequenceService', () => {
  it('casts the company setting identifier to UUID in the locked counter query', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ value: '4' }]),
      setting: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const prisma = {
      setting: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      $transaction: jest.fn(async (callback: (txClient: typeof tx) => unknown) => callback(tx)),
    };
    const sequence = new SequenceService(prisma as never);

    await expect(sequence.next('ENQ', new Date('2026-01-01T00:00:00Z'))).resolves.toBe(
      'ENQ-2026-000005',
    );

    const [query] = tx.$queryRaw.mock.calls[0];
    expect(query.join('')).toContain('"companyId" = ');
    expect(query.join('')).toContain('::uuid');
    expect(prisma.setting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId_key: { companyId: '00000000-0000-4000-8000-000000000001', key: 'SEQ_ENQ_2026' } },
    }));
  });
});
