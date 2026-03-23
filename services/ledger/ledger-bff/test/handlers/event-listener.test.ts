import { createHandlers } from '../../src/handlers/event-listener';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';

describe('ledger-bff event-listener', () => {
  it('should export handlers for all 3 event types', () => {
    const handlers = createHandlers();

    expect(Object.keys(handlers)).toHaveLength(3);

    expect(handlers).toHaveProperty(LedgerCtrlEventTypes.BALANCE_UPDATED);
    expect(handlers).toHaveProperty(LedgerCtrlEventTypes.PORTFOLIO_UPDATED);
    expect(handlers).toHaveProperty(LedgerCtrlEventTypes.LEDGER_ENTRY_RECORDED);
  });
});
