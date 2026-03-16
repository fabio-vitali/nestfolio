import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['Order', 'StagedOrder']);

describe('execution-ctrl event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'execution-ctrl', eventTypeMap });

  it('publishes ORDER_CREATED for Order INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Order', tenantId: 't1', orderId: 'o1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_CREATED');
  });

  it('publishes ORDER_UPDATED for Order MODIFY', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('MODIFY', { __typename: 'Order', tenantId: 't1', status: 'FILLED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_UPDATED');
  });
});
