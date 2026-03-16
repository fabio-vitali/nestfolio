import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['Notification', 'MonthlyReport']);

describe('investor-ctrl event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'investor-ctrl', eventTypeMap });

  it('publishes NOTIFICATION_CREATED for Notification INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Notification', tenantId: 't1', channel: 'email' }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('NOTIFICATION_CREATED');
  });

  it('publishes MONTHLY_REPORT_CREATED for MonthlyReport INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'MonthlyReport', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('MONTHLY_REPORT_CREATED');
  });
});
