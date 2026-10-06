import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WorkOrderStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { PrismaService } from '../../database/prisma.service';
import { WORK_ORDER_TRANSITIONS } from './work-order-transitions';

export { WORK_ORDER_TRANSITIONS } from './work-order-transitions';

/**
 * Allowed work-order status transitions (spec §64). Any transition that is not
 * listed here is rejected with a 400 error.
 */
export interface TransitionOptions {
  actorId?: string;
  note?: string;
  /** Skip persistence — used purely for validation. */
  validateOnly?: boolean;
}

@Injectable()
export class WorkOrderStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
    return WORK_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
  }

  private assertValid(from: WorkOrderStatus, to: WorkOrderStatus): void {
    if (from === to) {
      throw new BadRequestException(`Work order is already in ${to} status`);
    }
    if (!this.canTransition(from, to)) {
      throw new BadRequestException(`Invalid status transition: ${from} → ${to}`);
    }
  }

  /**
   * Validates and applies a single transition, recording an audit entry and a
   * WorkOrderStatusLog row inside the same transaction.
   */
  async apply(workOrderId: string, to: WorkOrderStatus, options: TransitionOptions = {}): Promise<void> {
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id: workOrderId } });
    if (!workOrder) throw new NotFoundException('Work order not found');
    this.assertValid(workOrder.status, to);
    if (options.validateOnly) return;

    await this.applyWithExisting(workOrderId, workOrder.status, to, options);
  }

  /**
   * Same as apply() but when the caller already loaded the work order inside a
   * transaction (prevents stale-status transitions under concurrency).
   */
  async applyWithExisting(
    workOrderId: string,
    from: WorkOrderStatus,
    to: WorkOrderStatus,
    options: TransitionOptions = {},
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    this.assertValid(from, to);
    if (options.validateOnly) return;

    const client = tx ?? this.prisma;
    const completedAt = to === WorkOrderStatus.COMPLETED ? new Date() : undefined;

    await client.workOrder.update({
      where: { id: workOrderId },
      data: { status: to, ...(completedAt ? { completedAt } : {}) },
    });
    await client.workOrderStatusLog.create({
      data: {
        workOrderId,
        fromStatus: from,
        toStatus: to,
        changedById: options.actorId,
        note: options.note,
      },
    });

    await this.audit.log({
      action: 'WORK_ORDER_STATUS_CHANGED',
      module: 'work-orders',
      entity: 'WorkOrder',
      entityId: workOrderId,
      userId: options.actorId,
      oldValues: { status: from },
      newValues: { status: to, note: options.note },
    });
  }

  /**
   * Applies several hops in order (used when a resubmitted report has to walk
   * CORRECTION_REQUIRED → IN_PROGRESS → COMPLETED → UNDER_REVIEW). Stops and
   * throws on the first invalid hop so partial chains cannot be persisted —
   * the whole chain runs inside the caller's transaction.
   */
  async applyChain(
    workOrderId: string,
    chain: WorkOrderStatus[],
    options: TransitionOptions = {},
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id: workOrderId } });
    if (!workOrder) throw new NotFoundException('Work order not found');

    // Validate the entire chain up-front before persisting anything.
    let cursor: WorkOrderStatus = workOrder.status;
    for (const step of chain) {
      this.assertValid(cursor, step);
      cursor = step;
    }

    cursor = workOrder.status;
    for (const step of chain) {
      await this.applyWithExisting(workOrderId, cursor, step, options, tx);
      cursor = step;
    }
  }

  async history(workOrderId: string): Promise<unknown> {
    return this.prisma.workOrderStatusLog.findMany({
      where: { workOrderId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        note: true,
        createdAt: true,
        changedById: true,
      },
    });
  }
}
