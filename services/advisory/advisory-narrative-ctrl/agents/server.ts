import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { invokeNarrative } from './graph';

const app = createAgentServer(async (prompt, sessionId) => {
  const result = await invokeNarrative({
    tenantId: sessionId.split('/')[0] || sessionId,
    decisionId: sessionId,
    input: prompt,
  });

  return JSON.stringify(result);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
console.log('advisory-narrative-ctrl agent runtime listening on 0.0.0.0:8080');
