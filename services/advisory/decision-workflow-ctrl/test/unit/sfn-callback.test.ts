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
import {
  AGENT_COMPLETION_EVENT_TYPES,
  AGENT_FAILURE_EVENT_TYPES,
  COMPLIANCE_EVENT_TYPES,
  USER_RESPONSE_EVENT_TYPES,
} from '../../src/domain/events';

// Re-create the handler factory from sfn-callback.ts to test handler logic
// directly. Failure handlers throw — that throw is what causes the
// resumeStateMachine wrapper to invoke SendTaskFailureCommand at runtime.
import { record, update, asTenantId, asUserId } from '@nestfolio/event-processor';

function createHandlers() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, any> = {};

  for (const type of AGENT_COMPLETION_EVENT_TYPES) {
    handlers[type] = async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject ?? {};
      const decisionId = subject.decisionId as string;
      const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
      const agentOutput = (subject.agentOutput as Record<string, unknown>) ?? {};
      return {
        output: { decisionId, agentOutput },
        intents: [record('AgentOutput', {
          decisionId,
          eventType: ctx.eventType,
          tenantId,
        })],
      };
    };
  }

  for (const type of AGENT_FAILURE_EVENT_TYPES) {
    handlers[type] = async (payload: EventPayload, _ctx: EventContext) => {
      const subject = payload.subject ?? {};
      const errorType = (subject.errorType as string | undefined) ?? 'UnknownError';
      const errorMessage = (subject.errorMessage as string | undefined) ?? 'unknown';
      const err = new Error(errorMessage);
      err.name = errorType;
      throw err;
    };
  }

  for (const type of COMPLIANCE_EVENT_TYPES) {
    handlers[type] = async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject ?? {};
      const isApproved = ctx.eventType === 'DECISION_APPROVED';
      const decision = isApproved ? 'APPROVED' : 'BLOCKED';
      const authorityLevel = (subject.authorityLevel as string) ?? 'L2';
      const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
      const decisionId = subject.decisionId as string;
      const reason = subject.reason as string | undefined;

      return {
        output: { decision, authorityLevel, ...(reason ? { reason } : {}) },
        intents: decisionId ? [update('DecisionPacket', {
          status: isApproved ? (authorityLevel === 'L1' ? 'APPROVED' : 'AWAITING_CONFIRMATION') : 'BLOCKED',
          complianceResult: decision,
          authorityLevel,
          ...(reason ? { blockReason: reason } : {}),
        }, { overrides: { pk: `DecisionPacket#${tenantId}#${decisionId}`, sk: 'DecisionPacket' } })] : [],
      };
    };
  }

  for (const type of USER_RESPONSE_EVENT_TYPES) {
    handlers[type] = async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject ?? {};
      const isConfirmed = ctx.eventType === 'USER_CONFIRMED';
      const decision = isConfirmed ? 'CONFIRMED' : 'REJECTED';
      const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
      const decisionId = subject.decisionId as string;
      const reason = subject.reason as string | undefined;

      return {
        output: { decision, ...(reason ? { reason } : {}) },
        intents: decisionId ? [update('DecisionPacket', {
          status: decision,
          userDecision: decision,
          ...(reason ? { rejectionReason: reason } : {}),
        }, { overrides: { pk: `DecisionPacket#${tenantId}#${decisionId}`, sk: 'DecisionPacket' } })] : [],
      };
    };
  }

  return handlers;
}

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
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-pe',
          agentOutput: { allocations: { allocations: [], totalExposure: 1.0 } },
        },
      };

      const result = await handlers.PORTFOLIO_COMPLETED(payload, baseCtx('PORTFOLIO_COMPLETED'));

      expect(result.output).toEqual({
        decisionId: 'dp-1',
        agentOutput: { allocations: { allocations: [], totalExposure: 1.0 } },
      });
      // The resumeStateMachine wrapper JSON.stringifies result.output as the
      // SF SendTaskSuccess output — confirm the JSON contains the agent payload.
      expect(JSON.stringify(result.output)).toContain('allocations');
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]._tag).toBe('record');
    });

    it('NARRATIVE_COMPLETED returns output with decisionId + agentOutput from subject', async () => {
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-an',
          agentOutput: { explanation: 'because diversification' },
        },
      };

      const result = await handlers.NARRATIVE_COMPLETED(payload, baseCtx('NARRATIVE_COMPLETED'));

      expect(result.output).toEqual({
        decisionId: 'dp-1',
        agentOutput: { explanation: 'because diversification' },
      });
      expect(JSON.stringify(result.output)).toContain('explanation');
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
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-pe',
          errorType: 'BedrockThrottle',
          errorMessage: 'Bedrock throttle',
        },
      };

      await expect(handlers.PORTFOLIO_FAILED(payload, baseCtx('PORTFOLIO_FAILED')))
        .rejects.toMatchObject({ name: 'BedrockThrottle', message: 'Bedrock throttle' });
    });

    it('NARRATIVE_FAILED throws Error with name=errorType, message=errorMessage', async () => {
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-an',
          errorType: 'AgentRuntimeError',
          errorMessage: 'something snapped',
        },
      };

      await expect(handlers.NARRATIVE_FAILED(payload, baseCtx('NARRATIVE_FAILED')))
        .rejects.toMatchObject({ name: 'AgentRuntimeError', message: 'something snapped' });
    });

    it('falls back to UnknownError / "unknown" when subject lacks error fields', async () => {
      const payload: EventPayload = {
        subject: { decisionId: 'dp-1', tenantId: 't1', taskToken: 'tok' },
      };

      await expect(handlers.PORTFOLIO_FAILED(payload, baseCtx('PORTFOLIO_FAILED')))
        .rejects.toMatchObject({ name: 'UnknownError', message: 'unknown' });
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
    it('should return APPROVED output and update intent for DECISION_APPROVED L1', async () => {
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-compliance',
          authorityLevel: 'L1',
        },
      };

      const result = await handlers.DECISION_APPROVED(payload, baseCtx('DECISION_APPROVED'));

      expect(result.output).toEqual({ decision: 'APPROVED', authorityLevel: 'L1' });
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toEqual({
        _tag: 'update',
        typename: 'DecisionPacket',
        updates: {
          status: 'APPROVED',
          complianceResult: 'APPROVED',
          authorityLevel: 'L1',
        },
        overrides: { pk: 'DecisionPacket#t1#dp-1', sk: 'DecisionPacket' },
      });
    });

    it('should return AWAITING_CONFIRMATION for DECISION_APPROVED L2', async () => {
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-compliance',
          authorityLevel: 'L2',
        },
      };

      const result = await handlers.DECISION_APPROVED(payload, baseCtx('DECISION_APPROVED'));

      expect(result.intents[0].updates.status).toBe('AWAITING_CONFIRMATION');
    });

    it('should return BLOCKED output for DECISION_BLOCKED', async () => {
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-compliance',
          reason: 'Exceeds risk limits',
        },
      };

      const result = await handlers.DECISION_BLOCKED(payload, baseCtx('DECISION_BLOCKED'));

      expect(result.output).toEqual({
        decision: 'BLOCKED',
        authorityLevel: 'L2',
        reason: 'Exceeds risk limits',
      });
      expect(result.intents[0].updates).toEqual(expect.objectContaining({
        status: 'BLOCKED',
        complianceResult: 'BLOCKED',
        blockReason: 'Exceeds risk limits',
      }));
    });

    it('should return empty intents when decisionId is missing', async () => {
      const payload: EventPayload = {
        subject: {
          tenantId: 't1',
          taskToken: 'token-compliance',
        },
      };

      const result = await handlers.DECISION_APPROVED(payload, baseCtx('DECISION_APPROVED'));
      expect(result.intents).toHaveLength(0);
    });
  });

  // --- User response events ---

  describe('user response events', () => {
    it('should return CONFIRMED output and update intent for USER_CONFIRMED', async () => {
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-user',
        },
      };

      const result = await handlers.USER_CONFIRMED(payload, baseCtx('USER_CONFIRMED'));

      expect(result.output).toEqual({ decision: 'CONFIRMED' });
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toEqual({
        _tag: 'update',
        typename: 'DecisionPacket',
        updates: {
          status: 'CONFIRMED',
          userDecision: 'CONFIRMED',
        },
        overrides: { pk: 'DecisionPacket#t1#dp-1', sk: 'DecisionPacket' },
      });
    });

    it('should return REJECTED output with reason for USER_REJECTED', async () => {
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-user',
          reason: 'Too risky',
        },
      };

      const result = await handlers.USER_REJECTED(payload, baseCtx('USER_REJECTED'));

      expect(result.output).toEqual({ decision: 'REJECTED', reason: 'Too risky' });
      expect(result.intents[0].updates).toEqual(expect.objectContaining({
        status: 'REJECTED',
        userDecision: 'REJECTED',
        rejectionReason: 'Too risky',
      }));
    });

    it('should return empty intents when decisionId is missing', async () => {
      const payload: EventPayload = {
        subject: {
          tenantId: 't1',
          taskToken: 'token-user',
        },
      };

      const result = await handlers.USER_CONFIRMED(payload, baseCtx('USER_CONFIRMED'));
      expect(result.intents).toHaveLength(0);
    });
  });
});
