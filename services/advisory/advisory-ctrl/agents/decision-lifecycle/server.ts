import { serve } from '@hono/node-server';
import { createAgentServer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { AdvisoryCtrlEventTypes } from '../../src/domain/events';
import { invokeDecisionLifecycle } from './graph';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'],
  source: 'agent-orchestrator@advisory-ctrl',
  detailType: AdvisoryCtrlEventTypes.DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (payload) => invokeDecisionLifecycle(payload, emitter));

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('advisory-ctrl decision-lifecycle agent runtime listening on 0.0.0.0:8080');
