import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, extractTenantId, isRetryable, createServiceMetrics, MetricUnit, traceEvent, applyMiddleware, withLambdaContext, withTiming, publishErrorEvent, EventBridgeBus, type Bus } from '@nestfolio/lambda-utils';
import { DecisionRepository } from '../repositories/decision.repository';
import { DecisionLifecycleService } from '../services/decision-lifecycle.service';

export interface EventListenerDeps {
  readonly idempotencyGuard: IdempotencyGuard;
  readonly lifecycleService: DecisionLifecycleService;
  readonly repository: DecisionRepository;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
  readonly bus: Bus;
}

const TRIGGER_EVENT_TYPES = new Set([
  'MANDATE_GRANTED',
  'GOAL_UPDATED',
  'RISK_PROFILE_UPDATED',
  'OPERATING_MODE_CHANGED',
  'PORTFOLIO_DRIFT_DETECTED',
  'ORDER_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
]);

const COMPLIANCE_EVENT_TYPES = new Set([
  'DECISION_APPROVED',
  'DECISION_BLOCKED',
]);

const USER_RESPONSE_EVENT_TYPES = new Set([
  'USER_CONFIRMED',
  'USER_REJECTED',
]);

const EVENT_TYPES = new Set([
  ...TRIGGER_EVENT_TYPES,
  ...COMPLIANCE_EVENT_TYPES,
  ...USER_RESPONSE_EVENT_TYPES,
]);

export const createHandler = (deps: EventListenerDeps) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: string[] = [];

    for (const record of event.Records) {
      try {
        const uow = parseRecord(record);
        const eventType = uow.event.type;

        logger.info('Processing event', { eventType, eventId: uow.event.id });
        traceEvent(eventType, uow.event.id);

        if (!EVENT_TYPES.has(eventType)) {
          logger.warn('No handler for event type, skipping', { eventType });
          continue;
        }

        const isNew = await deps.idempotencyGuard.ensureOnce(eventType, uow.event.id);
        if (!isNew) {
          logger.info('Duplicate event, skipping', { eventType, eventId: uow.event.id });
          continue;
        }

        if (TRIGGER_EVENT_TYPES.has(eventType)) {
          const tenantId = extractTenantId(uow.event as unknown as Record<string, unknown>);
          await deps.lifecycleService.executeDecisionLifecycle({
            tenantId,
            triggerEvent: uow.event,
            investorProfile: (uow.event.subject as Record<string, unknown>) ?? {},
            portfolioState: {},
          });
        } else if (COMPLIANCE_EVENT_TYPES.has(eventType)) {
          await processComplianceCallback(deps, uow.event, eventType);
        } else if (USER_RESPONSE_EVENT_TYPES.has(eventType)) {
          await processUserResponse(deps, uow.event, eventType);
        }

        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        logger.error('Failed to process record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        await publishErrorEvent(deps.bus, 'ADVISORY_CTRL_FAILED', error);
        deps.metrics.addMetric('EventFailed', MetricUnit.Count, 1);
        if (isRetryable(error)) {
          failures.push(record.messageId);
        }
      }
    }

    deps.metrics.publishStoredMetrics();

    return {
      batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
    };
  };

async function processComplianceCallback(
  deps: EventListenerDeps,
  event: Record<string, unknown>,
  eventType: string,
): Promise<void> {
  const subject = event.subject as Record<string, unknown>;
  const tenantId = (subject?.tenantId as string) ?? 'unknown';
  const dpId = subject?.decisionId as string;
  const authorityLevel = (subject?.authorityLevel as string) ?? 'L2';

  if (eventType === 'DECISION_APPROVED') {
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
  } else if (eventType === 'DECISION_BLOCKED') {
    if (!dpId) {
      throw new Error('Missing decisionId in compliance callback event subject');
    }
    await deps.repository.updateDecisionStatus(tenantId, dpId, 'BLOCKED', {
      blockedAt: new Date().toISOString(),
      blockReason: (subject?.reason as string) ?? 'Compliance check failed',
    });
    logger.info('Decision blocked', { dpId, tenantId });
  }
}

async function processUserResponse(
  deps: EventListenerDeps,
  event: Record<string, unknown>,
  eventType: string,
): Promise<void> {
  const subject = event.subject as Record<string, unknown>;
  const tenantId = (subject?.tenantId as string) ?? 'unknown';
  const dpId = subject?.decisionId as string;

  if (eventType === 'USER_CONFIRMED') {
    if (!dpId) {
      throw new Error('Missing decisionId in user response event subject');
    }
    await deps.repository.updateDecisionStatus(tenantId, dpId, 'CONFIRMED', {
      confirmedAt: new Date().toISOString(),
    });
    logger.info('Decision confirmed by user', { dpId, tenantId });
  } else if (eventType === 'USER_REJECTED') {
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
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new DecisionRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);
const lifecycleService = new DecisionLifecycleService(repository);

const deps: EventListenerDeps = {
  idempotencyGuard,
  lifecycleService,
  repository,
  metrics: createServiceMetrics('advisory-ctrl'),
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'advisory-ctrl'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('advisory-ctrl-event-listener'),
);
