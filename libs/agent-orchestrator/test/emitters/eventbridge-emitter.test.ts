import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { eventName } from '@nestfolio/event-types';
import { EventBridgeTraceEmitter } from '../../src/emitters/eventbridge-emitter';
import type { AgentTraceEnvelope } from '../../src/agent-tracer';

const ebMock = mockClient(EventBridgeClient);

describe('EventBridgeTraceEmitter', () => {
  beforeEach(() => { ebMock.reset(); });

  const baseEnvelope: AgentTraceEnvelope = {
    'gen_ai.invocation.started_at': new Date(0).toISOString(),
    'gen_ai.invocation.completed_at': new Date(1000).toISOString(),
    'gen_ai.invocation.latency_ms': 1000,
    status: 'success',
    llmCalls: [],
    toolCalls: [],
    nodeSequence: [],
    errors: [],
  };

  it('emits a PutEventsCommand with the supplied source, detailType, bus, and serialised detail', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'e1' }] });
    const emitter = new EventBridgeTraceEmitter({
      busName: 'advisory-bus',
      source: 'agent-orchestrator@advisory-ctrl',
      detailType: eventName('DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED'),
    });

    await emitter.emit(baseEnvelope, { tenantId: 'tenant-1', correlationId: 'decision-1', agent: 'decision-lifecycle' });

    const call = ebMock.commandCalls(PutEventsCommand).at(0);
    expect(call).toBeDefined();
    const entry = call!.args[0].input.Entries![0];
    expect(entry.Source).toBe('agent-orchestrator@advisory-ctrl');
    expect(entry.DetailType).toBe('DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED');
    expect(entry.EventBusName).toBe('advisory-bus');
    const detail = JSON.parse(entry.Detail!);
    expect(detail.context.tenantId).toBe('tenant-1');
    expect(detail.correlationId).toBe('decision-1');
    expect(detail.agent).toBe('decision-lifecycle');
    expect(detail.envelope).toEqual(baseEnvelope);
    expect(new Date(detail.emittedAt).toString()).not.toBe('Invalid Date');
  });

  it('is a no-op when busName is empty — no PutEvents call issued', async () => {
    const emitter = new EventBridgeTraceEmitter({
      busName: '',
      source: 'agent-orchestrator@advisory-ctrl',
      detailType: eventName('DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED'),
    });
    await emitter.emit(baseEnvelope, { tenantId: 't', correlationId: 'c', agent: 'a' });
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });

  it('propagates errors from the underlying client', async () => {
    ebMock.on(PutEventsCommand).rejects(new Error('eb-down'));
    const emitter = new EventBridgeTraceEmitter({
      busName: 'advisory-bus',
      source: 'agent-orchestrator@advisory-ctrl',
      detailType: eventName('DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED'),
    });
    await expect(
      emitter.emit(baseEnvelope, { tenantId: 't', correlationId: 'c', agent: 'a' }),
    ).rejects.toThrow('eb-down');
  });
});
