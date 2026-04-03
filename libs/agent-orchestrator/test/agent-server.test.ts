import { createAgentServer } from '../src/agent-server';

describe('createAgentServer', () => {
  const mockHandler = jest.fn();

  beforeEach(() => {
    mockHandler.mockReset();
  });

  it('GET /ping returns healthy status', async () => {
    const app = createAgentServer(mockHandler);
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'healthy' });
  });

  it('POST /invocations calls handler with prompt and session ID', async () => {
    mockHandler.mockResolvedValue('agent response text');
    const app = createAgentServer(mockHandler);

    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': 'session-abc',
      },
      body: JSON.stringify({ prompt: 'What is risk?' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ response: 'agent response text', status: 'success' });
    expect(mockHandler).toHaveBeenCalledWith('What is risk?', 'session-abc');
  });

  it('POST /invocations handles missing prompt gracefully', async () => {
    mockHandler.mockResolvedValue('empty prompt response');
    const app = createAgentServer(mockHandler);

    const res = await app.request('/invocations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('success');
    expect(mockHandler).toHaveBeenCalledWith('', '');
  });

  it('POST /invocations returns 500 on handler error', async () => {
    mockHandler.mockRejectedValue(new Error('Model unavailable'));
    const app = createAgentServer(mockHandler);

    const res = await app.request('/invocations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.error).toContain('Model unavailable');
  });
});
