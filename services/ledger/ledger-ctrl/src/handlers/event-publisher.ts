import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'ledger-ctrl',
  eventTypeMap: buildEventTypeMap(
    ['BalanceEvent', 'PortfolioEvent', 'LedgerEntryEvent'],
    {
      'BalanceEvent:INSERT': 'BALANCE_UPDATED',
      'PortfolioEvent:INSERT': 'PORTFOLIO_UPDATED',
      'LedgerEntryEvent:INSERT': 'LEDGER_ENTRY_RECORDED',
    },
  ),
});
