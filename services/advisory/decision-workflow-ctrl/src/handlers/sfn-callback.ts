/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  resumeStateMachine, update, record,
  type EventPayload, type EventContext,
} from '@nestfolio/event-processor';
import {
  AGENT_COMPLETION_EVENT_TYPES,
  AGENT_FAILURE_EVENT_TYPES,
  COMPLIANCE_EVENT_TYPES,
  USER_RESPONSE_EVENT_TYPES,
} from '../domain/events';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/events';
import { AdvisoryBffEventTypes } from '@nestfolio/advisory-bff/events';

const createHandlers = () => {
  const handlers: Record<string, any> = {};

  // Agent completion (PE / AN): resume SFN with agentOutput from subject.
  // Upstream services emit AgentCompletion CDC rows → PORTFOLIO_COMPLETED /
  // NARRATIVE_COMPLETED events carrying the taskToken + agentOutput. The
  // resumeStateMachine pipeline picks taskToken from subject and JSON-stringifies
  // result.output as the SF SendTaskSuccessCommand output, which lands at
  // $.agentResults.<state>.agentOutput in SF state.
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

  // Agent failure (PE / AN): throw an Error with name=errorType, message=errorMessage.
  // resumeStateMachine's wrapper catches and calls SendTaskFailureCommand with
  // error=err.name, cause=err.message so the SF fails the corresponding task.
  // Generates handlers for: PORTFOLIO_FAILED, NARRATIVE_FAILED — see AGENT_FAILURE_EVENT_TYPES.
  for (const type of AGENT_FAILURE_EVENT_TYPES) {
    handlers[type] = async (payload: EventPayload, _ctx: EventContext) => {
      const subject = payload.subject ?? {};
      const errorType = (subject.errorType as string | undefined) ?? 'UnknownError';
      const errorMessage = (subject.errorMessage as string | undefined) ?? 'unknown';
      // See libs/event-processor/src/pipelines/resume-state-machine.ts:78-100 —
      // pipeline reads err.name into SendTaskFailureCommand.error and err.message
      // into SendTaskFailureCommand.cause when the handler throws.
      const err = new Error(errorMessage);
      err.name = errorType;
      throw err;
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
