import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { buildGraph } from './graph';

const graph = buildGraph();

const app = createAgentServer(async (prompt, _sessionId) => {
  const result = await graph.invoke({
    messages: [{ role: 'user', content: prompt }],
  });
  const lastMsg = result.messages[result.messages.length - 1];
  return typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
console.log('advisory-ctrl decision-lifecycle agent runtime listening on 0.0.0.0:8080');
