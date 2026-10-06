import { WorkOrderStatus } from '@prisma/client';
import { WORK_ORDER_TRANSITIONS } from './work-order-transitions';

describe('WorkOrderStatusService', () => {
  const canTransition = (from: WorkOrderStatus, to: WorkOrderStatus): boolean =>
    WORK_ORDER_TRANSITIONS[from]?.includes(to) ?? false;

  it('accepts the specified forward workflow transitions', () => {
    expect(canTransition(WorkOrderStatus.ASSIGNED, WorkOrderStatus.ACCEPTED)).toBe(true);
    expect(canTransition(WorkOrderStatus.ACCEPTED, WorkOrderStatus.IN_PROGRESS)).toBe(true);
    expect(canTransition(WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED)).toBe(true);
    expect(canTransition(WorkOrderStatus.COMPLETED, WorkOrderStatus.UNDER_REVIEW)).toBe(true);
    expect(canTransition(WorkOrderStatus.UNDER_REVIEW, WorkOrderStatus.APPROVED)).toBe(true);
    expect(
      canTransition(
        WorkOrderStatus.UNDER_REVIEW,
        WorkOrderStatus.CORRECTION_REQUIRED,
      ),
    ).toBe(true);
    expect(
      canTransition(
        WorkOrderStatus.CORRECTION_REQUIRED,
        WorkOrderStatus.IN_PROGRESS,
      ),
    ).toBe(true);
  });

  it('rejects transitions outside the state graph', () => {
    for (const [from, allowed] of Object.entries(WORK_ORDER_TRANSITIONS)) {
      for (const to of Object.values(WorkOrderStatus)) {
        expect(canTransition(from as WorkOrderStatus, to)).toBe(allowed.includes(to));
      }
    }
    expect(canTransition(WorkOrderStatus.APPROVED, WorkOrderStatus.IN_PROGRESS)).toBe(false);
    expect(canTransition(WorkOrderStatus.ASSIGNED, WorkOrderStatus.APPROVED)).toBe(false);
  });
});
