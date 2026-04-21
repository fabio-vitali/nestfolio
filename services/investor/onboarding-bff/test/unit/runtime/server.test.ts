import { createApp } from '../../../agents/onboarding/server';

const processMock = jest.fn().mockResolvedValue(new Response('ok'));

jest.mock('@copilotkit/runtime', () => ({
  CopilotRuntime: jest.fn().mockImplementation(() => ({
    process: processMock,
  })),
  LangGraphAgent: jest.fn(),
}));

jest.mock('../../../agents/onboarding/graph', () => ({
  buildOnboardingGraph: jest.fn().mockReturnValue({}),
}));

jest.mock('../../../src/repositories/onboarding.repository', () => ({
  OnboardingRepository: jest.fn().mockImplementation(() => ({
    getActiveSession: jest.fn().mockResolvedValue(null),
  })),
}));

jest.mock('../../../src/agent/session', () => ({
  rehydrateState: jest.fn().mockReturnValue({ phase: 'personal-info' }),
}));

const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

afterEach(() => {
  processMock.mockClear();
  warnSpy.mockClear();
});

describe('Onboarding AgentCore runtime server', () => {
  it('createApp returns a Hono app', () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe('function');
  });

  it('responds 200 to GET /health', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });

  it('responds 200 to GET /ping (AgentCore health convention)', async () => {
    const app = createApp();
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
  });

  it('exposes POST /invocations and delegates to CopilotRuntime.process', async () => {
    const app = createApp();
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': 'tenant-a/session-1',
      },
      body: JSON.stringify({ threadId: 'session-1', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(processMock).toHaveBeenCalledTimes(1);
  });

  it('POST /copilotkit no longer exists (routed off in favour of /invocations)', async () => {
    const app = createApp();
    const res = await app.request('/copilotkit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

describe('Runtime session-id parsing', () => {
  it('skips emission and warns when the session-id header is missing', async () => {
    const app = createApp();
    await app.request('/invocations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('onboarding trace emission skipped'),
      expect.objectContaining({ hasTenantId: false, hasSessionId: false }),
    );
    expect(processMock).toHaveBeenCalledTimes(1);
  });

  it('skips emission and warns when the session-id header has no "/" separator', async () => {
    const app = createApp();
    await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': 'malformed-no-slash',
      },
      body: JSON.stringify({}),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('onboarding trace emission skipped'),
      expect.objectContaining({ hasTenantId: false, hasSessionId: false }),
    );
    expect(processMock).toHaveBeenCalledTimes(1);
  });

  it('skips emission when either tenantId or sessionId half is empty', async () => {
    const app = createApp();
    await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': 'tenant-a/',
      },
      body: JSON.stringify({}),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('onboarding trace emission skipped'),
      expect.objectContaining({ hasTenantId: true, hasSessionId: false }),
    );
    expect(processMock).toHaveBeenCalledTimes(1);
  });

  it('skips emission when tenantId half is empty (leading slash)', async () => {
    const app = createApp();
    await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': '/session-only',
      },
      body: JSON.stringify({}),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('onboarding trace emission skipped'),
      expect.objectContaining({ hasTenantId: false, hasSessionId: true }),
    );
    expect(processMock).toHaveBeenCalledTimes(1);
  });
});

describe('/session endpoint (unchanged)', () => {
  it('returns newSession when no headers', async () => {
    const app = createApp();
    const res = await app.request('/session');
    const json = await res.json();
    expect(json.newSession).toBe(true);
  });

  it('returns newSession when no active session', async () => {
    const { OnboardingRepository } = require('../../../src/repositories/onboarding.repository');
    OnboardingRepository.mockImplementation(() => ({
      getActiveSession: jest.fn().mockResolvedValue(null),
    }));
    const app = createApp();
    const res = await app.request('/session', {
      headers: { 'x-tenant-id': 't1', 'x-user-id': 'u1' },
    });
    const json = await res.json();
    expect(json.newSession).toBe(true);
  });

  it('returns completed when session status is completed', async () => {
    const { OnboardingRepository } = require('../../../src/repositories/onboarding.repository');
    OnboardingRepository.mockImplementation(() => ({
      getActiveSession: jest.fn().mockResolvedValue({ status: 'completed', currentPhase: 'completed' }),
    }));
    const app = createApp();
    const res = await app.request('/session', {
      headers: { 'x-tenant-id': 't1', 'x-user-id': 'u1' },
    });
    const json = await res.json();
    expect(json.completed).toBe(true);
  });
});
