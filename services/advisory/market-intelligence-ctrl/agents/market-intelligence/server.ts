// services/advisory/market-intelligence-ctrl/agents/market-intelligence/server.ts
import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { invokeMarketResearch } from './graph';

const app = createAgentServer(async (payload) => invokeMarketResearch(payload));

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('market-intelligence-ctrl agent runtime listening on 0.0.0.0:8080');
