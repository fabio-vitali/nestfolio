import { createAgentServer } from '../src/agent-server';

describe('createAgentServer', () => {
  it('passes the structured envelope and session-id header to the handler and returns its JSON', async () => {
    const handler = jest.fn().mockResolvedValue({ summary: 'ok', confidence: 0.9 });
    const app = createAgentServer(handler);

    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': 't1/d1',
      },
      body: JSON.stringify({
        tenantId: 't1', decisionId: 'd1', upstreamOutputs: { score: 7 },
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: 'ok', confidence: 0.9 });
    expect(handler).toHaveBeenCalledWith(
      { tenantId: 't1', decisionId: 'd1', upstreamOutputs: { score: 7 } },
      't1/d1',
    );
  });

  it('returns 500 with {error} on handler throw', async () => {
    const app = createAgentServer(async () => { throw new Error('boom'); });
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom' });
  });

  it('answers GET /ping with healthy', async () => {
    const app = createAgentServer(async () => ({}));
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'healthy' });
  });
});
