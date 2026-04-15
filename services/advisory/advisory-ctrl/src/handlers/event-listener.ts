import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { materializeToTable, skip, update, pickRequestContext, type WriteIntent, type EventPayload, type EventContext, type BusEvent } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { logger } from '@nestfolio/event-processor';
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
import { AdvisoryBffEventTypes } from '@nestfolio/advisory-bff/events';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/events';
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { AdvisoryCtrlEventTypes } from '../domain/events';
import { DecisionRepository } from '../repositories/decision.repository';
import { DecisionLifecycleService } from '../services/decision-lifecycle.service';

export interface EventListenerDeps {
  readonly lifecycleService: DecisionLifecycleService;
}

function decisionPk(tenantId: string, dpId: string): string {
  return `DecisionPacket#${tenantId}#${dpId}`;
}

function toEvent(payload: EventPayload, ctx: EventContext): BusEvent {
  return {
    id: ctx.eventId,
    type: ctx.eventType,
    timestamp: ctx.timestamp,
    subject: payload.subject ?? {},
    context: payload.context ?? { tenantId: ctx.tenantId },
  };
}

async function handleTriggerEvent(deps: EventListenerDeps, payload: EventPayload, ctx: EventContext) {
  await deps.lifecycleService.executeDecisionLifecycle({
    triggerEvent: toEvent(payload, ctx),
    investorProfile: payload.subject ?? {},
    portfolioState: {},
    requestContext: pickRequestContext(ctx),
  });
  return skip();
}

function processComplianceCallback(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent {
  const subject = payload.subject;
  const tenantId = (subject?.tenantId as string) ?? ctx.tenantId;
  const dpId = subject?.decisionId as string;
  const authorityLevel = (subject?.authorityLevel as string) ?? 'L2';

  if (!dpId) {
    throw new Error('Missing decisionId in compliance callback event subject');
  }

  if (ctx.eventType === ComplianceEventTypes.DECISION_APPROVED) {
    if (authorityLevel === 'L1') {
      logger.info('Decision approved (L1 autonomous)', { dpId, tenantId });
      return update('DecisionPacket', {
        status: 'APPROVED',
        complianceResult: 'APPROVED',
        authorityLevel,
      }, { overrides: { pk: decisionPk(tenantId, dpId), sk: 'DecisionPacket' } });
    } else {
      logger.info('Decision requires user confirmation (L2)', { dpId, tenantId });
      return update('DecisionPacket', {
        status: 'AWAITING_CONFIRMATION',
        complianceResult: 'APPROVED',
        authorityLevel,
      }, { overrides: { pk: decisionPk(tenantId, dpId), sk: 'DecisionPacket' } });
    }
  } else {
    // DECISION_BLOCKED
    const blockReason = (subject?.reason as string) ?? 'Compliance check failed';
    logger.info('Decision blocked', { dpId, tenantId });
    return update('DecisionPacket', {
      status: 'BLOCKED',
      complianceResult: 'BLOCKED',
      blockReason,
    }, { overrides: { pk: decisionPk(tenantId, dpId), sk: 'DecisionPacket' } });
  }
}

function processUserResponse(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent {
  const subject = payload.subject;
  const tenantId = (subject?.tenantId as string) ?? ctx.tenantId;
  const dpId = subject?.decisionId as string;

  if (!dpId) {
    throw new Error('Missing decisionId in user response event subject');
  }

  if (ctx.eventType === AdvisoryBffEventTypes.USER_CONFIRMED) {
    logger.info('Decision confirmed by user', { dpId, tenantId });
    return update('DecisionPacket', {
      status: 'CONFIRMED',
      userDecision: 'CONFIRMED',
    }, { overrides: { pk: decisionPk(tenantId, dpId), sk: 'DecisionPacket' } });
  } else {
    // USER_REJECTED
    const rejectionReason = (subject?.reason as string) ?? 'User rejected decision';
    logger.info('Decision rejected by user', { dpId, tenantId, reason: rejectionReason });
    return update('DecisionPacket', {
      status: 'REJECTED',
      userDecision: 'REJECTED',
      rejectionReason,
    }, { overrides: { pk: decisionPk(tenantId, dpId), sk: 'DecisionPacket' } });
  }
}

const TRIGGER_EVENT_TYPES = [
  InvestorCrossDomainEventTypes.MANDATE_CREATED,
  InvestorCrossDomainEventTypes.GOAL_CREATED,
  InvestorCrossDomainEventTypes.GOAL_UPDATED,
  InvestorCrossDomainEventTypes.RISK_PROFILE_CREATED,
  InvestorCrossDomainEventTypes.RISK_PROFILE_UPDATED,
  InvestorCrossDomainEventTypes.OPERATING_MODE_CHANGED,
  LedgerCrossDomainEventTypes.PORTFOLIO_DRIFT_DETECTED,
  ExecutionCrossDomainEventTypes.ORDER_FILLED,
  ExecutionCrossDomainEventTypes.ORDER_REJECTED,
  ExecutionCrossDomainEventTypes.ORDER_CANCELLED,
  ExecutionCrossDomainEventTypes.DEPOSIT_DETECTED,
] as const;

const COMPLIANCE_EVENT_TYPES = [
  ComplianceEventTypes.DECISION_APPROVED,
  ComplianceEventTypes.DECISION_BLOCKED,
] as const;

const USER_RESPONSE_EVENT_TYPES = [
  AdvisoryBffEventTypes.USER_CONFIRMED,
  AdvisoryBffEventTypes.USER_REJECTED,
] as const;

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent> | WriteIntent> = {};

  for (const type of TRIGGER_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => handleTriggerEvent(deps, payload, ctx);
  }

  for (const type of COMPLIANCE_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => processComplianceCallback(payload, ctx);
  }

  for (const type of USER_RESPONSE_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => processUserResponse(payload, ctx);
  }

  return handlers;
};

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new DecisionRepository(TABLE_NAME, dynamoClient);
const lifecycleService = new DecisionLifecycleService(repository);

const deps: EventListenerDeps = {
  lifecycleService,
};

export const handler = materializeToTable({
  serviceName: 'advisory-ctrl',
  handlers: createHandlers(deps),
  errorEventType: AdvisoryCtrlEventTypes.ADVISORY_CTRL_FAILED,
});
