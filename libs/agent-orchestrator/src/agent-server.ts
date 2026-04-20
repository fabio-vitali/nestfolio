import { Hono } from 'hono';
import type { AgentInvocation } from './types';

export type AgentHandler = (
  payload: AgentInvocation,
  sessionId: string,
) => Promise<unknown>;

/**
 * Build the Hono app served inside an AgentCore container.
 *
 * Contract:
 * - POST /invocations expects a JSON body shaped as `AgentInvocation`.
 * - The handler returns the agent's structured result; the server JSON-encodes
 *   it directly with no envelope wrapping. The mock runtime returns the same
 *   shape so callers can't tell the two transports apart.
 * - Errors → 500 with `{ error: message }`.
 */
export function createAgentServer(handler: AgentHandler) {
  const app = new Hono();

  app.get('/ping', (c) => c.json({ status: 'healthy' }));

  app.post('/invocations', async (c) => {
    const payload = await c.req.json() as AgentInvocation;
    const sessionId =
      c.req.header('x-amzn-bedrock-agentcore-runtime-session-id') ?? '';
    try {
      const response = await handler(payload, sessionId);
      return c.json(response as Record<string, unknown>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
