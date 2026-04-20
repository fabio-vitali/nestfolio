// services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/server.ts
import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { invokePortfolioEngine } from './graph';

const app = createAgentServer(async (payload) => invokePortfolioEngine(payload));

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('portfolio-engine-ctrl agent runtime listening on 0.0.0.0:8080');
