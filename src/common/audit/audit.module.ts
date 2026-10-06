import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RequestContext } from '../middleware/request-context';

export interface AuditEntry {
  action: string;
  module: string;
  entity: string;
  entityId?: string;
  userId?: string;
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Persists an audit entry. Failures are logged but never break the request. */
  async log(entry: AuditEntry): Promise<void> {
    const context = RequestContext.get();
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          module: entry.module,
          entity: entry.entity,
          entityId: entry.entityId,
          userId: entry.userId,
          oldValues: entry.oldValues,
          newValues: entry.newValues,
          ipAddress: context.ip,
          userAgent: context.userAgent,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log: ${entry.module}/${entry.action}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
