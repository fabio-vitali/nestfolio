import { createApp } from '../../../agents/onboarding/server';
import { EMPTY } from 'rxjs';

// Build a JWT (header.payload.signature, base64url) carrying the given claims.
// `decodeJwt` from `jose` decodes without verifying the signature; AgentCore's
// Custom JWT authorizer is the auth boundary and has already validated the
// token before forwarding the request — see resolveJwtIdentity in server.ts.
function buildJwt(claims: Record<string, unknown>): string {
  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = enc({ alg: 'RS256', typ: 'JWT' });
  const body = enc(claims);
  return `${header}.${body}.signature-not-verified-by-agent-runtime`;
}

const TENANT = 't-1';
const USER = 'u-1';
const VALID_BEARER = `Bearer ${buildJwt({ sub: USER, 'custom:tenant_id': TENANT })}`;

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
        'Authorization': VALID_BEARER,
        'x-amzn-bedrock-agentcore-runtime-session-id': 'browser-tenant/session-1',
      },
      body: JSON.stringify({ threadId: 'session-1', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('passes JWT-derived identity to the OnboardingAgent (browser tenant prefix discarded)', async () => {
    const { OnboardingAgent } = require('../../../agents/onboarding/agent');
    const app = createApp();
    await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': VALID_BEARER,
        // Browser-supplied "tenant-spoofed" prefix MUST be ignored — the
        // tenantId comes from the JWT custom:tenant_id claim, not the
        // session-id header. This is the prompt-injection / cross-tenant
        // write boundary documented in
        // 2026-04-29-onboarding-identity-propagation-design.md.
        'x-amzn-bedrock-agentcore-runtime-session-id': 'tenant-spoofed/session-1',
      },
      body: JSON.stringify({ threadId: 'session-1', messages: [] }),
    });
    expect(OnboardingAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        identity: { tenantId: TENANT, userId: USER, sessionId: 'session-1' },
      }),
    );
  });
});

describe('Identity gate on /invocations', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const app = createApp();
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': 't1/s1',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('returns 401 when JWT lacks the custom:tenant_id claim', async () => {
    const app = createApp();
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${buildJwt({ sub: 'u-1' /* no custom:tenant_id */ })}`,
        'x-amzn-bedrock-agentcore-runtime-session-id': 't1/s1',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('returns 401 when JWT lacks the sub claim', async () => {
    const app = createApp();
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${buildJwt({ 'custom:tenant_id': 't-1' /* no sub */ })}`,
        'x-amzn-bedrock-agentcore-runtime-session-id': 't1/s1',
      },
      body: JSON.stringify({}),
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
        'Authorization': VALID_BEARER,
        'x-amzn-bedrock-agentcore-runtime-session-id': 'no-slash',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('returns 401 when session-id header is missing entirely', async () => {
    const app = createApp();
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': VALID_BEARER,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('/session endpoint (now JWT-gated)', () => {
  it('returns newSession when Authorization header missing', async () => {
    const app = createApp();
    const res = await app.request('/session');
    const json = await res.json();
    expect(json.newSession).toBe(true);
  });

  it('returns newSession when no active session for the JWT-derived tenant/user', async () => {
    const { OnboardingRepository } = require('../../../src/repositories/onboarding.repository');
    OnboardingRepository.mockImplementation(() => ({
      getActiveSession: jest.fn().mockResolvedValue(null),
    }));
    const app = createApp();
    const res = await app.request('/session', { headers: { 'Authorization': VALID_BEARER } });
    const json = await res.json();
    expect(json.newSession).toBe(true);
  });

  it('returns completed when session status is completed', async () => {
    const { OnboardingRepository } = require('../../../src/repositories/onboarding.repository');
    OnboardingRepository.mockImplementation(() => ({
      getActiveSession: jest.fn().mockResolvedValue({ status: 'completed', currentPhase: 'completed' }),
    }));
    const app = createApp();
    const res = await app.request('/session', { headers: { 'Authorization': VALID_BEARER } });
    const json = await res.json();
    expect(json.completed).toBe(true);
  });
});
