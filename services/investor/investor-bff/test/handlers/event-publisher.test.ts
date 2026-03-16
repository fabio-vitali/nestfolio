import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(
  ['Goal', 'RiskProfile', 'Mandate', 'OperatingModeRecord', 'InvestorProfile', 'Deposit', 'Withdrawal'],
  { 'Deposit:INSERT': 'DEPOSIT_INITIATED', 'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED' },
);

describe('investor-bff event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'investor-bff', eventTypeMap });

  it('publishes GOAL_CREATED for Goal INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Goal', tenantId: 't1', goalAmount: 100000 }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('GOAL_CREATED');
  });

  it('publishes DEPOSIT_INITIATED for Deposit INSERT (custom override)', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Deposit', tenantId: 't1', amount: 5000 }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('DEPOSIT_INITIATED');
  });

  it('publishes RISK_PROFILE_UPDATED for RiskProfile MODIFY', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('MODIFY', { __typename: 'RiskProfile', tenantId: 't1', score: 7 }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('RISK_PROFILE_UPDATED');
  });
});
