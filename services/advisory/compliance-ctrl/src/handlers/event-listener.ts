import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, getUUID } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, extractTenantId, isRetryable, createServiceMetrics, MetricUnit, NotRetryableError, traceEvent, applyMiddleware, withLambdaContext, withTiming, publishErrorEvent, EventBridgeBus, type Bus } from '@nestfolio/lambda-utils';
import { ComplianceRepository } from '../repositories/compliance.repository';
import { RuleEngine, type ComplianceInput, type MandateSnapshot } from '../rules/rule-engine';
import { MandateValidator } from '../rules/mandate-validator';
import { GuardrailEvaluator } from '../rules/guardrail-evaluator';
import { SuitabilityChecker } from '../rules/suitability-checker';
import { AuthorityResolver } from '../rules/authority-resolver';

export interface EventListenerDeps {
  readonly repository: ComplianceRepository;
  readonly idempotencyGuard: IdempotencyGuard;
  readonly ruleEngine: RuleEngine;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
  readonly bus: Bus;
}

const DECISION_EVENT_TYPES = new Set([
  'DECISION_PACKET_CREATED',
  'DECISION_PACKET_ENRICHED',
]);

const MANDATE_EVENT_TYPES = new Set([
  'MANDATE_GRANTED',
  'MANDATE_UPDATED',
  'MANDATE_REVOKED',
  'OPERATING_MODE_CHANGED',
]);

