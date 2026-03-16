import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv, NotRetryableError } from '@nestfolio/event-processor';
import { logger } from '@nestfolio/event-processor';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/domain';
import { ComplianceRepository } from '../repositories/compliance.repository';
import { RuleEngine, type ComplianceInput, type MandateSnapshot } from '../rules/rule-engine';
import { MandateValidator } from '../rules/mandate-validator';
import { GuardrailEvaluator } from '../rules/guardrail-evaluator';
import { SuitabilityChecker } from '../rules/suitability-checker';
import { AuthorityResolver } from '../rules/authority-resolver';

export interface EventListenerDeps {
  readonly repository: ComplianceRepository;
  readonly ruleEngine: RuleEngine;
}

async function processDecisionPacket(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = payload.subject;
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const decisionPacketId = subject.decisionId as string;

  // Validate required fields
  const requiredFields = ['proposedTrades', 'portfolioValue', 'riskScore', 'currentPositions'];
  const missingFields = requiredFields.filter((f) => !(f in subject));
  if (missingFields.length) {
    throw new NotRetryableError(`Missing fields: ${missingFields.join(', ')}`);
  }

  // Load mandate snapshot from DynamoDB
  const mandateRecord = await deps.repository.getMandateSnapshot(tenantId, userId);
  if (!mandateRecord) {
    logger.error('No mandate snapshot found for user', { tenantId, userId });
    // Create a compliance check with BLOCKED result for missing mandate
    const ccId = ctx.eventId;
    const created = await deps.repository.createComplianceCheck(tenantId, ccId, decisionPacketId, {
      mandateId: 'NONE',
      level: 'ADVISORY',
      monthlyTurnoverCapPercent: 0,
      maxSingleTradePercent: 0,
      effectiveDate: new Date().toISOString(),
      revokedAt: null,
    }, ctx.eventId);
    if (!created) {
      logger.info('Duplicate event, skipping', { eventId: ctx.eventId });
      return skip();
    }
    await deps.repository.updateCheckResult(tenantId, ccId, 'BLOCKED', [
      { rule: 'MANDATE_MISSING', description: 'No mandate found for user', severity: 'BLOCKING' },
    ], 'L2');
    return skip();
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

  const ccId = ctx.eventId;

  // Create compliance check record (idempotent — returns false if already exists)
  const created = await deps.repository.createComplianceCheck(tenantId, ccId, decisionPacketId, mandate, ctx.eventId);
  if (!created) {
    logger.info('Duplicate event, skipping', { eventId: ctx.eventId });
    return skip();
  }

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
  const artifactId = ctx.eventId + '-audit';
  await deps.repository.createAuditArtifact(tenantId, ccId, artifactId, {
    decisionPacketId,
    input: complianceInput,
    output,
    evaluatedAt: new Date().toISOString(),
    sourceEventId: ctx.eventId,
  });

  logger.info('Compliance check completed', {
    ccId,
    decisionPacketId,
    result: output.result,
    authorityLevel: output.authorityLevel,
    violationCount: output.violations.length,
  });

  return skip();
}

async function processMandateEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = payload.subject;
  const context = payload.context ?? {};
  const tenantId = ((context.tenantId ?? subject?.tenantId) as string) ?? ctx.tenantId;
  const userId = ((subject?.userId ?? tenantId) as string);

  switch (ctx.eventType) {
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
      logger.info('Mandate snapshot created/updated', { tenantId, userId, eventType: ctx.eventType });
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
      logger.info('No handler for mandate event type, skipping', { eventType: ctx.eventType });
  }

  return skip();
}

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  // Decision events
  for (const type of [AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED, AdvisoryCtrlEventTypes.DECISION_PACKET_ENRICHED]) {
    handlers[type] = (payload, ctx) => processDecisionPacket(deps, payload, ctx);
  }

  // Mandate events
  for (const type of [InvestorBffEventTypes.MANDATE_GRANTED, InvestorBffEventTypes.MANDATE_UPDATED, InvestorBffEventTypes.MANDATE_REVOKED, InvestorBffEventTypes.OPERATING_MODE_CHANGED]) {
    handlers[type] = (payload, ctx) => processMandateEvent(deps, payload, ctx);
  }

  return handlers;
};

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new ComplianceRepository(TABLE_NAME, dynamoClient);

const ruleEngine = new RuleEngine(
  new MandateValidator(),
  new GuardrailEvaluator(),
  new SuitabilityChecker(),
  new AuthorityResolver(),
);

const deps: EventListenerDeps = {
  repository,
  ruleEngine,
};

export const handler = createEventHandler({
  serviceName: 'compliance-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'COMPLIANCE_CTRL_FAILED',
});
