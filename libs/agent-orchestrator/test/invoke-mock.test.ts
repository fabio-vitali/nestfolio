import { invokeMockRuntime } from '../src/invoke-mock';

describe('invokeMockRuntime', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs the structured envelope as JSON and returns the parsed response', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await invokeMockRuntime<{ ok: boolean }>(
      'https://mock.example.com/invocations',
      { tenantId: 't1', decisionId: 'd1', upstreamOutputs: { score: 7 } },
    );

    expect(result).toEqual({ ok: true });
    expect(captured?.url).toBe('https://mock.example.com/invocations');
    expect(captured?.init?.method).toBe('POST');
    expect(JSON.parse(captured?.init?.body as string)).toEqual({
      tenantId: 't1', decisionId: 'd1', upstreamOutputs: { score: 7 },
    });
  });

  it('throws when the mock returns a non-2xx status', async () => {
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500 })) as typeof fetch;
    await expect(
      invokeMockRuntime('https://mock.example.com', {
        tenantId: 't1', decisionId: 'd1', upstreamOutputs: {},
      }),
    ).rejects.toThrow('Mock agent runtime returned 500');
  });
});
