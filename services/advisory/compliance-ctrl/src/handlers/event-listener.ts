import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { materializeToTable, record, update, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv, NotRetryableError } from '@nestfolio/event-processor';
import { logger } from '@nestfolio/event-processor';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';

// Subject field carrying the SF taskToken across the compliance hop. Persisted
// onto the ComplianceCheck row so CDC re-emits it on DECISION_APPROVED |
// DECISION_BLOCKED, allowing decision-workflow-ctrl/sfn-callback.ts to call
// SendTaskSuccess. Without this, the SF execution remains stuck at
// WaitForCompliance.
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
  const taskToken = subject.taskToken as string | undefined;

  // Validate required fields
  const requiredFields = ['proposedTrades', 'portfolioValue', 'riskScore', 'currentPositions'];
  const missingFields = requiredFields.filter((f) => !(f in subject));
  if (missingFields.length) {
    throw new NotRetryableError(`Missing fields: ${missingFields.join(', ')}`);
  }

  if (!taskToken) {
    throw new NotRetryableError('Missing taskToken on RECOMMENDATION_PROPOSED subject — SF callback cannot resume');
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
      taskToken,
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
    // INVESTOR_PROFILE_* projection no longer writes revokedAt — that field
    // is owned exclusively by the MANDATE_REVOKED handler. Coerce undefined
    // (column never set) to null so MandateValidator's `revokedAt !== null`
    // gate doesn't false-positive on fresh-but-unrevoked rows.
    revokedAt: (mandateRecord.revokedAt as string | undefined) ?? null,
    status: mandateRecord.status as 'ACTIVE' | 'REVOKED' | undefined,
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
      taskToken,
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

function processInvestorProfileEvent(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent {
  const subject = payload.subject;
  const tenantId = (subject?.tenantId as string) ?? ctx.tenantId;
  const userId = (subject?.userId as string) ?? tenantId;
  const mandate = (subject?.mandate ?? {}) as Record<string, unknown>;
  const operatingMode = subject?.operatingMode as string | undefined;

  if (!mandate.mandateId || !mandate.level) {
    throw new NotRetryableError(
      `Missing required mandate fields in INVESTOR_PROFILE_* payload: mandateId=${mandate.mandateId}, level=${mandate.level}`,
    );
  }

  logger.info('MandateSnapshot projected from composite InvestorProfile event', {
    tenantId,
    userId,
    eventType: ctx.eventType,
    operatingMode,
  });

  // SET-style update preserves any prior status='REVOKED' written by
  // processMandateRevoked. ConditionExpression skips the write entirely when
  // the row is already REVOKED — protects against SQS at-least-once
  // redelivery of an INVESTOR_PROFILE_CREATED that arrives AFTER a
  // MANDATE_REVOKED for the same user. The runtime catches
  // ConditionalCheckFailedException as a no-op on event-processor's
  // executeUpdate path.
  return update(
    'MandateSnapshot',
    {
      tenantId,
      userId,
      mandateId: mandate.mandateId,
      level: mandate.level,
      monthlyTurnoverCapPercent: (mandate.monthlyTurnoverCapPercent as number) ?? 25,
      maxSingleTradePercent: (mandate.maxSingleTradePercent as number) ?? 10,
      equityRiskBandPercent: (mandate.equityRiskBandPercent as number) ?? 6,
      driftTriggerPercent: (mandate.driftTriggerPercent as number) ?? 4,
      singleEtfConcentrationPercent: (mandate.singleEtfConcentrationPercent as number) ?? 30,
      drawdownCircuitBreakerPercent: (mandate.drawdownCircuitBreakerPercent as number) ?? 12,
      effectiveDate: mandate.effectiveDate as string,
    },
    {
      condition: 'attribute_not_exists(#mandate_status) OR #mandate_status <> :revoked',
      conditionNames: { '#mandate_status': 'status' },
      conditionValues: { ':revoked': 'REVOKED' },
      overrides: { pk: guardrailPolicyPk(tenantId, userId), sk: 'MandateSnapshot' },
    },
  );
}

function processMandateRevoked(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const revokedAt = (subject.revokedAt as string) ?? new Date().toISOString();

  logger.info('Mandate revoked — gating MandateSnapshot.status=REVOKED', { tenantId, userId });

  // Patch only status + revokedAt via UpdateExpression — preserves all
  // mandate guardrail fields (mandateId, level, *Percent thresholds,
  // effectiveDate) projected from a prior INVESTOR_PROFILE_CREATED. The
  // previous PutItem-based projection wiped those fields, leaving the
  // RuleEngine to evaluate against an empty mandate snapshot.
  return update(
    'MandateSnapshot',
    {
      tenantId,
      userId,
      status: 'REVOKED',
      revokedAt,
    },
    { overrides: { pk: guardrailPolicyPk(tenantId, userId), sk: 'MandateSnapshot' } },
  );
}

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent | WriteIntent[]> | WriteIntent | WriteIntent[]> = {};

  // RECOMMENDATION_PROPOSED is emitted by decision-workflow-ctrl SF's
  // WaitForCompliance state with the taskToken, packet data, and an
  // awaitingCompliance=true flag. We are the sole consumer.
  handlers[DecisionWorkflowEventTypes.RECOMMENDATION_PROPOSED] = (payload, ctx) =>
    processDecisionPacket(deps, payload, ctx);

  // Composite InvestorProfile events carry mandate config in subject.mandate.*
  // and operating mode in subject.operatingMode. Replaces legacy
  // MANDATE_CREATED/UPDATED/OPERATING_MODE_CHANGED fan-out (Phase 3 of
  // InvestorProfile collapse).
  handlers[InvestorBffEventTypes.INVESTOR_PROFILE_CREATED] = (payload, ctx) =>
    processInvestorProfileEvent(payload, ctx);
  handlers[InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED] = (payload, ctx) =>
    processInvestorProfileEvent(payload, ctx);

  // MANDATE_REVOKED gates the rule engine via MandateSnapshot.status='REVOKED'.
  handlers[InvestorBffEventTypes.MANDATE_REVOKED] = (payload, ctx) =>
    processMandateRevoked(payload, ctx);

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
