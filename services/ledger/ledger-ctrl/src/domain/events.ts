import { eventName } from '@nestfolio/event-types';

export const LedgerCtrlEventTypes = {
  BALANCE_UPDATED: eventName('BALANCE_UPDATED'),
  PORTFOLIO_UPDATED: eventName('PORTFOLIO_UPDATED'),
  LEDGER_ENTRY_RECORDED: eventName('LEDGER_ENTRY_RECORDED'),
  LEDGER_PROCESSING_FAILED: eventName('LEDGER_PROCESSING_FAILED'),
  LEDGER_SIMULATION_FAILED: eventName('LEDGER_SIMULATION_FAILED'),
} as const;
