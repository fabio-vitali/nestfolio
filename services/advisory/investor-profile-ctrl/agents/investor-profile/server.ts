// services/advisory/investor-profile-ctrl/agents/investor-profile/server.ts
import { serve } from '@hono/node-server';
import { createAgentServer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { InvestorProfileEventTypes } from '../../src/domain/events';
import { invokeInvestorProfile } from './graph';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'],
  source: 'agent-orchestrator@investor-profile-ctrl',
  detailType: InvestorProfileEventTypes.INVESTOR_PROFILE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (payload) => invokeInvestorProfile(payload, emitter));

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('investor-profile-ctrl agent runtime listening on 0.0.0.0:8080');
