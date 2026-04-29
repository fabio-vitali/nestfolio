import { createApp } from '../../../agents/onboarding/server';
import { EMPTY } from 'rxjs';

const TENANT = 't-1';
const USER = 'u-1';
const SESSION = 'session-1';
const SESSION_ID_HEADER = `${TENANT}/${SESSION}`;

// `OnboardingAgent` (in agents/onboarding/agent.ts) drives the in-process
// LangGraph and emits AG-UI events. The runMock returns an immediately-
// completing Observable so the stream resolves; per-spec overrides drive
// richer paths.
const runMock = jest.fn().mockImplementation(() => EMPTY);

jest.mock('../../../agents/onboarding/agent', () => ({
  OnboardingAgent: jest.fn().mockImplementation(() => ({ run: runMock })),
}));
jest.mock('@ag-ui/encoder', () => ({
  EventEncoder: jest.fn().mockImplementation(() => ({
    getContentType: () => 'text/event-stream',
    encodeSSE: (event: { type: string }) => `data: ${JSON.stringify(event)}\n\n`,
  })),
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

afterEach(() => {
  runMock.mockClear();
});

const validInvocationBody = () => JSON.stringify({
  threadId: SESSION,
  runId: 'run-1',
  messages: [],
  forwardedProps: { identity: { userId: USER } },
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

  it('exposes POST /invocations and invokes the in-process onboarding agent', async () => {
    const app = createApp();
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': SESSION_ID_HEADER,
      },
      body: validInvocationBody(),
    });
    expect(res.status).toBe(200);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('passes parsed identity (tenantId from session-id header, userId from body) to OnboardingAgent', async () => {
    const { OnboardingAgent } = require('../../../agents/onboarding/agent');
    const app = createApp();
    await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': SESSION_ID_HEADER,
      },
      body: validInvocationBody(),
    });
    expect(OnboardingAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        identity: { tenantId: TENANT, userId: USER, sessionId: SESSION },
      }),
    );
  });
});

describe('Identity gate on /invocations', () => {
  it('returns 401 when session-id header is missing', async () => {
    const app = createApp();
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: validInvocationBody(),
    });
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('returns 401 when session-id header is malformed (no slash)', async () => {
    const app = createApp();
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': 'no-slash',
      },
      body: validInvocationBody(),
    });
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('returns 401 when forwardedProps.identity.userId is missing', async () => {
    const app = createApp();
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': SESSION_ID_HEADER,
      },
      body: JSON.stringify({ threadId: SESSION, messages: [], forwardedProps: {} }),
    });
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('returns 401 when forwardedProps is missing entirely', async () => {
    const app = createApp();
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': SESSION_ID_HEADER,
      },
      body: JSON.stringify({ threadId: SESSION, messages: [] }),
    });
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('returns 401 when session-id tenantId portion is empty (leading slash)', async () => {
    const app = createApp();
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': `/${SESSION}`,
      },
      body: validInvocationBody(),
    });
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('/session endpoint', () => {
  it('returns newSession when session-id header missing', async () => {
    const app = createApp();
    const res = await app.request('/session');
    const json = await res.json();
    expect(json.newSession).toBe(true);
  });

  it('returns newSession when no active session for the parsed tenant/user', async () => {
    const { OnboardingRepository } = require('../../../src/repositories/onboarding.repository');
    OnboardingRepository.mockImplementation(() => ({
      getActiveSession: jest.fn().mockResolvedValue(null),
    }));
    const app = createApp();
    const res = await app.request('/session', {
      headers: {
        'x-amzn-bedrock-agentcore-runtime-session-id': SESSION_ID_HEADER,
        'x-user-id': USER,
      },
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
      headers: {
        'x-amzn-bedrock-agentcore-runtime-session-id': SESSION_ID_HEADER,
        'x-user-id': USER,
      },
    });
    const json = await res.json();
    expect(json.completed).toBe(true);
  });
});
