/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  resumeStateMachine, update, record,
  type EventPayload, type EventContext,
} from '@nestfolio/event-processor';
import {
  AGENT_COMPLETION_EVENT_TYPES,
  COMPLIANCE_EVENT_TYPES,
  USER_RESPONSE_EVENT_TYPES,
} from '../domain/events';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/events';
import { AdvisoryBffEventTypes } from '@nestfolio/advisory-bff/events';

const createHandlers = () => {
  const handlers: Record<string, any> = {};

  // Agent completion: just resume SFN with decisionId
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

  // Compliance: resume SFN + update DecisionPacket status
  for (const type of COMPLIANCE_EVENT_TYPES) {
    handlers[type] = async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject ?? {};
      const isApproved = ctx.eventType === ComplianceEventTypes.DECISION_APPROVED;
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

  // User response: resume SFN + update DecisionPacket status
  for (const type of USER_RESPONSE_EVENT_TYPES) {
    handlers[type] = async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject ?? {};
      const isConfirmed = ctx.eventType === AdvisoryBffEventTypes.USER_CONFIRMED;
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
};

export const handler = resumeStateMachine({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(),
  errorEventType: 'DECISION_WORKFLOW_FAILED',
});
