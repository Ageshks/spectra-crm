import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ExportFormat, ExportStatus, Prisma, Role } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { EXPORT_TYPES } from '../../common/constants';
import { AuthUser } from '../../common/types/auth.types';
import { normalizePagination, paginated } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { QueueService } from '../../queues/queues.module';
import { ExportStorageService } from './export-storage.service';
import { CreateExportDto, ListExportsDto } from './dto/exports.dto';

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
    private readonly storage: ExportStorageService,
  ) {}

  private isAdmin(actor: AuthUser): boolean {
    return actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN;
  }

  async create(dto: CreateExportDto, actor: AuthUser): Promise<unknown> {
    const type = dto.type;
    if (!Object.values(EXPORT_TYPES).includes(type as any)) {
      throw new BadRequestException('Unsupported export type');
    }
    if (type === EXPORT_TYPES.CUSTOMERS && !this.isAdmin(actor) && actor.role !== Role.MANAGER) {
      throw new ForbiddenException('Insufficient permissions to export customers');
    }

    const format = dto.format ?? ExportFormat.CSV;
    const filters = { ...(dto.filters ?? {}) } as Record<string, unknown>;
    if (dto.rowLimit) filters.rowLimit = dto.rowLimit;

    const job = await this.prisma.exportJob.create({
      data: {
        userId: actor.id,
        type,
        format,
        filters: filters as Prisma.InputJsonValue,
        status: ExportStatus.PENDING,
      },
    });

    try {
      await this.queues.enqueueExport(job.id);
    } catch (error) {
      this.logger.error(`Failed to enqueue export ${job.id}: ${String(error)}`);
      await this.prisma.exportJob.update({
        where: { id: job.id },
        data: { status: ExportStatus.FAILED, error: 'Failed to enqueue export job' },
      });
      throw error;
    }

    await this.audit.log({
      action: 'EXPORT_CREATE',
      module: 'exports',
      entity: 'ExportJob',
      entityId: job.id,
      userId: actor.id,
      newValues: { type, format, filters } as Prisma.InputJsonValue,
    });

    return job;

  }

  async list(query: ListExportsDto, actor: AuthUser): Promise<unknown> {
    const { skip, take, page, limit } = normalizePagination(query);
    const where: Prisma.ExportJobWhereInput = {};
    if (!this.isAdmin(actor) && actor.role !== Role.MANAGER) {
      where.userId = actor.id;
    }
    if (query.status) where.status = query.status as ExportStatus;
    if (query.type) where.type = query.type;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.exportJob.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.exportJob.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async get(id: string, actor: AuthUser): Promise<unknown> {
    const job = await this.prisma.exportJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Export job not found');
    if (!this.canAccess(job, actor)) throw new ForbiddenException('Access denied');
    return job;
  }

  private canAccess(job: { userId: string }, actor: AuthUser): boolean {
    if (this.isAdmin(actor)) return true;
    if (actor.role === Role.MANAGER) return true;
    return job.userId === actor.id;

  }

  async download(id: string, actor: AuthUser): Promise<{ absolutePath: string; filename: string; mimeType: string }> {
    const job = await this.prisma.exportJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Export job not found');
    if (!this.canAccess(job, actor)) throw new ForbiddenException('Access denied');
    if (job.status !== ExportStatus.COMPLETED || !job.fileUrl) {
      throw new BadRequestException('Export is not ready for download');
    }
    const exists = await this.storage.exists(job.fileUrl);
    if (!exists) {
      throw new NotFoundException('Export file no longer available');
    }
    const ext = job.fileUrl.split('.').pop()?.toLowerCase() ?? 'csv';
    const mimeType = ext === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv';
    const filename = `${job.type}-${job.id}.${ext}`;
    return { absolutePath: this.storage.resolve(job.fileUrl), filename, mimeType };
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    const job = await this.prisma.exportJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Export job not found');
    if (job.userId !== actor.id && !this.isAdmin(actor)) {
      throw new ForbiddenException('Access denied');
    }
    if (job.fileUrl) await this.storage.remove(job.fileUrl);
    await this.prisma.exportJob.delete({ where: { id } });
    await this.audit.log({
      action: 'EXPORT_DELETE',
      module: 'exports',
      entity: 'ExportJob',
      entityId: id,
      userId: actor.id,
    });
  }

  async cleanupExpired(): Promise<number> {
    const now = new Date();
    const expired = await this.prisma.exportJob.findMany({
      where: { expiresAt: { lt: now }, fileUrl: { not: null } },
    });
    let removed = 0;
    for (const job of expired) {
      if (job.fileUrl) await this.storage.remove(job.fileUrl);
      await this.prisma.exportJob.update({
        where: { id: job.id },
        data: { fileUrl: null, status: ExportStatus.EXPIRED },
      }).catch(() => undefined);
      removed++;
    }
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await this.prisma.exportJob.deleteMany({
      where: { createdAt: { lt: cutoff }, status: { in: [ExportStatus.FAILED, ExportStatus.EXPIRED] } },
    });
    return removed;
  }
}