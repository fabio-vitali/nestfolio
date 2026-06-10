const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/lib-dynamodb'),
  DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: mockSend })) },
  PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
}));
jest.mock('@nestfolio/agent-orchestrator', () => ({
  createAgentNode: jest.fn().mockReturnValue(jest.fn()),
  withRetry: jest.fn().mockImplementation((node) => node),
  withFallback: jest.fn().mockImplementation((node) => node),
  createMemoryClient: jest.fn(),
  createNoOpMemoryClient: jest.fn(),
  UnknownOperatingModeError: jest.requireActual('@nestfolio/agent-orchestrator').UnknownOperatingModeError,
  wrapAgentOutput: jest.requireActual('@nestfolio/agent-orchestrator').wrapAgentOutput,
  OutputTooLargeError: jest.requireActual('@nestfolio/agent-orchestrator').OutputTooLargeError,
  agentCompletionPk: (decisionId: string) => `AgentCompletion#${decisionId}`,
  agentCompletionSk: (agentName: string) => `AgentCompletion#${agentName}`,
  agentFailurePk: (decisionId: string) => `AgentFailure#${decisionId}`,
  agentFailureSk: (agentName: string) => `AgentFailure#${agentName}`,
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
import { asTenantId, asUserId, NotRetryableError } from '@nestfolio/event-processor';
import { type MemoryClient, UnknownOperatingModeError } from '@nestfolio/agent-orchestrator';
import { createHandlers, type IngressDeps } from '../../src/handlers/event-listener';

describe('advisory-narrative-ctrl event-listener', () => {
  const mockRunPipeline = jest.fn();
  const mockProcess = jest.fn();
  const mockSearchLongTermMemory = jest.fn().mockResolvedValue([]);

  const mockDeps: IngressDeps = {
    agentService: { runPipeline: mockRunPipeline },
    feedbackCorrelator: { process: mockProcess },
    memoryClient: {
      openDecisionSession: jest.fn().mockReturnValue({
        searchLongTermMemory: mockSearchLongTermMemory,
      }),
      searchTenantMemory: jest.fn().mockResolvedValue([]),
    } satisfies Partial<MemoryClient> as MemoryClient,
  };

  const handlers = createHandlers(mockDeps);

  const baseCtx: EventContext = {
    eventId: 'evt-1',
    eventType: 'GENERATE_NARRATIVE',
    tenantId: asTenantId('t1'),
    userId: asUserId('test-user'),
    region: 'us-east-1',
    timestamp: new Date().toISOString(),
    receiveCount: 1,
    serviceName: 'advisory-narrative-ctrl',
    record: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockSearchLongTermMemory.mockResolvedValue([]);
    mockRunPipeline.mockResolvedValue({
      explainability: {
        rationale: 'Based on your moderate risk profile...',
        summary: 'Your portfolio was rebalanced...',
      },
    });
    mockProcess.mockResolvedValue(undefined);
  });

  describe('GENERATE_NARRATIVE handler — success path', () => {
    it('runs the agent pipeline and forwards subject slots', async () => {
      const payload: EventPayload = {
        subject: {
          tenantId: 't1',
          decisionId: 'dp-1',
          taskToken: 'token-123',
          operatingMode: 'BALANCED',
          investorProfile: { riskScore: 0.5, riskCategory: 'MODERATE' },
          marketAnalysis: { sectors: [{ name: 'tech', outlook: 'bullish' }] },
          portfolio: { allocations: [{ symbol: 'VTI', weight: 0.6 }] },
        },
      };

      await handlers.GENERATE_NARRATIVE(payload, baseCtx);

      expect(mockSearchLongTermMemory).toHaveBeenCalledTimes(1);
      expect(mockSearchLongTermMemory).toHaveBeenCalledWith(
        'rationale',
        'prior decision narratives and communication style',
      );
      expect(mockRunPipeline).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({
          tenantId: 't1',
          decisionId: 'dp-1',
          operatingMode: 'BALANCED',
          investorProfile: { riskScore: 0.5, riskCategory: 'MODERATE' },
          marketAnalysis: { sectors: [{ name: 'tech', outlook: 'bullish' }] },
          portfolio: { allocations: [{ symbol: 'VTI', weight: 0.6 }] },
        }),
      );
    });

    it('emits AgentInvocation + AgentCompletion intents (with taskToken + agentOutput)', async () => {
      const fakeAgentResult = {
        explainability: { rationale: 'because...', summary: 'short' },
      };
      mockRunPipeline.mockResolvedValueOnce(fakeAgentResult);

      const payload: EventPayload = {
        subject: {
          tenantId: 't1',
          decisionId: 'd1',
          taskToken: 'token-abc',
          operatingMode: 'BALANCED',
          investorProfile: {},
          marketAnalysis: {},
          portfolio: {},
        },
      };

      const result = await handlers.GENERATE_NARRATIVE(payload, baseCtx);

      expect(result).toEqual([
        expect.objectContaining({
          _tag: 'record',
          typename: 'AgentInvocation',
          fields: expect.objectContaining({
            decisionId: 'd1',
            tenantId: 't1',
            agentName: 'advisory-narrative',
          }),
        }),
        expect.objectContaining({
          _tag: 'record',
          typename: 'AgentCompletion',
          fields: expect.objectContaining({
            decisionId: 'd1',
            tenantId: 't1',
            agentName: 'advisory-narrative',
            taskToken: 'token-abc',
            agentOutput: fakeAgentResult,
          }),
        }),
      ]);
    });

    it('emits AgentCompletion intent carrying the full agentOutput for downstream consumers', async () => {
      const fakeAgentResult = {
        explainability: { rationale: 'because...', summary: 'short' },
      };
      mockRunPipeline.mockResolvedValueOnce(fakeAgentResult);

      const payload: EventPayload = {
        subject: {
          tenantId: 't1',
          decisionId: 'd1',
          taskToken: 'tt1',
          operatingMode: 'BALANCED',
          investorProfile: { riskScore: 0.5 },
          marketAnalysis: { sectors: [] },
          portfolio: { allocations: [] },
        },
      };

      const result = await handlers.GENERATE_NARRATIVE(payload, { ...baseCtx, eventId: 'evt-out' });

      const completion = result.find(
        (i): i is { _tag: 'record'; typename: string; fields: Record<string, unknown> } =>
          (i as { typename?: string }).typename === 'AgentCompletion',
      );
      expect(completion).toBeDefined();
      expect(completion!.fields).toMatchObject({
        decisionId: 'd1',
        tenantId: 't1',
        agentOutput: fakeAgentResult,
      });
    });

    it('tolerates missing upstream slots on subject (empty objects)', async () => {
      const payload: EventPayload = {
        subject: {
          tenantId: 't1',
          decisionId: 'dp-empty',
          taskToken: 'tok',
          operatingMode: 'BALANCED',
          // No investorProfile / marketAnalysis / portfolio
        },
      };

      await handlers.GENERATE_NARRATIVE(payload, baseCtx);

      expect(mockRunPipeline).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({
          investorProfile: {},
          marketAnalysis: {},
          portfolio: {},
        }),
      );
    });

    it('passes operatingMode from subject through to runPipeline', async () => {
      const payload: EventPayload = {
        subject: { tenantId: 't1', decisionId: 'dp-prop', taskToken: 'tok', operatingMode: 'CONSERVATIVE' },
      };

      await handlers.GENERATE_NARRATIVE(payload, baseCtx);

      expect(mockRunPipeline).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({ operatingMode: 'CONSERVATIVE' }),
      );
    });
  });

  describe('GENERATE_NARRATIVE handler — failure paths', () => {
    it('on permanent agent error (client-fault non-retryable): emits AgentFailure intent with taskToken (does NOT rethrow)', async () => {
      // A plain AWS SDK client-fault error (e.g. ValidationException) is NOT retryable.
      // isRetryable() returns false when $fault='client' and $retryable is undefined
      // and the name is not in RETRYABLE_CLIENT_FAULT_NAMES.
      const permanentErr = Object.assign(new Error('Invalid agent output schema'), {
        name: 'ValidationException',
        $fault: 'client' as const,
      });
      mockRunPipeline.mockRejectedValueOnce(permanentErr);

      const payload: EventPayload = {
        subject: { tenantId: 't1', decisionId: 'd1', taskToken: 'token-abc', operatingMode: 'BALANCED' },
      };

      const result = await handlers.GENERATE_NARRATIVE(payload, baseCtx);

      expect(result).toEqual([
        expect.objectContaining({
          _tag: 'record',
          typename: 'AgentFailure',
          fields: expect.objectContaining({
            decisionId: 'd1',
            tenantId: 't1',
            agentName: 'advisory-narrative',
            taskToken: 'token-abc',
            errorType: 'ValidationException',
            errorMessage: 'Invalid agent output schema',
          }),
        }),
      ]);
    });

    it('on transient ServiceQuotaExceededException (maxVms contention): rethrows for SQS retry, does NOT emit AgentFailure', async () => {
      // ServiceQuotaExceededException is in RETRYABLE_CLIENT_FAULT_NAMES — isRetryable() returns true.
      // The handler must rethrow so SQS visibility-timeout redelivers the same message
      // + same task token after contention clears.
      const transientErr = Object.assign(new Error('maxVms limit exceeded for account 771924376645'), {
        name: 'ServiceQuotaExceededException',
        $fault: 'client' as const,
        $retryable: { throttling: true },
      });
      mockRunPipeline.mockRejectedValueOnce(transientErr);

      const payload: EventPayload = {
        subject: { tenantId: 't1', decisionId: 'd1', taskToken: 'token-abc', operatingMode: 'BALANCED' },
      };

      await expect(handlers.GENERATE_NARRATIVE(payload, baseCtx)).rejects.toThrow(
        'maxVms limit exceeded for account 771924376645',
      );
    });

    it('returns an empty intent array when DuplicateInvocationError is thrown', async () => {
      const { DuplicateInvocationError } = await import('../../src/agent-service');
      mockRunPipeline.mockRejectedValueOnce(new DuplicateInvocationError('evt-dup'));

      const payload: EventPayload = {
        subject: { tenantId: 't1', decisionId: 'dp-dup', taskToken: 'tok', operatingMode: 'BALANCED' },
      };

      const dupCtx: EventContext = { ...baseCtx, eventId: 'evt-dup' };
      const result = await handlers.GENERATE_NARRATIVE(payload, dupCtx);

      expect(result).toEqual([]);
    });

    it('throws NotRetryableError when subject.taskToken is missing', async () => {
      const payload: EventPayload = {
        subject: { tenantId: 't1', decisionId: 'dp-no-token', operatingMode: 'BALANCED' },
      };

      await expect(handlers.GENERATE_NARRATIVE(payload, baseCtx)).rejects.toThrow(NotRetryableError);
      await expect(handlers.GENERATE_NARRATIVE(payload, baseCtx)).rejects.toThrow(/taskToken/);
      expect(mockRunPipeline).not.toHaveBeenCalled();
    });

    // operatingMode is propagated via SF state on subject.operatingMode (Phase 4
    // of agentcore-memory-list-records-eventual-consistency). Replaces the silent
    // `?? 'BALANCED'` fallback that previously masked propagation regressions.
    it('throws UnknownOperatingModeError when subject.operatingMode is missing', async () => {
      const payload: EventPayload = {
        subject: { tenantId: 't1', decisionId: 'dp-no-mode', taskToken: 'tok' },
      };

      await expect(handlers.GENERATE_NARRATIVE(payload, baseCtx)).rejects.toThrow(UnknownOperatingModeError);
      expect(mockRunPipeline).not.toHaveBeenCalled();
    });
  });

  describe('DECISION_FEEDBACK handler', () => {
    it('should route DECISION_FEEDBACK to feedback correlator', async () => {
      const fbCtx: EventContext = { ...baseCtx, eventType: 'DECISION_FEEDBACK' };
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          outcome: 'ACCEPTED',
          riskCategory: 'MODERATE',
        },
      };

      const result = await handlers.DECISION_FEEDBACK(payload, fbCtx);

      expect(result).toEqual([]);
      expect(mockProcess).toHaveBeenCalled();
    });
  });

  describe('Phase B — sites 5+6 merged into single rationale query', () => {
    const phasePayload: EventPayload = {
      subject: {
        tenantId: 't1',
        decisionId: 'd1',
        taskToken: 'tok-phaseB',
        operatingMode: 'BALANCED',
        investorProfile: { age: 35 },
        marketAnalysis: { signals: [] },
        portfolio: { allocations: [] },
      },
    };
    const phaseCtx: EventContext = { ...baseCtx, eventId: 'evt-narr-1' };

    beforeEach(() => {
      mockSearchLongTermMemory.mockReset();
      mockRunPipeline.mockReset();
      mockSearchLongTermMemory.mockResolvedValue([]);
      mockRunPipeline.mockResolvedValue({
        explainability: { rationale: 'ok', summary: 'ok' },
      });
    });

    it('calls searchLongTermMemory exactly once with rationale namespace', async () => {
      await handlers.GENERATE_NARRATIVE(phasePayload, phaseCtx);
      expect(mockSearchLongTermMemory).toHaveBeenCalledTimes(1);
      expect(mockSearchLongTermMemory).toHaveBeenCalledWith(
        'rationale',
        'prior decision narratives and communication style',
      );
    });

    it('passes the rationale recall content into runPipeline as priorNarratives', async () => {
      mockSearchLongTermMemory.mockResolvedValueOnce([
        { content: 'Previous cycle suggested cautious tone', score: 0.9, memoryRecordId: 'r1' },
      ]);
      await handlers.GENERATE_NARRATIVE(phasePayload, phaseCtx);
      expect(mockRunPipeline).toHaveBeenCalledWith(
        'evt-narr-1',
        expect.objectContaining({
          priorNarratives: ['Previous cycle suggested cautious tone'],
        }),
      );
      const lastCallArgs = mockRunPipeline.mock.calls.at(-1)?.[1] ?? {};
      expect('preferences' in lastCallArgs).toBe(false);
      expect('sessionHistory' in lastCallArgs).toBe(false);
    });
  });
});
