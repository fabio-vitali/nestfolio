// services/advisory/investor-profile-ctrl/agents/server.ts
import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { invokeInvestorProfile } from './graph';

const app = createAgentServer(async (prompt, sessionId) => {
  const result = await invokeInvestorProfile({
    tenantId: sessionId.split('/')[0] || sessionId,
    decisionId: sessionId,
    input: prompt,
  });
  return JSON.stringify(result);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('investor-profile-ctrl agent runtime listening on 0.0.0.0:8080');
