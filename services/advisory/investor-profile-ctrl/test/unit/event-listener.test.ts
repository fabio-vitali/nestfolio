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
}));

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

process.env.TABLE_NAME = 'test-table';
process.env.BUS_NAME = 'test-bus';
process.env.MEMORY_ID = 'mem-test';

import { ZodError } from 'zod';
import type { EventPayload, EventContext } from '@nestfolio/event-processor';
import { asTenantId, asUserId } from '@nestfolio/event-processor';
import { type MemoryClient } from '@nestfolio/agent-orchestrator';
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

  // Real InvestorProfileUpdated subject (DRY — no tenantId/userId; those travel
  // in the event context). operatingMode is a required enum; goal/riskProfile are
  // structured (goal.objective, riskProfile.score required).
  const validInvestorProfileUpdated = {
    operatingMode: 'BALANCED' as const,
    goal: { objective: 'retirement', timeHorizonMonths: 120 },
    riskProfile: { score: 55, toleranceResponse: 'moderate' },
    __version: 3,
  };

  // Real Mandate subject (DRY).
  const validMandate = {
    mandateId: 'm-1',
    level: 'ADVISORY' as const,
    status: 'ACTIVE' as const,
    operatingMode: 'CONSERVATIVE' as const,
    effectiveDate: '2026-01-01',
    __version: 1,
  };

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
    it('parses the subject, runs the agent, and emits an InvestorProfileSnapshot write intent', async () => {
      const payload: EventPayload = { subject: validInvestorProfileUpdated };

      const result = await handlers.INVESTOR_PROFILE_UPDATED(payload, makeCtx());

      // operatingMode read off the parsed subject; the whole parsed subject is
      // forwarded as investorProfile (lossless).
      expect(mockRunPipeline).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({
          tenantId: 't1',
          operatingMode: 'BALANCED',
          investorProfile: validInvestorProfileUpdated,
        }),
      );
      expect(result).toEqual([
        expect.objectContaining({ _tag: 'record', typename: 'AgentInvocation' }),
        expect.objectContaining({
          _tag: 'update',
          typename: 'InvestorProfileSnapshot',
          add: { __version: 1 },
          updates: expect.objectContaining({
            // userId resolves to ctx.tenantId (DRY subject carries neither field).
            tenantId: 't1',
            userId: 't1',
            sourceEventType: 'INVESTOR_PROFILE_UPDATED',
            sourceEventId: 'evt-1',
          }),
        }),
      ]);
      expect(mockSearchLongTermMemory).toHaveBeenCalledWith('preferences', 'investor preferences risk tolerance');
    });

    it('throws ZodError (poison-pill) when the subject violates InvestorProfileUpdatedSchema', async () => {
      const payload: EventPayload = {
        // operatingMode missing + goal/riskProfile absent → contract violation.
        subject: { goal: { objective: 'retirement' } },
      };

      await expect(
        handlers.INVESTOR_PROFILE_UPDATED(payload, makeCtx()),
      ).rejects.toThrow(ZodError);
      expect(mockRunPipeline).not.toHaveBeenCalled();
    });

    it('returns an empty intent array when DuplicateInvocationError is thrown', async () => {
      const { DuplicateInvocationError } = await import('../../src/agent-service');
      mockRunPipeline.mockRejectedValueOnce(new DuplicateInvocationError('evt-dup'));

      const payload: EventPayload = { subject: validInvestorProfileUpdated };

      const result = await handlers.INVESTOR_PROFILE_UPDATED(
        payload,
        makeCtx({ eventId: 'evt-dup' }),
      );

      expect(result).toEqual([]);
    });

    it('propagates non-duplicate agent errors', async () => {
      mockRunPipeline.mockRejectedValueOnce(new Error('Agent pipeline failed'));

      const payload: EventPayload = { subject: validInvestorProfileUpdated };

      await expect(
        handlers.INVESTOR_PROFILE_UPDATED(payload, makeCtx()),
      ).rejects.toThrow('Agent pipeline failed');
    });
  });

  describe('MANDATE_ISSUED handler', () => {
    it('parses the Mandate subject and emits an InvestorProfileSnapshot intent with sourceEventType=MANDATE_ISSUED', async () => {
      const payload: EventPayload = { subject: validMandate };

      const result = await handlers.MANDATE_ISSUED(
        payload,
        makeCtx({ eventType: 'MANDATE_ISSUED', eventId: 'evt-mandate-1' }),
      );

      expect(mockRunPipeline).toHaveBeenCalledWith(
        'evt-mandate-1',
        expect.objectContaining({
          tenantId: 't1',
          operatingMode: 'CONSERVATIVE',
          investorProfile: validMandate,
        }),
      );
      expect(result).toEqual([
        expect.objectContaining({ _tag: 'record', typename: 'AgentInvocation' }),
        expect.objectContaining({
          _tag: 'update',
          typename: 'InvestorProfileSnapshot',
          add: { __version: 1 },
          updates: expect.objectContaining({
            tenantId: 't1',
            userId: 't1',
            sourceEventType: 'MANDATE_ISSUED',
            sourceEventId: 'evt-mandate-1',
          }),
        }),
      ]);
    });

    it('throws ZodError (poison-pill) when the subject violates MandateSchema', async () => {
      const payload: EventPayload = {
        // missing mandateId/level/status/effectiveDate → contract violation.
        subject: { operatingMode: 'CONSERVATIVE' },
      };

      await expect(
        handlers.MANDATE_ISSUED(payload, makeCtx({ eventType: 'MANDATE_ISSUED' })),
      ).rejects.toThrow(ZodError);
      expect(mockRunPipeline).not.toHaveBeenCalled();
    });
  });

});
