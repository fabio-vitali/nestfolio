// services/advisory/market-intelligence-ctrl/agents/market-intelligence/server.ts
import { serve } from '@hono/node-server';
import { createAgentServer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { MarketIntelligenceEventTypes } from '../../src/domain/events';
import { invokeMarketResearch } from './graph';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'],
  source: 'agent-orchestrator@market-intelligence-ctrl',
  detailType: MarketIntelligenceEventTypes.MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (payload) => invokeMarketResearch(payload, emitter));

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('market-intelligence-ctrl agent runtime listening on 0.0.0.0:8080');
