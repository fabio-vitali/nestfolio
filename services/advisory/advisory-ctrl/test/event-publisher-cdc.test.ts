import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['DecisionPacket', 'AgentInvocation', 'WorkflowState']);

describe('advisory-ctrl CDC event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'advisory-ctrl', eventTypeMap });

  it('publishes DECISION_PACKET_CREATED for DecisionPacket INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'DecisionPacket', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('DECISION_PACKET_CREATED');
  });

  it('publishes AGENT_INVOCATION_CREATED for AgentInvocation INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'AgentInvocation', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('AGENT_INVOCATION_CREATED');
  });
});
