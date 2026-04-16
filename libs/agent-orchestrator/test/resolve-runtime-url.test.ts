import { resolveAgentRuntimeUrl, invokeRemoteRuntime } from '../src/resolve-runtime-url';

// Mock Powertools Logger — avoid real structured logging in tests
jest.mock('@aws-lambda-powertools/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

describe('resolveAgentRuntimeUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return null when AGENT_RUNTIME_URL_PARAM is not set', async () => {
    delete process.env.AGENT_RUNTIME_URL_PARAM;
    expect(await resolveAgentRuntimeUrl()).toBeNull();
  });

  it('should return null when AGENT_RUNTIME_URL_PARAM is empty string', async () => {
    process.env.AGENT_RUNTIME_URL_PARAM = '';
    expect(await resolveAgentRuntimeUrl()).toBeNull();
  });

  it('should return null when SSM param value is DISABLED sentinel', async () => {
    process.env.AGENT_RUNTIME_URL_PARAM = '/test/param';
    process.env.AWS_SESSION_TOKEN = 'test-token';
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      json: async () => ({ Parameter: { Value: 'DISABLED' } }),
    } as Response);

    expect(await resolveAgentRuntimeUrl()).toBeNull();
    mockFetch.mockRestore();
  });

  it('should return URL when SSM param has a real value', async () => {
    process.env.AGENT_RUNTIME_URL_PARAM = '/test/param';
    process.env.AWS_SESSION_TOKEN = 'test-token';
    const mockUrl = 'https://mock.lambda-url.us-east-1.on.aws';
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      json: async () => ({ Parameter: { Value: mockUrl } }),
    } as Response);

    expect(await resolveAgentRuntimeUrl()).toBe(mockUrl);
    mockFetch.mockRestore();
  });

  it('should log warning and return null on SSM fetch error', async () => {
    process.env.AGENT_RUNTIME_URL_PARAM = '/test/param';
    process.env.AWS_SESSION_TOKEN = 'test-token';
    const mockFetch = jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Connection refused'));

    expect(await resolveAgentRuntimeUrl()).toBeNull();
    mockFetch.mockRestore();
  });
});

describe('invokeRemoteRuntime', () => {
  it('should POST payload and return parsed JSON', async () => {
    const expected = { result: 'ok' };
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => expected,
    } as Response);

    const result = await invokeRemoteRuntime('https://mock.url', { input: 'test' });
    expect(result).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith('https://mock.url', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ input: 'test' }),
    }));
    mockFetch.mockRestore();
  });

  it('should throw on non-OK response', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response);

    await expect(invokeRemoteRuntime('https://mock.url', {}))
      .rejects.toThrow('Remote agent runtime returned 500');
    mockFetch.mockRestore();
  });
});
