import { materializeToTable, toUow } from '@nestfolio/event-processor';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import { balanceUpdated } from '../transforms/balance-updated';
import { portfolioUpdated } from '../transforms/portfolio-updated';
import { ledgerEntryRecorded } from '../transforms/ledger-entry-recorded';

export function createHandlers() {
  return {
    [LedgerCtrlEventTypes.BALANCE_UPDATED]: (payload: any, ctx: any) =>
      balanceUpdated(toUow(payload, ctx)),
    [LedgerCtrlEventTypes.PORTFOLIO_UPDATED]: (payload: any, ctx: any) =>
      portfolioUpdated(toUow(payload, ctx)),
    [LedgerCtrlEventTypes.LEDGER_ENTRY_RECORDED]: (payload: any, ctx: any) =>
      ledgerEntryRecorded(toUow(payload, ctx)),
  };
}

export const handler = materializeToTable({
  serviceName: 'ledger-bff',
  handlers: createHandlers(),
  errorEventType: 'LEDGER_BFF_FAILED',
});
