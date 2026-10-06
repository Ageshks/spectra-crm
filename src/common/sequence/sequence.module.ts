import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

const PAD = 6;

/**
 * Concurrency-safe sequential document numbers (BOOK-2026-000001, ...).
 * Uses a row lock on a Setting counter, so two requests can never get
 * the same number even under parallel load.
 */
@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(prefix: string, at: Date = new Date()): Promise<string> {
    const year = at.getFullYear();
    const key = `SEQ_${prefix}_${year}`;

    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: '0', description: `Sequence counter for ${prefix}` },
      update: {},
    });

    const value = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ value: string }>>`
        SELECT value FROM "Setting" WHERE key = ${key} FOR UPDATE
      `;
      const current = Number(rows[0]?.value ?? '0') || 0;
      const nextValue = current + 1;
      await tx.setting.update({ where: { key }, data: { value: String(nextValue) } });
      return nextValue;
    });

    return `${prefix}-${year}-${String(value).padStart(PAD, '0')}`;
  }
}

@Global()
@Module({
  providers: [SequenceService],
  exports: [SequenceService],
})
export class SequenceModule {}
