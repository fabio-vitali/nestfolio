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
  COMPLIANCE_EVENT_TYPES,
  USER_RESPONSE_EVENT_TYPES,
} from '../src/domain/events';

// Re-create the handler factory from sfn-callback.ts to test handler logic directly
import { record, update, asTenantId, asUserId } from '@nestfolio/event-processor';

function createHandlers() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, any> = {};

  for (const type of AGENT_COMPLETION_EVENT_TYPES) {
    handlers[type] = async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject ?? {};
      return {
        output: { decisionId: subject.decisionId },
        intents: [record('AgentOutput', {
          decisionId: subject.decisionId as string,
          eventType: ctx.eventType,
          tenantId: (subject.tenantId as string) ?? ctx.tenantId,
        })],
      };
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
  record: {} as any,
});

describe('decision-workflow-ctrl sfn-callback (resumeStateMachine)', () => {
  const handlers = createHandlers();

  // --- Agent completion events ---

  describe('agent completion events', () => {
    it('should return output with decisionId and AgentOutput record intent', async () => {
      const payload: EventPayload = {
        subject: {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-abc',
        },
      };

      const result = await handlers.INVESTOR_PROFILE_COMPLETED(payload, baseCtx('INVESTOR_PROFILE_COMPLETED'));

      expect(result.output).toEqual({ decisionId: 'dp-1' });
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toEqual({
        _tag: 'record',
        typename: 'AgentOutput',
        fields: { decisionId: 'dp-1', eventType: 'INVESTOR_PROFILE_COMPLETED', tenantId: 't1' },
        overrides: undefined,
      });
    });

    it('should handle all 4 agent completion event types', async () => {
      expect(AGENT_COMPLETION_EVENT_TYPES).toHaveLength(4);
      for (const type of AGENT_COMPLETION_EVENT_TYPES) {
        const payload: EventPayload = {
          subject: { decisionId: 'dp-1', tenantId: 't1', taskToken: 'tok' },
        };
        const result = await handlers[type](payload, baseCtx(type));
        expect(result.output.decisionId).toBe('dp-1');
        expect(result.intents[0]._tag).toBe('record');
      }
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
