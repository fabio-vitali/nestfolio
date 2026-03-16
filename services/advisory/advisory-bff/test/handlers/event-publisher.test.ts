import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['DecisionReadModel', 'UserInteraction', 'UserConfirmation', 'UserRejection']);

describe('advisory-bff event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'advisory-bff', eventTypeMap });

  it('publishes DECISION_READ_MODEL_CREATED for DecisionReadModel INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'DecisionReadModel', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('DECISION_READ_MODEL_CREATED');
  });

  it('publishes USER_CONFIRMATION_CREATED for UserConfirmation INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'UserConfirmation', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('USER_CONFIRMATION_CREATED');
  });
});
