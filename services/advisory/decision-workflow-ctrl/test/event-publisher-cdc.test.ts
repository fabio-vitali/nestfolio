import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['DecisionPacket', 'AgentOutput', 'WorkflowTrigger']);

describe('decision-workflow-ctrl CDC event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'decision-workflow-ctrl', eventTypeMap });

  it('publishes DECISION_PACKET_CREATED for DecisionPacket INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'DecisionPacket', tenantId: 't1', status: 'INITIATED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('DECISION_PACKET_CREATED');
  });

  it('publishes DECISION_PACKET_UPDATED for DecisionPacket MODIFY', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('MODIFY', { __typename: 'DecisionPacket', tenantId: 't1', status: 'PROPOSED' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('DECISION_PACKET_UPDATED');
  });

  it('publishes AGENT_OUTPUT_CREATED for AgentOutput INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'AgentOutput', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('AGENT_OUTPUT_CREATED');
  });
});
