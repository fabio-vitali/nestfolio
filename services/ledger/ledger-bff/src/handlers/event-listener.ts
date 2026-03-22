import { materializeToTable, toUow } from '@nestfolio/event-processor';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import { balanceUpdated } from '../transforms/balance-updated';
import { portfolioUpdated } from '../transforms/portfolio-updated';
import { ledgerEntryRecorded } from '../transforms/ledger-entry-recorded';

export const handler = materializeToTable({
  serviceName: 'ledger-bff',
  handlers: {
    [LedgerCtrlEventTypes.BALANCE_UPDATED]: (payload, ctx) =>
      balanceUpdated(toUow(payload, ctx)),
    [LedgerCtrlEventTypes.PORTFOLIO_UPDATED]: (payload, ctx) =>
      portfolioUpdated(toUow(payload, ctx)),
    [LedgerCtrlEventTypes.LEDGER_ENTRY_RECORDED]: (payload, ctx) =>
      ledgerEntryRecorded(toUow(payload, ctx)),
  },
  errorEventType: 'LEDGER_BFF_FAILED',
});
