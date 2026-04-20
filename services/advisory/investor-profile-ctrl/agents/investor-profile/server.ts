// services/advisory/investor-profile-ctrl/agents/investor-profile/server.ts
import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { invokeInvestorProfile } from './graph';

const app = createAgentServer(async (payload) => invokeInvestorProfile(payload));

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('investor-profile-ctrl agent runtime listening on 0.0.0.0:8080');
