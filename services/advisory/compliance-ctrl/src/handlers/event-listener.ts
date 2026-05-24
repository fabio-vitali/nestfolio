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
      // Dual-field: CDC carries this on subject so advisory-bff's
      // decision-status-changed transform (which reads `decisionId`)
      // can address the DecisionReadModel pk correctly. The
      // `decisionPacketId` field stays for execution-ctrl / ledger-ctrl
      // consumers that already key on that name.
      decisionId: decisionPacketId,
      taskToken,
      mandateSnapshot: {
        level: 'ADVISORY',
        status: 'ACTIVE',
        operatingMode: 'CONSERVATIVE',
        effectiveDate: new Date().toISOString(),
      },
      status: 'BLOCKED',
      result: 'BLOCKED',
      violations: [{ rule: 'MANDATE_MISSING', description: 'No mandate found for user', severity: 'BLOCKING' }],
      authorityLevel: 'L2',
      sourceEventId: ctx.eventId,
    }, { pk: complianceCheckPk(tenantId, ccId), sk: 'ComplianceCheck' });
  }

  const mandate: MandateSnapshot = {
    level: mandateRecord.level as 'ADVISORY' | 'DISCRETIONARY',
    status: (mandateRecord.status as 'ACTIVE' | 'REVOKED' | undefined) ?? 'ACTIVE',
    operatingMode: mandateRecord.operatingMode as MandateSnapshot['operatingMode'],
    effectiveDate: mandateRecord.effectiveDate as string,
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
      // Dual-field: see fallback-path note above. CDC must carry
      // `decisionId` on subject so advisory-bff can address the
      // DecisionReadModel pk; existing consumers keep reading
      // `decisionPacketId`.
      decisionId: decisionPacketId,
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

function processMandateIssued(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const mandateId = subject.mandateId as string;
  const level = subject.level as MandateSnapshot['level'];
  const operatingMode = subject.operatingMode as MandateSnapshot['operatingMode'];
  const effectiveDate = subject.effectiveDate as string;

  if (!mandateId || !level || !operatingMode) {
    throw new NotRetryableError(
      `MANDATE_ISSUED missing required fields: mandateId=${mandateId} level=${level} operatingMode=${operatingMode}`,
    );
  }

  logger.info('MandateSnapshot projected from MANDATE_ISSUED', { tenantId, userId, mandateId, level, operatingMode });

  // SET-style update skips when already REVOKED — protects against SQS at-least-once
  // redelivery of MANDATE_ISSUED arriving after MANDATE_REVOKED.
  return update(
    'MandateSnapshot',
    { tenantId, userId, mandateId, level, status: 'ACTIVE', operatingMode, effectiveDate },
    {
      condition: 'attribute_not_exists(#mandate_status) OR #mandate_status <> :revoked',
      conditionNames: { '#mandate_status': 'status' },
      conditionValues: { ':revoked': 'REVOKED' },
      overrides: { pk: guardrailPolicyPk(tenantId, userId), sk: 'MandateSnapshot' },
    },
  );
}

function processOperatingModeChanged(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const operatingMode = subject.operatingMode as MandateSnapshot['operatingMode'];

  if (!operatingMode) {
    throw new NotRetryableError(`OPERATING_MODE_CHANGED missing operatingMode`);
  }

  logger.info('MandateSnapshot.operatingMode updated from OPERATING_MODE_CHANGED', { tenantId, userId, operatingMode });

  // Patch only operatingMode — status/level are untouched. Skips if row is REVOKED.
  return update(
    'MandateSnapshot',
    { tenantId, userId, operatingMode },
    {
      condition: 'attribute_exists(pk) AND #mandate_status <> :revoked',
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

  // Semantic mandate events replace the old carrier INVESTOR_PROFILE_CREATED/UPDATED fan-out.
  // MANDATE_ISSUED: project a fresh MandateSnapshot (operatingMode denormalized at issue time).
  // OPERATING_MODE_CHANGED: patch only operatingMode on the existing snapshot.
  // MANDATE_REVOKED: gate the rule engine via MandateSnapshot.status='REVOKED'.
  handlers[InvestorBffEventTypes.MANDATE_ISSUED] = (payload, ctx) =>
    processMandateIssued(payload, ctx);
  handlers[InvestorBffEventTypes.OPERATING_MODE_CHANGED] = (payload, ctx) =>
    processOperatingModeChanged(payload, ctx);
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
