import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(
  ['ReconciliationResult', 'DriftRecord'],
  {
    'ReconciliationResult:INSERT': 'RECONCILIATION_COMPLETED',
    'DriftRecord:INSERT': 'PORTFOLIO_DRIFT_DETECTED',
  },
);

describe('reconciliation-ctrl event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'reconciliation-ctrl', eventTypeMap });

  it('publishes RECONCILIATION_COMPLETED for ReconciliationResult INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'ReconciliationResult', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('RECONCILIATION_COMPLETED');
  });

  it('publishes PORTFOLIO_DRIFT_DETECTED for DriftRecord INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'DriftRecord', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('PORTFOLIO_DRIFT_DETECTED');
  });
});