const HANDLED_EVENT_TYPES = new Set([
  ...DECISION_EVENT_TYPES,
  ...MANDATE_EVENT_TYPES,
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

        if (!HANDLED_EVENT_TYPES.has(eventType)) {
          logger.warn('No handler for event type, skipping', { eventType });
          continue;
        }

        const isNew = await deps.idempotencyGuard.ensureOnce(eventType, uow.event.id);
        if (!isNew) {
          logger.info('Duplicate event, skipping', { eventId: uow.event.id });
          continue;
        }

        if (DECISION_EVENT_TYPES.has(eventType)) {
          const subject = uow.event.subject as Record<string, unknown>;
          const requiredFields = ['proposedTrades', 'portfolioValue', 'riskScore', 'currentPositions'];
          const missingFields = requiredFields.filter((f) => !(f in subject));
          if (missingFields.length) {
            throw new NotRetryableError(`Missing fields: ${missingFields.join(', ')}`);
          }
          await processDecisionPacket(deps, uow.event);
        } else if (MANDATE_EVENT_TYPES.has(eventType)) {
          await processMandateEvent(deps, uow.event, eventType);
        }

        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        logger.error('Failed to process record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        await publishErrorEvent(deps.bus, 'COMPLIANCE_CTRL_FAILED', error);
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

async function processDecisionPacket(
  deps: EventListenerDeps,
  event: Record<string, unknown>,
): Promise<void> {
  const subject = event.subject as Record<string, unknown>;
  const tenantId = extractTenantId(event);
  const userId = (subject.userId as string) ?? tenantId;
  const decisionPacketId = subject.decisionId as string;

  // Load mandate snapshot from DynamoDB
  const mandateRecord = await deps.repository.getMandateSnapshot(tenantId, userId);
  if (!mandateRecord) {
    logger.error('No mandate snapshot found for user', { tenantId, userId });
    // Create a compliance check with BLOCKED result for missing mandate
    const ccId = getUUID();
    await deps.repository.createComplianceCheck(tenantId, ccId, decisionPacketId, {
      mandateId: 'NONE',
      level: 'ADVISORY',
      monthlyTurnoverCapPercent: 0,
      maxSingleTradePercent: 0,
      effectiveDate: new Date().toISOString(),
      revokedAt: null,
    });
    await deps.repository.updateCheckResult(tenantId, ccId, 'BLOCKED', [
      { rule: 'MANDATE_MISSING', description: 'No mandate found for user', severity: 'BLOCKING' },
    ], 'L2');
    return;
  }

  const mandate: MandateSnapshot = {
    mandateId: mandateRecord.mandateId as string,
    level: mandateRecord.level as 'ADVISORY' | 'DISCRETIONARY',
    monthlyTurnoverCapPercent: mandateRecord.monthlyTurnoverCapPercent as number,
    maxSingleTradePercent: mandateRecord.maxSingleTradePercent as number,
    effectiveDate: mandateRecord.effectiveDate as string,
    revokedAt: mandateRecord.revokedAt as string | null,
  };

  const proposedTrades = (subject.proposedTrades as ComplianceInput['proposedTrades']) ?? [];
  const portfolioValue = (subject.portfolioValue as number) ?? 0;
  const riskScore = (subject.riskScore as number) ?? 5;
  const currentPositions = (subject.currentPositions as ComplianceInput['currentPositions']) ?? [];

  const ccId = getUUID();

  // Create compliance check record
  await deps.repository.createComplianceCheck(tenantId, ccId, decisionPacketId, mandate);

  // Run rule engine
  const complianceInput: ComplianceInput = {
    decisionPacketId,
    tenantId,
    userId,
    mandate,
    proposedTrades,
    portfolioValue,
    riskScore,
    currentPositions,
  };

  const output = deps.ruleEngine.evaluate(complianceInput);

  // Persist result
  await deps.repository.updateCheckResult(
    tenantId,
    ccId,
    output.result,
    output.violations,
    output.authorityLevel,
  );

  // Create audit artifact
  const artifactId = getUUID();
  await deps.repository.createAuditArtifact(tenantId, ccId, artifactId, {
    decisionPacketId,
    input: complianceInput,
    output,
    evaluatedAt: new Date().toISOString(),
  });

  logger.info('Compliance check completed', {
    ccId,
    decisionPacketId,
    result: output.result,
    authorityLevel: output.authorityLevel,
    violationCount: output.violations.length,
  });
}

async function processMandateEvent(
  deps: EventListenerDeps,
  event: Record<string, unknown>,
  eventType: string,
): Promise<void> {
  const subject = event.subject as Record<string, unknown>;
  const context = event.context as Record<string, unknown>;
  const tenantId = ((context?.tenantId ?? subject?.tenantId) as string);
  const userId = ((subject?.userId ?? tenantId) as string);

  switch (eventType) {
    case 'MANDATE_GRANTED':
    case 'MANDATE_UPDATED':
      if (!subject.mandateId || !subject.level) {
        throw new NotRetryableError(`Missing required mandate fields: mandateId=${subject.mandateId}, level=${subject.level}`);
      }
      await deps.repository.putMandateSnapshot(tenantId, userId, {
        mandateId: subject.mandateId,
        level: subject.level,
        monthlyTurnoverCapPercent: subject.monthlyTurnoverCapPercent,
        maxSingleTradePercent: subject.maxSingleTradePercent,
        effectiveDate: subject.effectiveDate,
        revokedAt: null,
      });
      logger.info('Mandate snapshot created/updated', { tenantId, userId, eventType });
      break;

    case 'MANDATE_REVOKED':
      await deps.repository.putMandateSnapshot(tenantId, userId, {
        mandateId: subject.mandateId,
        level: subject.level ?? 'ADVISORY',
        monthlyTurnoverCapPercent: subject.monthlyTurnoverCapPercent ?? 0,
        maxSingleTradePercent: subject.maxSingleTradePercent ?? 0,
        effectiveDate: subject.effectiveDate ?? new Date().toISOString(),
        revokedAt: subject.revokedAt ?? new Date().toISOString(),
      });
      logger.info('Mandate snapshot revoked', { tenantId, userId });
      break;

    case 'OPERATING_MODE_CHANGED':
      logger.info('Operating mode changed, noted', { tenantId, userId, mode: subject.mode });
      break;

    default:
      logger.info('No handler for mandate event type, skipping', { eventType });
  }
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new ComplianceRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const ruleEngine = new RuleEngine(
  new MandateValidator(),
  new GuardrailEvaluator(),
  new SuitabilityChecker(),
  new AuthorityResolver(),
);

const deps: EventListenerDeps = {
  repository,
  idempotencyGuard,
  ruleEngine,
  metrics: createServiceMetrics('compliance-ctrl'),
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'compliance-ctrl'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('compliance-ctrl-event-listener'),
);
