import { createCdcTestHarness, fakeDdbStreamRecord, StreamRecord } from '@nestfolio/event-processor';
import { BrokerSimEventTypes } from '../src/domain/events';

const eventTypeMap = {
  'VirtualTrade:INSERT': (record: StreamRecord) =>
    record.status === 'REJECTED'
      ? BrokerSimEventTypes.SIM_ORDER_REJECTED
      : BrokerSimEventTypes.SIM_ORDER_FILLED,
  'VirtualTrade:MODIFY': (record: StreamRecord) =>
    record.status === 'REJECTED'
      ? BrokerSimEventTypes.SIM_ORDER_REJECTED
      : BrokerSimEventTypes.SIM_ORDER_FILLED,
  'DepositDetected:INSERT': BrokerSimEventTypes.SIM_DEPOSIT_COMPLETED,
  'WithdrawalCompleted:INSERT': BrokerSimEventTypes.SIM_WITHDRAWAL_COMPLETED,
};

describe('broker-sim-adpt event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'broker-sim-adpt', eventTypeMap });

  it('publishes SIM_ORDER_FILLED for VirtualTrade INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'VirtualTrade', tenantId: 't1', status: 'FILLED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('SIM_ORDER_FILLED');
  });

  it('publishes SIM_ORDER_REJECTED for VirtualTrade INSERT with status=REJECTED', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'VirtualTrade', tenantId: 't1', status: 'REJECTED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('SIM_ORDER_REJECTED');
  });

  it('should map DepositDetected:INSERT to SIM_DEPOSIT_COMPLETED', async () => {
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
    expect(result.publishedEvents[0].eventType).toBe('SIM_DEPOSIT_COMPLETED');
  });

  it('should map WithdrawalCompleted:INSERT to SIM_WITHDRAWAL_COMPLETED', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', {
        __typename: 'WithdrawalCompleted',
        tenantId: 't1',
        withdrawalId: 'w-1',
      }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('SIM_WITHDRAWAL_COMPLETED');
  });
});
