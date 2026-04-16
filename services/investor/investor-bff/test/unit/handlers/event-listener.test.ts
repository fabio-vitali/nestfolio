import { createHandlers, callAppSyncMutation } from '../../../src/handlers/event-listener';
import { InvestorBffEventTypes } from '../../../src/domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import type { InvestorProfileRepository } from '../../../src/repositories/investor-profile.repository';

// Mock the signing dependencies so callAppSyncMutation uses fetch without real signing
jest.mock('@smithy/signature-v4', () => ({
  SignatureV4: jest.fn().mockImplementation(() => ({
    sign: jest.fn().mockResolvedValue({
      headers: { 'Content-Type': 'application/json', host: 'example.appsync-api.us-east-1.amazonaws.com' },
    }),
  })),
}));
jest.mock('@aws-crypto/sha256-js', () => ({ Sha256: jest.fn() }));

jest.mock('@nestfolio/event-processor', () => {
  const actual = jest.requireActual('@nestfolio/event-processor');
  return { ...actual, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logger: mockLogger } = require('@nestfolio/event-processor');
jest.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: jest.fn(),
}));

describe('investor-bff event-listener', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, APPSYNC_URL: 'https://example.appsync-api.us-east-1.amazonaws.com/graphql' };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) }) as jest.Mock;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('should export handlers for all event types', () => {
    const handlers = createHandlers();

    expect(Object.keys(handlers)).toHaveLength(8);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.USER_REGISTERED);
    expect(handlers).toHaveProperty(InvestorCtrlEventTypes.NOTIFICATION_CREATED);
    expect(handlers).toHaveProperty(LedgerCrossDomainEventTypes.BALANCE_UPDATED);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.ONBOARDING_COMPLETED);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.OPERATING_MODE_CHANGED);
    expect(handlers).toHaveProperty('GO_LIVE_CONFIRMED');
    expect(handlers).toHaveProperty(InvestorBffEventTypes.BROKER_CIRCUIT_OPEN);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED);
  });

  it('GO_LIVE_CONFIRMED handler calls setExecutionMode with simulation→live and returns skip', async () => {
    const setExecutionMode = jest.fn().mockResolvedValue({});
    const profileRepo = { setExecutionMode } as unknown as InvestorProfileRepository;
    const handlers = createHandlers({ profileRepo });

    // userId in subject differs from ctx to prove handler uses subject.userId
    const payload = { subject: { tenantId: 'tenant-1', userId: 'subject-user' } };
    const ctx = { tenantId: 'tenant-1', userId: 'ctx-user', region: 'us-east-1' };

    const result = await handlers['GO_LIVE_CONFIRMED'](payload, ctx);

    expect(setExecutionMode).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'subject-user', region: 'us-east-1' }, 'simulation', 'live');
    expect(result).toEqual({ _tag: 'skip' });
  });

  describe('BROKER_CIRCUIT_OPEN handler', () => {
    it('calls AppSync mutation 3 times to disable feature flags and returns skip', async () => {
      const handlers = createHandlers();
      const payload = { subject: {} };
      const ctx = { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' };

      const result = await handlers[InvestorBffEventTypes.BROKER_CIRCUIT_OPEN](payload, ctx);

      expect(global.fetch).toHaveBeenCalledTimes(3);

      // Verify each call disables the correct flag
      const calls = (global.fetch as jest.Mock).mock.calls;
      const bodies = calls.map((call: unknown[]) => JSON.parse((call[1] as { body: string }).body));

      expect(bodies[0].variables).toEqual({ name: 'confirmDecision', enabled: false, reason: 'Broker connectivity issue' });
      expect(bodies[1].variables).toEqual({ name: 'initiateDeposit', enabled: false, reason: 'Broker connectivity issue' });
      expect(bodies[2].variables).toEqual({ name: 'requestWithdrawal', enabled: false, reason: 'Broker connectivity issue' });

      expect(result).toEqual({ _tag: 'skip' });
    });
  });

  describe('BROKER_CIRCUIT_CLOSED handler', () => {
    it('calls AppSync mutation 3 times to re-enable feature flags and returns skip', async () => {
      const handlers = createHandlers();
      const payload = { subject: {} };
      const ctx = { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' };

      const result = await handlers[InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED](payload, ctx);

      expect(global.fetch).toHaveBeenCalledTimes(3);

      const calls = (global.fetch as jest.Mock).mock.calls;
      const bodies = calls.map((call: unknown[]) => JSON.parse((call[1] as { body: string }).body));

      expect(bodies[0].variables).toEqual({ name: 'confirmDecision', enabled: true });
      expect(bodies[1].variables).toEqual({ name: 'initiateDeposit', enabled: true });
      expect(bodies[2].variables).toEqual({ name: 'requestWithdrawal', enabled: true });

      expect(result).toEqual({ _tag: 'skip' });
    });
  });

  describe('callAppSyncMutation', () => {
    it('skips when APPSYNC_URL is not set', async () => {
      delete process.env.APPSYNC_URL;
      mockLogger.warn.mockClear();

      await callAppSyncMutation('mutation { test }', { foo: 'bar' });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith('APPSYNC_URL not set — skipping feature flag update');
    });

    it('logs error when fetch response is not ok', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 403 });
      mockLogger.error.mockClear();

      await callAppSyncMutation('mutation { test }', { foo: 'bar' });

      expect(mockLogger.error).toHaveBeenCalledWith('AppSync mutation failed (HTTP)', { status: 403 });
    });

    it('logs error when GraphQL response contains errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ errors: [{ message: 'Not Authorized', errorType: 'Unauthorized' }] }),
      });
      mockLogger.error.mockClear();

      await callAppSyncMutation('mutation { test }', { foo: 'bar' });

      expect(mockLogger.error).toHaveBeenCalledWith('AppSync mutation failed (GraphQL)', {
        errors: [{ message: 'Not Authorized', errorType: 'Unauthorized' }],
      });
    });
  });
});
