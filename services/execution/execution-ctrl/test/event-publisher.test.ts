import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';
import type { StreamRecord } from '@nestfolio/event-processor';

const eventTypeMap = {
  ...buildEventTypeMap(['Order', 'StagedOrder']),
  'Order:INSERT': (record: StreamRecord) => {
    switch (record['status']) {
      case 'SUBMITTED': return 'ORDER_SUBMITTED';
      case 'STAGED':    return 'ORDER_STAGED';
      case 'REJECTED':  return 'ORDER_REJECTED';
      default:          return 'ORDER_CREATED';
    }
  },
  'Order:MODIFY': (record: StreamRecord) => {
    switch (record['status']) {
      case 'SUBMITTED': return 'ORDER_SUBMITTED';
      case 'REJECTED':  return 'ORDER_REJECTED';
      default:          return 'ORDER_UPDATED';
    }
  },
};

describe('execution-ctrl event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'execution-ctrl', eventTypeMap });

  it('publishes ORDER_SUBMITTED for Order INSERT with status=SUBMITTED', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Order', tenantId: 't1', orderId: 'o1', status: 'SUBMITTED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_SUBMITTED');
  });

  it('publishes ORDER_STAGED for Order INSERT with status=STAGED', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Order', tenantId: 't1', orderId: 'o1', status: 'STAGED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_STAGED');
  });

  it('publishes ORDER_REJECTED for Order INSERT with status=REJECTED', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Order', tenantId: 't1', orderId: 'o1', status: 'REJECTED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_REJECTED');
  });

  it('publishes ORDER_CREATED for Order INSERT with unknown status', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Order', tenantId: 't1', orderId: 'o1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_CREATED');
  });

  it('publishes ORDER_SUBMITTED for Order MODIFY with status=SUBMITTED', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('MODIFY', { __typename: 'Order', tenantId: 't1', status: 'SUBMITTED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_SUBMITTED');
  });

  it('publishes ORDER_REJECTED for Order MODIFY with status=REJECTED', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('MODIFY', { __typename: 'Order', tenantId: 't1', status: 'REJECTED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_REJECTED');
  });

  it('publishes ORDER_UPDATED for Order MODIFY with other status', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('MODIFY', { __typename: 'Order', tenantId: 't1', status: 'FILLED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_UPDATED');
  });

  it('publishes STAGED_ORDER_CREATED for StagedOrder INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'StagedOrder', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('STAGED_ORDER_CREATED');
  });
});
