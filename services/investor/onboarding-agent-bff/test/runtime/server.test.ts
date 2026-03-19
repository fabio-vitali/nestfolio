import { createApp } from '../../src/runtime/server';

jest.mock('@copilotkit/runtime', () => ({
  CopilotRuntime: jest.fn().mockImplementation(() => ({
    process: jest.fn().mockResolvedValue(new Response('ok')),
  })),
  LangGraphAdapter: jest.fn(),
}));

jest.mock('../../src/agent/graph', () => ({
  buildOnboardingGraph: jest.fn().mockReturnValue({}),
}));

jest.mock('../../src/repositories/onboarding.repository', () => ({
  OnboardingRepository: jest.fn().mockImplementation(() => ({})),
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
