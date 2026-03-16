export const ExecutionCtrlEventTypes = {
  ORDER_SUBMITTED: 'ORDER_SUBMITTED',
  ORDER_STAGED: 'ORDER_STAGED',
  EXECUTION_PAUSED: 'EXECUTION_PAUSED',
  EXECUTION_RESUMED: 'EXECUTION_RESUMED',
} as const;

export type ExecutionCtrlEventType =
  (typeof ExecutionCtrlEventTypes)[keyof typeof ExecutionCtrlEventTypes];
