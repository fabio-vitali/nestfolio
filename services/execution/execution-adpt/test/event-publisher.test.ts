import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition']);

describe('execution-adpt event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'execution-adpt', eventTypeMap });

  it('publishes VIRTUAL_TRADE_CREATED for VirtualTrade INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'VirtualTrade', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('VIRTUAL_TRADE_CREATED');
  });
});
