import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(
  ['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition', 'DepositDetected', 'WithdrawalCompleted'],
  {
    'DepositDetected:INSERT': 'DEPOSIT_DETECTED',
    'WithdrawalCompleted:INSERT': 'WITHDRAWAL_COMPLETED',
  },
);

describe('broker-adpt event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'broker-adpt', eventTypeMap });

  it('publishes VIRTUAL_TRADE_CREATED for VirtualTrade INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'VirtualTrade', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('VIRTUAL_TRADE_CREATED');
  });

  it('should map DepositDetected:INSERT to DEPOSIT_DETECTED', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', {
        __typename: 'DepositDetected',
        tenantId: 't1',
        depositId: 'dep-1',
        amountCents: 10000,
        currency: 'USD',
      }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('DEPOSIT_DETECTED');
  });

  it('should map WithdrawalCompleted:INSERT to WITHDRAWAL_COMPLETED', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', {
        __typename: 'WithdrawalCompleted',
        tenantId: 't1',
        withdrawalId: 'w-1',
      }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('WITHDRAWAL_COMPLETED');
  });
});
