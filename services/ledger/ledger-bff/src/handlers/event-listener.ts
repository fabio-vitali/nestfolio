// Side-effect import keeps the ReadModelOwnership augmentation explicit and
// resilient if the tsconfig `include` is ever narrowed. The `declare module`
// merge is global across the compilation; this import is not what "activates"
// it — do not infer that other handlers need it.
import '../read-model-ownership';
import { materializeToTable, toUow, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import { balanceUpdated } from '../transforms/balance-updated';
import { portfolioUpdated } from '../transforms/portfolio-updated';
import { ledgerEntryRecorded } from '../transforms/ledger-entry-recorded';

export function createHandlers() {
  return {
    [LedgerCtrlEventTypes.BALANCE_UPDATED]: (payload: EventPayload, ctx: EventContext) =>
      balanceUpdated(toUow(payload, ctx)),
    [LedgerCtrlEventTypes.PORTFOLIO_UPDATED]: (payload: EventPayload, ctx: EventContext) =>
      portfolioUpdated(toUow(payload, ctx)),
    [LedgerCtrlEventTypes.LEDGER_ENTRY_RECORDED]: (payload: EventPayload, ctx: EventContext) =>
      ledgerEntryRecorded(toUow(payload, ctx)),
  };
}

export const handler = materializeToTable({
  serviceName: 'ledger-bff',
  handlers: createHandlers(),
  errorEventType: 'LEDGER_BFF_FAILED',
});
