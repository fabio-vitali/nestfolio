import { serve } from '@hono/node-server';
import { createAgentServer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { NarrativeEventTypes } from '../../src/domain/events';
import { invokeNarrative } from './graph';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'],
  source: 'agent-orchestrator@advisory-narrative-ctrl',
  detailType: NarrativeEventTypes.ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (payload) => invokeNarrative(payload, emitter));

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('advisory-narrative-ctrl agent runtime listening on 0.0.0.0:8080');
