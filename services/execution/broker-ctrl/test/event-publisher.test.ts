import { createCdcTestHarness, fakeDdbStreamRecord } from '@nestfolio/event-processor';

const eventTypeMap = {
  'NormalizedEvent:INSERT': (record: Record<string, unknown>) => {
    const sk = record.sk as string ?? '';
    return sk;
  },
};

describe('broker-ctrl event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'broker-ctrl', eventTypeMap });

  it('NormalizedEvent INSERT with sk=ORDER_FILLED emits ORDER_FILLED', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', {
        __typename: 'NormalizedEvent',
        tenantId: 't1',
        sk: 'ORDER_FILLED',
        orderId: 'order-1',
      }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_FILLED');
  });

  it('NormalizedEvent INSERT with sk=ORDER_REJECTED emits ORDER_REJECTED', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', {
        __typename: 'NormalizedEvent',
        tenantId: 't1',
        sk: 'ORDER_REJECTED',
        orderId: 'order-2',
        failureReason: 'insufficient funds',
      }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_REJECTED');
  });

  it('NormalizedEvent INSERT with sk=ORDER_ESCALATED emits ORDER_ESCALATED', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', {
        __typename: 'NormalizedEvent',
        tenantId: 't1',
        sk: 'ORDER_ESCALATED',
        orderId: 'order-3',
      }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_ESCALATED');
  });

  it('NormalizedEvent INSERT with sk=BROKER_CIRCUIT_OPEN emits BROKER_CIRCUIT_OPEN', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', {
        __typename: 'NormalizedEvent',
        tenantId: 't1',
        sk: 'BROKER_CIRCUIT_OPEN',
      }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('BROKER_CIRCUIT_OPEN');
  });

  it('BrokerOrder MODIFY does not emit events (not a publishable type)', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('MODIFY', {
        __typename: 'BrokerOrder',
        tenantId: 't1',
        state: 'FILLED',
      }),
    ]);
    expect(result.publishedEvents).toHaveLength(0);
  });
});
