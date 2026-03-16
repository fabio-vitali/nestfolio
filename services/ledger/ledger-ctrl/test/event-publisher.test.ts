import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(
  ['BalanceEvent', 'PortfolioEvent', 'LedgerEntryEvent'],
  {
    'BalanceEvent:INSERT': 'BALANCE_UPDATED',
    'PortfolioEvent:INSERT': 'PORTFOLIO_UPDATED',
    'LedgerEntryEvent:INSERT': 'LEDGER_ENTRY_RECORDED',
  },
);

describe('ledger-ctrl event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'ledger-ctrl', eventTypeMap });

  it('publishes BALANCE_UPDATED for BalanceEvent INSERT (custom)', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'BalanceEvent', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('BALANCE_UPDATED');
  });

  it('publishes BALANCE_EVENT_UPDATED for BalanceEvent MODIFY (convention)', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('MODIFY', { __typename: 'BalanceEvent', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('BALANCE_EVENT_UPDATED');
  });

  it('publishes PORTFOLIO_UPDATED for PortfolioEvent INSERT (custom)', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'PortfolioEvent', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('PORTFOLIO_UPDATED');
  });

  it('publishes LEDGER_ENTRY_RECORDED for LedgerEntryEvent INSERT (custom)', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'LedgerEntryEvent', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('LEDGER_ENTRY_RECORDED');
  });
});
