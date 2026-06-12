jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  SendTaskSuccessCommand: jest.fn(),
  SendTaskFailureCommand: jest.fn(),
}));

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

process.env.TABLE_NAME = 'test-table';
process.env.BUS_NAME = 'test-bus';

import type { EventPayload, EventContext } from '@nestfolio/event-processor';
import { asTenantId, asUserId } from '@nestfolio/event-processor';
import {
  AGENT_COMPLETION_EVENT_TYPES,
  AGENT_FAILURE_EVENT_TYPES,
  COMPLIANCE_EVENT_TYPES,
  USER_RESPONSE_EVENT_TYPES,
} from '../../src/domain/events';

// Import the REAL createHandlers from source to exercise the parseSubject seam.
import { createHandlers } from '../../src/handlers/sfn-callback';

const baseCtx = (eventType: string): EventContext => ({
  eventId: 'evt-1',
  eventType,
  tenantId: asTenantId('t1'),
  userId: asUserId('test-user'),
  region: 'us-east-1',
  timestamp: new Date().toISOString(),
  receiveCount: 1,
  serviceName: 'decision-workflow-ctrl',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  record: {} as any,
});

describe('decision-workflow-ctrl sfn-callback (resumeStateMachine)', () => {
  const handlers = createHandlers();

  // --- Agent completion events ---

  describe('agent completion events', () => {
    it('PORTFOLIO_COMPLETED returns output with decisionId + agentOutput from subject', async () => {
      // PortfolioAgentCompletionSchema: { decisionId, agentName:'portfolio-engine',
      //   taskToken, agentOutput: PortfolioAgentOutput, completedAt }. tenantId is identity (NOT on schema).
      // agentOutput must satisfy PortfolioAgentOutputSchema → PortfolioConstructionSchema
      // which requires: allocations[], totalExposure, equityWeight, riskMetrics{…}, confidence.
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          agentName: 'portfolio-engine',
          taskToken: 'token-pe',
          agentOutput: {
            decisionId: 'dp-1',
            allocations: {
              allocations: [],
              totalExposure: 1.0,
              equityWeight: 0,
              riskMetrics: { concentrationRisk: 0, sectorDiversity: 0, largestPositionWeight: 0 },
              confidence: 1,
            },
            metadata: { durationMs: 500 },
          },
          completedAt: '2026-01-01T00:00:00.000Z',
        },
      };

      const result = await handlers.PORTFOLIO_COMPLETED(payload, baseCtx('PORTFOLIO_COMPLETED'));

      expect(result.output.decisionId).toBe('dp-1');
      expect(result.output.agentOutput).toBeDefined();
      // The resumeStateMachine wrapper JSON.stringifies result.output as the
      // SF SendTaskSuccess output — confirm the JSON contains the agent payload.
      expect(JSON.stringify(result.output)).toContain('allocations');
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]._tag).toBe('record');
    });

    it('PORTFOLIO_COMPLETED: ZodError when agentOutput missing (required by schema)', async () => {
      // parseSubject validates against PortfolioAgentCompletionSchema which requires agentOutput.
      // A missing agentOutput throws ZodError — confirming the parseSubject seam fires.
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-zod',
          agentName: 'portfolio-engine',
          taskToken: 'token-pe',
          // agentOutput intentionally missing
          completedAt: '2026-01-01T00:00:00.000Z',
        },
      };

      await expect(handlers.PORTFOLIO_COMPLETED(payload, baseCtx('PORTFOLIO_COMPLETED')))
        .rejects.toThrow(); // ZodError
    });

    it('NARRATIVE_COMPLETED returns output with decisionId + agentOutput from subject', async () => {
      // NarrativeAgentCompletionSchema: { decisionId, agentName:'advisory-narrative',
      //   taskToken, agentOutput: NarrativeAgentOutput, completedAt }
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          agentName: 'advisory-narrative',
          taskToken: 'token-an',
          agentOutput: {
            summary: 'Diversify',
            rationale: 'because diversification',
            keyFactors: ['equity'],
            tone: 'INFORMATIVE',
            wordCount: 20,
            confidence: 0.9,
            decisionId: 'dp-1',
            metadata: { durationMs: 1000 },
          },
          completedAt: '2026-01-01T00:00:00.000Z',
        },
      };

      const result = await handlers.NARRATIVE_COMPLETED(payload, baseCtx('NARRATIVE_COMPLETED'));

      expect(result.output.decisionId).toBe('dp-1');
      expect(result.output.agentOutput).toBeDefined();
      expect(JSON.stringify(result.output)).toContain('rationale');
    });

    it('only PORTFOLIO_COMPLETED + NARRATIVE_COMPLETED remain as agent completions', () => {
      expect(AGENT_COMPLETION_EVENT_TYPES).toHaveLength(2);
      expect([...AGENT_COMPLETION_EVENT_TYPES]).toEqual(
        expect.arrayContaining(['PORTFOLIO_COMPLETED', 'NARRATIVE_COMPLETED']),
      );
    });

    it('does not have handlers for INVESTOR_PROFILE_COMPLETED or MARKET_ANALYSIS_COMPLETED', () => {
      expect(handlers.INVESTOR_PROFILE_COMPLETED).toBeUndefined();
      expect(handlers.MARKET_ANALYSIS_COMPLETED).toBeUndefined();
    });
  });

  // --- Agent failure events ---

  describe('agent failure events', () => {
    it('PORTFOLIO_FAILED throws Error with name=errorType, message=errorMessage', async () => {
      // PortfolioAgentFailureSchema: { decisionId, agentName:'portfolio-engine',
      //   taskToken, errorType, errorMessage, failedAt }
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          agentName: 'portfolio-engine',
          taskToken: 'token-pe',
          errorType: 'BedrockThrottle',
          errorMessage: 'Bedrock throttle',
          failedAt: '2026-01-01T00:00:00.000Z',
        },
      };

      await expect(handlers.PORTFOLIO_FAILED(payload, baseCtx('PORTFOLIO_FAILED')))
        .rejects.toMatchObject({ name: 'BedrockThrottle', message: 'Bedrock throttle' });
    });

    it('NARRATIVE_FAILED throws Error with name=errorType, message=errorMessage', async () => {
      // NarrativeAgentFailureSchema: { decisionId, agentName:'advisory-narrative',
      //   taskToken, errorType, errorMessage, failedAt }
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          agentName: 'advisory-narrative',
          taskToken: 'token-an',
          errorType: 'AgentRuntimeError',
          errorMessage: 'something snapped',
          failedAt: '2026-01-01T00:00:00.000Z',
        },
      };

      await expect(handlers.NARRATIVE_FAILED(payload, baseCtx('NARRATIVE_FAILED')))
        .rejects.toMatchObject({ name: 'AgentRuntimeError', message: 'something snapped' });
    });

    it('PORTFOLIO_FAILED: ZodError when errorType missing (schema requires it)', async () => {
      // parseSubject validates against PortfolioAgentFailureSchema — errorType is required.
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          agentName: 'portfolio-engine',
          taskToken: 'tok',
          // errorType intentionally missing
          errorMessage: 'something went wrong',
          failedAt: '2026-01-01T00:00:00.000Z',
        },
      };

      await expect(handlers.PORTFOLIO_FAILED(payload, baseCtx('PORTFOLIO_FAILED')))
        .rejects.toThrow(); // ZodError
    });

    it('exposes PORTFOLIO_FAILED + NARRATIVE_FAILED as the failure set', () => {
      expect(AGENT_FAILURE_EVENT_TYPES).toHaveLength(2);
      expect([...AGENT_FAILURE_EVENT_TYPES]).toEqual(
        expect.arrayContaining(['PORTFOLIO_FAILED', 'NARRATIVE_FAILED']),
      );
    });
  });

  // --- Compliance events ---

  describe('compliance events', () => {
    // Real ComplianceCheck fixture (DRY subject — tenantId NOT on schema, identity is in ctx).
    // NOTE: ComplianceCheckSchema has NO `reason` field (has `violations` array instead).
    // `blockReason` on the DecisionPacket update is preserved as `undefined` — this is the
    // pre-existing gap tracked in docs/backlog/dwc-sfn-callback-reason-blockreason-gap.md.
    const complianceCheckSubject = (overrides: Record<string, unknown> = {}) => ({
      ccId: 'cc-1',
      decisionPacketId: 'dp-1',
      decisionId: 'dp-1',
      taskToken: 'token-compliance',
      mandateSnapshot: {
        level: 'ADVISORY',
        status: 'ACTIVE',
        operatingMode: 'CONSERVATIVE',
        effectiveDate: '2026-01-01T00:00:00.000Z',
      },
      status: 'COMPLETED',
      result: 'APPROVED',
      violations: [],
      authorityLevel: 'L1',
      sourceEventId: 'src-1',
      ...overrides,
    });

    it('(a) DECISION_APPROVED L1 → status APPROVED + add:{ __version:1 }', async () => {
      const payload: EventPayload = {
        subject: complianceCheckSubject({ result: 'APPROVED', authorityLevel: 'L1' }),
      };

      const result = await handlers.DECISION_APPROVED(payload, baseCtx('DECISION_APPROVED'));

      expect(result.output).toEqual({ decision: 'APPROVED', authorityLevel: 'L1' });
      expect(result.intents).toHaveLength(1);
      const intent = result.intents[0];
      expect(intent._tag).toBe('update');
      expect(intent.typename).toBe('DecisionPacket');
      expect(intent.updates).toEqual({
        status: 'APPROVED',
        complianceResult: 'APPROVED',
        authorityLevel: 'L1',
      });
      expect(intent.add).toEqual({ __version: 1 });
      expect(intent.overrides).toEqual({ pk: 'DecisionPacket#t1#dp-1', sk: 'DecisionPacket' });
    });

    it('(b) DECISION_APPROVED L2 → NO status key in updates + add:{ __version:1 }', async () => {
      const payload: EventPayload = {
        subject: complianceCheckSubject({ authorityLevel: 'L2' }),
      };

      const result = await handlers.DECISION_APPROVED(payload, baseCtx('DECISION_APPROVED'));

      const intent = result.intents[0];
      expect('status' in intent.updates).toBe(false);
      expect(intent.updates).toEqual({
        complianceResult: 'APPROVED',
        authorityLevel: 'L2',
      });
      expect(intent.add).toEqual({ __version: 1 });
    });

    it('(c) DECISION_BLOCKED L2 → status BLOCKED; blockReason is undefined (pre-existing gap — ComplianceCheck carries violations not reason)', async () => {
      // The real ComplianceCheck shape carries `violations` array, NOT a `reason` string.
      // blockReason on DecisionPacket is preserved as undefined here — see comment in handler.
      // The fix (derive blockReason from violations) is tracked in:
      // docs/backlog/dwc-sfn-callback-reason-blockreason-gap.md
      const payload: EventPayload = {
        subject: complianceCheckSubject({
          result: 'BLOCKED',
          status: 'BLOCKED',
          authorityLevel: 'L2',
          violations: [{ rule: 'MANDATE_VIOLATION', description: 'Exceeds risk limits', severity: 'BLOCKING' }],
          // NOTE: no `reason` field — ComplianceCheckSchema does NOT have `reason`
        }),
      };

      const result = await handlers.DECISION_BLOCKED(payload, baseCtx('DECISION_BLOCKED'));

      expect(result.output).toEqual({ decision: 'BLOCKED', authorityLevel: 'L2' });
      const intent = result.intents[0];
      expect(intent.updates).toEqual({
        status: 'BLOCKED',
        complianceResult: 'BLOCKED',
        authorityLevel: 'L2',
        // blockReason is NOT set — ComplianceCheck carries no `reason` field.
        // This preserves the pre-existing behavior (was always undefined).
      });
      expect('blockReason' in intent.updates).toBe(false);
      expect(intent.add).toEqual({ __version: 1 });
    });

    it('DECISION_APPROVED: ZodError when required ComplianceCheck fields missing', async () => {
      // parseSubject against ComplianceCheckSchema rejects a subject missing required fields.
      const payload: EventPayload = {
        subject: {
          // ccId, decisionPacketId, taskToken, mandateSnapshot, etc. all missing
          decisionId: 'dp-1',
          authorityLevel: 'L1',
        },
      };

      await expect(handlers.DECISION_APPROVED(payload, baseCtx('DECISION_APPROVED')))
        .rejects.toThrow(); // ZodError
    });
  });

  // --- User response events ---

  describe('user response events', () => {
    it('(d) USER_CONFIRMED → confirmedAt=ctx.timestamp + add:{ __version:1 }, no rejectedAt', async () => {
      // UserConfirmationSchema: { decisionId, confirmedAt, confirmedBy, timestamp, taskToken? }
      // tenantId is identity (NOT on schema). No `reason` field.
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          confirmedAt: '2026-01-01T00:00:00.000Z',
          confirmedBy: 'user-1',
          timestamp: '2026-01-01T00:00:00.000Z',
          taskToken: 'token-user',
        },
      };
      const ctx = baseCtx('USER_CONFIRMED');
      const result = await handlers.USER_CONFIRMED(payload, ctx);

      expect(result.output).toEqual({ decision: 'CONFIRMED' });
      expect(result.intents).toHaveLength(1);
      const intent = result.intents[0];
      expect(intent._tag).toBe('update');
      expect(intent.typename).toBe('DecisionPacket');
      expect(intent.updates).toEqual({
        status: 'CONFIRMED',
        userDecision: 'CONFIRMED',
        confirmedAt: ctx.timestamp,
      });
      expect('rejectedAt' in intent.updates).toBe(false);
      expect(intent.add).toEqual({ __version: 1 });
      expect(intent.removes).toEqual(['taskToken']);
      expect(intent.overrides).toEqual({ pk: 'DecisionPacket#t1#dp-1', sk: 'DecisionPacket' });
    });

    it('(e) USER_REJECTED with rejectionReason → rejectedAt=ctx.timestamp + rejectionReason + add:{ __version:1 }, no confirmedAt', async () => {
      // UserRejectionSchema: { decisionId, rejectedAt, rejectedBy, rejectionReason, timestamp, taskToken? }
      // The field is `rejectionReason` (not `reason`) — matches the producer schema.
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          rejectedAt: '2026-01-01T00:00:00.000Z',
          rejectedBy: 'user-1',
          rejectionReason: 'Too risky',
          timestamp: '2026-01-01T00:00:00.000Z',
          taskToken: 'token-user',
        },
      };
      const ctx = baseCtx('USER_REJECTED');
      const result = await handlers.USER_REJECTED(payload, ctx);

      expect(result.output).toEqual({ decision: 'REJECTED' });
      const intent = result.intents[0];
      expect(intent.updates).toEqual({
        status: 'REJECTED',
        userDecision: 'REJECTED',
        rejectedAt: ctx.timestamp,
        rejectionReason: 'Too risky',
      });
      expect('confirmedAt' in intent.updates).toBe(false);
      expect(intent.add).toEqual({ __version: 1 });
      expect(intent.removes).toEqual(['taskToken']);
    });

    it('USER_CONFIRMED: ZodError when required fields missing (schema requires decisionId, confirmedAt, confirmedBy, timestamp)', async () => {
      const payload: EventPayload = {
        subject: {
          // decisionId missing — required by UserConfirmationSchema
          taskToken: 'token-user',
        },
      };
      await expect(handlers.USER_CONFIRMED(payload, baseCtx('USER_CONFIRMED')))
        .rejects.toThrow(); // ZodError
    });

    it('USER_RESPONSE_EVENT_TYPES contains USER_CONFIRMED + USER_REJECTED', () => {
      expect([...USER_RESPONSE_EVENT_TYPES]).toEqual(
        expect.arrayContaining(['USER_CONFIRMED', 'USER_REJECTED']),
      );
    });
  });

  it('COMPLIANCE_EVENT_TYPES contains DECISION_APPROVED + DECISION_BLOCKED', () => {
    expect([...COMPLIANCE_EVENT_TYPES]).toEqual(
      expect.arrayContaining(['DECISION_APPROVED', 'DECISION_BLOCKED']),
    );
  });
});
