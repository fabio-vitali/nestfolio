import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { logger } from '@nestfolio/event-processor';
import { DecisionRepository } from '../repositories/decision.repository';
import { DecisionLifecycleService } from '../services/decision-lifecycle.service';

export interface EventListenerDeps {
  readonly lifecycleService: DecisionLifecycleService;
  readonly repository: DecisionRepository;
}

function toEvent(payload: EventPayload, ctx: EventContext): Record<string, unknown> {
  return {
    id: ctx.eventId,
    type: ctx.eventType,
    timestamp: ctx.timestamp,
    subject: payload.subject,
    context: payload.context ?? { tenantId: ctx.tenantId },
  };
}

async function handleTriggerEvent(deps: EventListenerDeps, payload: EventPayload, ctx: EventContext) {
  await deps.lifecycleService.executeDecisionLifecycle({
    tenantId: ctx.tenantId,
    triggerEvent: toEvent(payload, ctx),
    investorProfile: payload.subject ?? {},
    portfolioState: {},
  });
  return skip();
}

async function processComplianceCallback(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = payload.subject;
  const tenantId = (subject?.tenantId as string) ?? ctx.tenantId;
  const dpId = subject?.decisionId as string;
  const authorityLevel = (subject?.authorityLevel as string) ?? 'L2';

  if (ctx.eventType === 'DECISION_APPROVED') {
    if (!dpId) {
      throw new Error('Missing decisionId in compliance callback event subject');
    }
    if (authorityLevel === 'L1') {
      await deps.repository.updateDecisionStatus(tenantId, dpId, 'APPROVED', {
        authorityLevel,
        approvedAt: new Date().toISOString(),
      });
      logger.info('Decision approved (L1 autonomous)', { dpId, tenantId });
    } else {
      await deps.repository.updateDecisionStatus(tenantId, dpId, 'AWAITING_CONFIRMATION', {
        authorityLevel,
        confirmationRequired: true,
      });
      logger.info('Decision requires user confirmation (L2)', { dpId, tenantId });
    }
  } else if (ctx.eventType === 'DECISION_BLOCKED') {
    if (!dpId) {
      throw new Error('Missing decisionId in compliance callback event subject');
    }
    await deps.repository.updateDecisionStatus(tenantId, dpId, 'BLOCKED', {
      blockedAt: new Date().toISOString(),
      blockReason: (subject?.reason as string) ?? 'Compliance check failed',
    });
    logger.info('Decision blocked', { dpId, tenantId });
  }

  return skip();
}

async function processUserResponse(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = payload.subject;
  const tenantId = (subject?.tenantId as string) ?? ctx.tenantId;
  const dpId = subject?.decisionId as string;

  if (ctx.eventType === 'USER_CONFIRMED') {
    if (!dpId) {
      throw new Error('Missing decisionId in user response event subject');
    }
    await deps.repository.updateDecisionStatus(tenantId, dpId, 'CONFIRMED', {
      confirmedAt: new Date().toISOString(),
    });
    logger.info('Decision confirmed by user', { dpId, tenantId });
  } else if (ctx.eventType === 'USER_REJECTED') {
    if (!dpId) {
      throw new Error('Missing decisionId in user response event subject');
    }
    const reason = (subject?.reason as string) ?? 'User rejected decision';
    await deps.repository.updateDecisionStatus(tenantId, dpId, 'REJECTED', {
      rejectedAt: new Date().toISOString(),
      rejectionReason: reason,
    });
    logger.info('Decision rejected by user', { dpId, tenantId, reason });
  }

  return skip();
}

const TRIGGER_EVENT_TYPES = [
  'MANDATE_GRANTED',
  'GOAL_UPDATED',
  'RISK_PROFILE_UPDATED',
  'OPERATING_MODE_CHANGED',
  'PORTFOLIO_DRIFT_DETECTED',
  'ORDER_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
] as const;

const COMPLIANCE_EVENT_TYPES = [
  'DECISION_APPROVED',
  'DECISION_BLOCKED',
] as const;

const USER_RESPONSE_EVENT_TYPES = [
  'USER_CONFIRMED',
  'USER_REJECTED',
] as const;

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  for (const type of TRIGGER_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => handleTriggerEvent(deps, payload, ctx);
  }

  for (const type of COMPLIANCE_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => processComplianceCallback(deps, payload, ctx);
  }

  for (const type of USER_RESPONSE_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => processUserResponse(deps, payload, ctx);
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
  repository,
};

export const handler = createEventHandler({
  serviceName: 'advisory-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'ADVISORY_CTRL_FAILED',
});
