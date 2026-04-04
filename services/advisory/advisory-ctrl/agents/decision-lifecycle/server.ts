import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { invokeDecisionLifecycle } from './graph';

const app = createAgentServer(async (prompt, sessionId) => {
  const result = await invokeDecisionLifecycle({
    tenantId: sessionId.split('/')[0] || sessionId,
    decisionId: sessionId,
    input: prompt,
  });

  if ('serviceUnavailable' in result) {
    return JSON.stringify({ error: result.reason, status: 'service_unavailable' });
  }

  return JSON.stringify(result);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
console.log('advisory-ctrl decision-lifecycle agent runtime listening on 0.0.0.0:8080');
