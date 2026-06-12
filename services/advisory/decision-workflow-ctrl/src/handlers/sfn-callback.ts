import {
  resumeStateMachine, update, record, parseSubject,
  type EventPayload, type EventContext,
} from '@nestfolio/event-processor';
import '../read-model-ownership';
import { COMPLIANCE_EVENT_TYPES } from '../domain/events';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/events';
import { ComplianceCheckSchema } from '@nestfolio/compliance-ctrl/contracts';
import { AdvisoryBffEventTypes } from '@nestfolio/advisory-bff/events';
import { UserConfirmationSchema, UserRejectionSchema } from '@nestfolio/advisory-bff/contracts';
import { PortfolioAgentCompletionSchema, PortfolioAgentFailureSchema } from '@nestfolio/portfolio-engine-ctrl/contracts';
import { NarrativeAgentCompletionSchema, NarrativeAgentFailureSchema } from '@nestfolio/advisory-narrative-ctrl/contracts';

export const createHandlers = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, any> = {};

  // PORTFOLIO_COMPLETED: resume SFN with agentOutput from subject.
  // PortfolioAgentCompletionSchema: { decisionId, agentName:'portfolio-engine', taskToken,
  //   agentOutput: PortfolioAgentOutput, completedAt }
  // tenantId is identity (RequestContext) — NOT on schema, read from ctx.
  handlers['PORTFOLIO_COMPLETED'] = async (payload: EventPayload, ctx: EventContext) => {
    const subject = parseSubject(payload, PortfolioAgentCompletionSchema);
    const decisionId = subject.decisionId;
    const tenantId = ctx.tenantId;
    const agentOutput = subject.agentOutput;
    return {
      output: { decisionId, agentOutput },
      intents: [record('AgentOutput', { decisionId, eventType: ctx.eventType, tenantId })],
    };
  };

  // NARRATIVE_COMPLETED: resume SFN with agentOutput from subject.
  // NarrativeAgentCompletionSchema: { decisionId, agentName:'advisory-narrative', taskToken,
  //   agentOutput: NarrativeAgentOutput, completedAt }
  // tenantId is identity (RequestContext) — NOT on schema, read from ctx.
  handlers['NARRATIVE_COMPLETED'] = async (payload: EventPayload, ctx: EventContext) => {
    const subject = parseSubject(payload, NarrativeAgentCompletionSchema);
    const decisionId = subject.decisionId;
    const tenantId = ctx.tenantId;
    const agentOutput = subject.agentOutput;
    return {
      output: { decisionId, agentOutput },
      intents: [record('AgentOutput', { decisionId, eventType: ctx.eventType, tenantId })],
    };
  };

  // PORTFOLIO_FAILED: throw an Error with name=errorType, message=errorMessage.
  // PortfolioAgentFailureSchema: { decisionId, agentName:'portfolio-engine', taskToken,
  //   errorType, errorMessage, failedAt }
  // resumeStateMachine's wrapper catches and calls SendTaskFailureCommand with
  // error=err.name, cause=err.message so the SF fails the corresponding task.
  handlers['PORTFOLIO_FAILED'] = async (payload: EventPayload, _ctx: EventContext) => {
    const subject = parseSubject(payload, PortfolioAgentFailureSchema);
    const err = new Error(subject.errorMessage);
    err.name = subject.errorType;
    throw err;
  };

  // NARRATIVE_FAILED: throw an Error with name=errorType, message=errorMessage.
  // NarrativeAgentFailureSchema: { decisionId, agentName:'advisory-narrative', taskToken,
  //   errorType, errorMessage, failedAt }
  handlers['NARRATIVE_FAILED'] = async (payload: EventPayload, _ctx: EventContext) => {
    const subject = parseSubject(payload, NarrativeAgentFailureSchema);
    const err = new Error(subject.errorMessage);
    err.name = subject.errorType;
    throw err;
  };

  // Compliance (DECISION_APPROVED / DECISION_BLOCKED): resume SFN + update DecisionPacket status.
  // ComplianceCheckSchema: { ccId, decisionPacketId, decisionId, taskToken, mandateSnapshot,
  //   status, result, violations, authorityLevel, sourceEventId }
  // NOTE: ComplianceCheckSchema has NO `reason` field (it has `violations`). The old
  // `subject.reason` was always `undefined` because `reason` was never on the producer's schema.
  // blockReason preserved as undefined — deriving it from violations is tracked in
  // docs/backlog/dwc-sfn-callback-reason-blockreason-gap.md.
  // tenantId is identity (RequestContext) — NOT on schema, read from ctx.
  for (const type of COMPLIANCE_EVENT_TYPES) {
    handlers[type] = async (payload: EventPayload, ctx: EventContext) => {
      const subject = parseSubject(payload, ComplianceCheckSchema);
      const isApproved = ctx.eventType === ComplianceEventTypes.DECISION_APPROVED;
      const decision = isApproved ? 'APPROVED' : 'BLOCKED';
      const authorityLevel = subject.authorityLevel;
      const tenantId = ctx.tenantId;
      const decisionId = subject.decisionId;

      return {
        output: { decision, authorityLevel },
        intents: decisionId ? [update('DecisionPacket', {
          // L2 AWAITING_CONFIRMATION is written solely by the SF
          // updateItem.waitForTaskToken state (single writer, Task 1.3). Here, for L2
          // we record only the compliance verdict; for L1 we set terminal APPROVED;
          // BLOCKED is terminal for both.
          ...(isApproved
            ? (authorityLevel === 'L1' ? { status: 'APPROVED' } : {})
            : { status: 'BLOCKED' }),
          complianceResult: decision,
          authorityLevel,
          // blockReason: ComplianceCheck carries no `reason` (it has `violations`); the old
          // subject.reason was always undefined. Preserved as-is; deriving it from violations
          // is the fix tracked in docs/backlog/dwc-sfn-callback-reason-blockreason-gap.md.
        }, {
          add: { __version: 1 },
          overrides: { pk: `DecisionPacket#${tenantId}#${decisionId}`, sk: 'DecisionPacket' },
        })] : [],
      };
    };
  }

  // USER_CONFIRMED: resume SFN + update DecisionPacket status (confirmed).
  // UserConfirmationSchema: { decisionId, confirmedAt, confirmedBy, timestamp, taskToken? }
  // tenantId is identity (RequestContext) — NOT on schema, read from ctx.
  handlers[AdvisoryBffEventTypes.USER_CONFIRMED] = async (payload: EventPayload, ctx: EventContext) => {
    const subject = parseSubject(payload, UserConfirmationSchema);
    const decisionId = subject.decisionId;
    const tenantId = ctx.tenantId;
    const now = ctx.timestamp;
    return {
      output: { decision: 'CONFIRMED' },
      intents: decisionId ? [update('DecisionPacket', {
        status: 'CONFIRMED',
        userDecision: 'CONFIRMED',
        confirmedAt: now,
      }, {
        add: { __version: 1 },
        // CONFIRMED is terminal; the L2 waitForTaskToken token was already consumed
        // to resume the SF. Strip the now-dead attribute.
        removes: ['taskToken'],
        overrides: { pk: `DecisionPacket#${tenantId}#${decisionId}`, sk: 'DecisionPacket' },
      })] : [],
    };
  };

  // USER_REJECTED: resume SFN + update DecisionPacket status (rejected).
  // UserRejectionSchema: { decisionId, rejectedAt, rejectedBy, rejectionReason, timestamp, taskToken? }
  // tenantId is identity (RequestContext) — NOT on schema, read from ctx.
  handlers[AdvisoryBffEventTypes.USER_REJECTED] = async (payload: EventPayload, ctx: EventContext) => {
    const subject = parseSubject(payload, UserRejectionSchema);
    const decisionId = subject.decisionId;
    const tenantId = ctx.tenantId;
    const now = ctx.timestamp;
    return {
      output: { decision: 'REJECTED' },
      intents: decisionId ? [update('DecisionPacket', {
        status: 'REJECTED',
        userDecision: 'REJECTED',
        rejectedAt: now,
        rejectionReason: subject.rejectionReason,
      }, {
        add: { __version: 1 },
        // REJECTED is terminal; strip the now-dead taskToken attribute.
        removes: ['taskToken'],
        overrides: { pk: `DecisionPacket#${tenantId}#${decisionId}`, sk: 'DecisionPacket' },
      })] : [],
    };
  };

  return handlers;
};

export const handler = resumeStateMachine({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(),
  errorEventType: 'DECISION_WORKFLOW_FAILED',
});
