import { createApp } from '../../../agents/onboarding/server';

jest.mock('@copilotkit/runtime', () => ({
  CopilotRuntime: jest.fn().mockImplementation(() => ({
    process: jest.fn().mockResolvedValue(new Response('ok')),
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

describe('CopilotKit Runtime Server', () => {
  it('createApp returns a Hono app', () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe('function');
  });

  it('responds to health check at /health', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });

  it('has /copilotkit POST endpoint', async () => {
    const app = createApp();
    const res = await app.request('/copilotkit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).not.toBe(404);
  });
});

describe('/session endpoint', () => {
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
