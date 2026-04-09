import { eventName } from '@nestfolio/event-types';

export const ExecutionCtrlEventTypes = {
  ORDER_SUBMITTED: eventName('ORDER_SUBMITTED'),
  ORDER_STAGED: eventName('ORDER_STAGED'),
  EXECUTION_PAUSED: eventName('EXECUTION_PAUSED'),
  EXECUTION_RESUMED: eventName('EXECUTION_RESUMED'),
  STAGED_ORDER_CREATED: eventName('STAGED_ORDER_CREATED'),
  STAGED_ORDER_UPDATED: eventName('STAGED_ORDER_UPDATED'),
} as const;
