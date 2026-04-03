import { Hono } from 'hono';

export type AgentHandler = (prompt: string, sessionId: string) => Promise<string>;

export function createAgentServer(handler: AgentHandler) {
  const app = new Hono();

  app.get('/ping', (c) => c.json({ status: 'healthy' }));

  app.post('/invocations', async (c) => {
    const body = await c.req.json();
    const prompt = body.prompt ?? '';
    const sessionId = c.req.header('x-amzn-bedrock-agentcore-runtime-session-id') ?? '';

    try {
      const response = await handler(prompt, sessionId);
      return c.json({ response, status: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, status: 'error' }, 500);
    }
  });

  return app;
}
