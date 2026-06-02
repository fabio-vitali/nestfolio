const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockSend })),
    },
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
  };
});

jest.mock('@nestfolio/agent-orchestrator', () => ({
  createMemoryClient: jest.fn(),
  createNoOpMemoryClient: jest.fn(),
  UnknownOperatingModeError: jest.requireActual('@nestfolio/agent-orchestrator').UnknownOperatingModeError,
}));

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

process.env.TABLE_NAME = 'test-table';
process.env.BUS_NAME = 'test-bus';
process.env.MEMORY_ID = 'mem-test';

import type { EventPayload, EventContext } from '@nestfolio/event-processor';
import { asTenantId, asUserId } from '@nestfolio/event-processor';
import { type MemoryClient, UnknownOperatingModeError } from '@nestfolio/agent-orchestrator';
import { createHandlers, type IngressDeps } from '../../src/handlers/event-listener';

describe('investor-profile-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();
  const mockSearchLongTermMemory = jest.fn().mockResolvedValue([]);

  const mockDeps: IngressDeps = {
    agentService: { runPipeline: mockRunPipeline },
    memoryClient: {
      openDecisionSession: jest.fn().mockReturnValue({
        searchLongTermMemory: mockSearchLongTermMemory,
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    } satisfies Partial<MemoryClient> as MemoryClient,
  };

  const handlers = createHandlers(mockDeps);

  const makeCtx = (overrides: Partial<EventContext> = {}): EventContext => ({
    eventId: 'evt-1',
    eventType: 'INVESTOR_PROFILE_UPDATED',
    tenantId: asTenantId('t1'),
    userId: asUserId('u1'),
    region: 'us-east-1',
    timestamp: new Date().toISOString(),
    receiveCount: 1,
    serviceName: 'investor-profile-ctrl',
    record: {},
    ...overrides,
  });

  const defaultAgentResult = {
    goals: ['retirement'],
    timeHorizon: '10+ years',
    riskWillingness: 'moderate',
    riskScore: 55,
    riskCategory: 'MODERATE' as const,
    regulatoryFlags: [],
    suitabilityAssessment: 'OK',
    confidence: 0.88,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockRunPipeline.mockResolvedValue(defaultAgentResult);
  });

  describe('INVESTOR_PROFILE_UPDATED handler', () => {
    it('runs the agent and emits an InvestorProfileSnapshot write intent', async () => {
      const payload: EventPayload = {
        subject: {
          tenantId: 't1',
          userId: 'u1',
          operatingMode: 'BALANCED',
          goal: {},
          riskProfile: {},
        },
      };

      const result = await handlers.INVESTOR_PROFILE_UPDATED(payload, makeCtx());

      expect(mockRunPipeline).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({ tenantId: 't1', operatingMode: 'BALANCED' }),
      );
      expect(result).toEqual([
        expect.objectContaining({ _tag: 'record', typename: 'AgentInvocation' }),
        expect.objectContaining({
          _tag: 'update',
          typename: 'InvestorProfileSnapshot',
          add: { __version: 1 },
          updates: expect.objectContaining({
            tenantId: 't1',
            userId: 'u1',
            sourceEventType: 'INVESTOR_PROFILE_UPDATED',
            sourceEventId: 'evt-1',
          }),
        }),
      ]);
      expect(mockSearchLongTermMemory).toHaveBeenCalledWith('preferences', 'investor preferences risk tolerance');
    });

    it('throws UnknownOperatingModeError when operatingMode is absent', async () => {
      const payload: EventPayload = {
        subject: { tenantId: 't1', userId: 'u1' },
      };

      await expect(
        handlers.INVESTOR_PROFILE_UPDATED(payload, makeCtx()),
      ).rejects.toThrow(UnknownOperatingModeError);
      expect(mockRunPipeline).not.toHaveBeenCalled();
    });

    it('falls through to subject.mandate.operatingMode when top-level is absent', async () => {
      const payload: EventPayload = {
        subject: {
          tenantId: 't1',
          userId: 'u1',
          mandate: { operatingMode: 'AGGRESSIVE' },
        },
      };

      await handlers.INVESTOR_PROFILE_UPDATED(payload, makeCtx());

      expect(mockRunPipeline).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({ operatingMode: 'AGGRESSIVE' }),
      );
    });

    it('returns an empty intent array when DuplicateInvocationError is thrown', async () => {
      const { DuplicateInvocationError } = await import('../../src/agent-service');
      mockRunPipeline.mockRejectedValueOnce(new DuplicateInvocationError('evt-dup'));

      const payload: EventPayload = {
        subject: { tenantId: 't1', userId: 'u1', operatingMode: 'BALANCED' },
      };

      const result = await handlers.INVESTOR_PROFILE_UPDATED(
        payload,
        makeCtx({ eventId: 'evt-dup' }),
      );

      expect(result).toEqual([]);
    });

    it('propagates non-duplicate agent errors', async () => {
      mockRunPipeline.mockRejectedValueOnce(new Error('Agent pipeline failed'));

      const payload: EventPayload = {
        subject: { tenantId: 't1', userId: 'u1', operatingMode: 'BALANCED' },
      };

      await expect(
        handlers.INVESTOR_PROFILE_UPDATED(payload, makeCtx()),
      ).rejects.toThrow('Agent pipeline failed');
    });
  });

  describe('MANDATE_ISSUED handler', () => {
    it('runs the agent and emits an InvestorProfileSnapshot intent with sourceEventType=MANDATE_ISSUED', async () => {
      const payload: EventPayload = {
        subject: {
          tenantId: 't1',
          userId: 'u1',
          operatingMode: 'CONSERVATIVE',
          mandate: { operatingMode: 'CONSERVATIVE' },
        },
      };

      const result = await handlers.MANDATE_ISSUED(
        payload,
        makeCtx({ eventType: 'MANDATE_ISSUED', eventId: 'evt-mandate-1' }),
      );

      expect(mockRunPipeline).toHaveBeenCalledWith(
        'evt-mandate-1',
        expect.objectContaining({ tenantId: 't1', operatingMode: 'CONSERVATIVE' }),
      );
      expect(result).toEqual([
        expect.objectContaining({ _tag: 'record', typename: 'AgentInvocation' }),
        expect.objectContaining({
          _tag: 'update',
          typename: 'InvestorProfileSnapshot',
          add: { __version: 1 },
          updates: expect.objectContaining({
            tenantId: 't1',
            userId: 'u1',
            sourceEventType: 'MANDATE_ISSUED',
            sourceEventId: 'evt-mandate-1',
          }),
        }),
      ]);
    });
  });

  describe('OPERATING_MODE_CHANGED handler', () => {
    it('runs the agent and emits an InvestorProfileSnapshot intent with sourceEventType=OPERATING_MODE_CHANGED', async () => {
      const payload: EventPayload = {
        subject: {
          tenantId: 't1',
          userId: 'u1',
          operatingMode: 'AGGRESSIVE',
        },
      };

      const result = await handlers.OPERATING_MODE_CHANGED(
        payload,
        makeCtx({ eventType: 'OPERATING_MODE_CHANGED', eventId: 'evt-mode-1' }),
      );

      expect(mockRunPipeline).toHaveBeenCalledWith(
        'evt-mode-1',
        expect.objectContaining({ tenantId: 't1', operatingMode: 'AGGRESSIVE' }),
      );
      expect(result).toEqual([
        expect.objectContaining({ _tag: 'record', typename: 'AgentInvocation' }),
        expect.objectContaining({
          _tag: 'update',
          typename: 'InvestorProfileSnapshot',
          add: { __version: 1 },
          updates: expect.objectContaining({
            tenantId: 't1',
            userId: 'u1',
            sourceEventType: 'OPERATING_MODE_CHANGED',
            sourceEventId: 'evt-mode-1',
          }),
        }),
      ]);
    });
  });
});
