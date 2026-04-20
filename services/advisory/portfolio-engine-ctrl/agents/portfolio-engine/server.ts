// services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/server.ts
import { serve } from '@hono/node-server';
import { createAgentServer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { PortfolioEngineEventTypes } from '../../src/domain/events';
import { invokePortfolioEngine } from './graph';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'],
  source: 'agent-orchestrator@portfolio-engine-ctrl',
  detailType: PortfolioEngineEventTypes.PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (payload) => invokePortfolioEngine(payload, emitter));

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('portfolio-engine-ctrl agent runtime listening on 0.0.0.0:8080');
