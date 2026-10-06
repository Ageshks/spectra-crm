import { WorkOrderStatus } from '@prisma/client';

/** Allowed work-order transitions. */
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  ASSIGNED: [WorkOrderStatus.ACCEPTED, WorkOrderStatus.CANCELLED],
  ACCEPTED: [WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.CANCELLED],
  IN_PROGRESS: [
    WorkOrderStatus.ON_HOLD,
    WorkOrderStatus.COMPLETED,
    WorkOrderStatus.CANCELLED,
  ],
  ON_HOLD: [WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.CANCELLED],
  COMPLETED: [WorkOrderStatus.UNDER_REVIEW],
  UNDER_REVIEW: [WorkOrderStatus.APPROVED, WorkOrderStatus.CORRECTION_REQUIRED],
  CORRECTION_REQUIRED: [WorkOrderStatus.IN_PROGRESS],
  APPROVED: [],
  CANCELLED: [],
};
