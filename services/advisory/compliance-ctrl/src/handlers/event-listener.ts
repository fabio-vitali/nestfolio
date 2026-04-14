import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { materializeToTable, skip, record, project, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv, NotRetryableError } from '@nestfolio/event-processor';
import { logger } from '@nestfolio/event-processor';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
import { ComplianceRepository } from '../repositories/compliance.repository';
import { RuleEngine, type ComplianceInput, type MandateSnapshot } from '../rules/rule-engine';
import { MandateValidator } from '../rules/mandate-validator';
import { GuardrailEvaluator } from '../rules/guardrail-evaluator';
import { SuitabilityChecker } from '../rules/suitability-checker';
import { AuthorityResolver } from '../rules/authority-resolver';

export interface EventListenerDeps {
  readonly repository: {
    getMandateSnapshot: (tenantId: string, userId: string) => Promise<Record<string, unknown> | null>;
  };
  readonly ruleEngine: RuleEngine;
}

function complianceCheckPk(tenantId: string, ccId: string): string {
  return `ComplianceCheck#${tenantId}#${ccId}`;
}

function guardrailPolicyPk(tenantId: string, userId: string): string {
  return `GuardrailPolicy#${tenantId}#${userId}`;
}

async function processDecisionPacket(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
): Promise<WriteIntent | WriteIntent[]> {
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

  const ccId = ctx.eventId;

  // Load mandate snapshot from DynamoDB (read-only — repository kept for reads)
  const mandateRecord = await deps.repository.getMandateSnapshot(tenantId, userId);
  if (!mandateRecord) {
    logger.error('No mandate snapshot found for user', { tenantId, userId });
    return record('ComplianceCheck', {
      tenantId,
      ccId,
      decisionPacketId,
      mandateSnapshot: {
        mandateId: 'NONE',
        level: 'ADVISORY',
        monthlyTurnoverCapPercent: 0,
        maxSingleTradePercent: 0,
        equityRiskBandPercent: 0,
        driftTriggerPercent: 0,
        singleEtfConcentrationPercent: 0,
        drawdownCircuitBreakerPercent: 0,
        effectiveDate: new Date().toISOString(),
        revokedAt: null,
      },
      status: 'BLOCKED',
      result: 'BLOCKED',
      violations: [{ rule: 'MANDATE_MISSING', description: 'No mandate found for user', severity: 'BLOCKING' }],
      authorityLevel: 'L2',
      sourceEventId: ctx.eventId,
    }, { pk: complianceCheckPk(tenantId, ccId), sk: 'ComplianceCheck' });
  }

  const mandate: MandateSnapshot = {
    mandateId: mandateRecord.mandateId as string,
    level: mandateRecord.level as 'ADVISORY' | 'DISCRETIONARY',
    monthlyTurnoverCapPercent: (mandateRecord.monthlyTurnoverCapPercent as number) ?? 25,
    maxSingleTradePercent: (mandateRecord.maxSingleTradePercent as number) ?? 10,
    equityRiskBandPercent: (mandateRecord.equityRiskBandPercent as number) ?? 6,
    driftTriggerPercent: (mandateRecord.driftTriggerPercent as number) ?? 4,
    singleEtfConcentrationPercent: (mandateRecord.singleEtfConcentrationPercent as number) ?? 30,
    drawdownCircuitBreakerPercent: (mandateRecord.drawdownCircuitBreakerPercent as number) ?? 12,
    effectiveDate: mandateRecord.effectiveDate as string,
    revokedAt: mandateRecord.revokedAt as string | null,
  };

  const proposedTrades = (subject.proposedTrades as ComplianceInput['proposedTrades']) ?? [];
  const portfolioValue = (subject.portfolioValue as number) ?? 0;
  const riskScore = (subject.riskScore as number) ?? 5;
  const currentPositions = (subject.currentPositions as ComplianceInput['currentPositions']) ?? [];

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

  const artifactId = ctx.eventId + '-audit';

  logger.info('Compliance check completed', {
    ccId,
    decisionPacketId,
    result: output.result,
    authorityLevel: output.authorityLevel,
    violationCount: output.violations.length,
  });

  return [
    record('ComplianceCheck', {
      tenantId,
      ccId,
      decisionPacketId,
      mandateSnapshot: mandate,
      status: 'COMPLETED',
      result: output.result,
      violations: output.violations,
      authorityLevel: output.authorityLevel,
      sourceEventId: ctx.eventId,
    }, { pk: complianceCheckPk(tenantId, ccId), sk: 'ComplianceCheck' }),
    record('AuditArtifact', {
      tenantId,
      ccId,
      artifactId,
      decisionPacketId,
      input: complianceInput,
      output,
      evaluatedAt: new Date().toISOString(),
      sourceEventId: ctx.eventId,
    }, { pk: complianceCheckPk(tenantId, ccId), sk: `AuditArtifact#${artifactId}` }),
  ];
}

function processMandateEvent(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent {
  const subject = payload.subject;
  const context = payload.context ?? {};
  const tenantId = ((context.tenantId ?? subject?.tenantId) as string) ?? ctx.tenantId;
  const userId = ((subject?.userId ?? tenantId) as string);

  switch (ctx.eventType) {
    case 'MANDATE_CREATED':
    case 'MANDATE_UPDATED':
      if (!subject.mandateId || !subject.level) {
        throw new NotRetryableError(`Missing required mandate fields: mandateId=${subject.mandateId}, level=${subject.level}`);
      }
      logger.info('Mandate snapshot created/updated', { tenantId, userId, eventType: ctx.eventType });
      return project('MandateSnapshot', {
        tenantId,
        userId,
        mandateId: subject.mandateId,
        level: subject.level,
        monthlyTurnoverCapPercent: subject.monthlyTurnoverCapPercent ?? 25,
        maxSingleTradePercent: subject.maxSingleTradePercent ?? 10,
        equityRiskBandPercent: subject.equityRiskBandPercent ?? 6,
        driftTriggerPercent: subject.driftTriggerPercent ?? 4,
        singleEtfConcentrationPercent: subject.singleEtfConcentrationPercent ?? 30,
        drawdownCircuitBreakerPercent: subject.drawdownCircuitBreakerPercent ?? 12,
        effectiveDate: subject.effectiveDate,
        revokedAt: (subject.revokedAt as string) ?? null,
      }, { pk: guardrailPolicyPk(tenantId, userId), sk: 'MandateSnapshot' });

    case 'OPERATING_MODE_CHANGED':
      logger.info('Operating mode changed, noted', { tenantId, userId, mode: subject.mode });
      return skip();

    default:
      logger.info('No handler for mandate event type, skipping', { eventType: ctx.eventType });
      return skip();
  }
}

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent | WriteIntent[]> | WriteIntent | WriteIntent[]> = {};

  // Decision events
  for (const type of [AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED, AdvisoryCtrlEventTypes.DECISION_PACKET_UPDATED]) {
    handlers[type] = (payload, ctx) => processDecisionPacket(deps, payload, ctx);
  }

  // Mandate events
  for (const type of [InvestorCrossDomainEventTypes.MANDATE_CREATED, InvestorCrossDomainEventTypes.MANDATE_UPDATED, InvestorCrossDomainEventTypes.OPERATING_MODE_CHANGED]) {
    handlers[type] = (payload, ctx) => processMandateEvent(payload, ctx);
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

export const handler = materializeToTable({
  serviceName: 'compliance-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'COMPLIANCE_CTRL_FAILED',
});
