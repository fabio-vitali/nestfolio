import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { materializeToTable, record, projectVersioned, skip, parseSubject, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { logger } from '@nestfolio/event-processor';
import '../read-model-ownership';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { RecommendationProposedSchema } from '@nestfolio/decision-workflow-ctrl/contracts';
import { InvestorCrossDomainEventTypes, MandateSchema } from '@nestfolio/investor-adpt/domain';
import type { ComplianceCheck } from '../domain/contracts';
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
  // parseSubject validates the RECOMMENDATION_PROPOSED event against the producer's own
  // zod contract. A ZodError here means the producer emitted a shape mismatch — the
  // event-processor's poison-pill path catches it and routes to the DLQ.
  // tenantId + userId are identity (RequestContext) and are NOT on the schema; read from ctx.
  const subject = parseSubject(payload, RecommendationProposedSchema);
  const tenantId = ctx.tenantId;
  const userId = ctx.userId ?? tenantId;
  const decisionPacketId = subject.decisionId;
  const taskToken = subject.taskToken;

  const ccId = ctx.eventId;

  // Load mandate snapshot from DynamoDB (read-only — repository kept for reads)
  const mandateRecord = await deps.repository.getMandateSnapshot(tenantId, userId);
  if (!mandateRecord) {
    logger.error('No mandate snapshot found for user', { tenantId, userId });
    const fallbackSubject: ComplianceCheck = {
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
      // WS-1: carry proposedTrades on the fallback BLOCKED path too (it is on the
      // inbound subject), so EVERY ComplianceCheck emission carries it — the
      // happy path is not the only producer of DECISION_BLOCKED.
      proposedTrades: subject.proposedTrades,
      sourceEventId: ctx.eventId,
    };
    return record('ComplianceCheck', { tenantId, ...fallbackSubject }, { pk: complianceCheckPk(tenantId, ccId), sk: 'ComplianceCheck' });
  }

  const mandate: MandateSnapshot = {
    level: mandateRecord.level as 'ADVISORY' | 'DISCRETIONARY',
    status: (mandateRecord.status as 'ACTIVE' | 'REVOKED' | undefined) ?? 'ACTIVE',
    operatingMode: mandateRecord.operatingMode as MandateSnapshot['operatingMode'],
    effectiveDate: mandateRecord.effectiveDate as string,
  };

  const proposedTrades = subject.proposedTrades as ComplianceInput['proposedTrades'];
  const portfolioValueCents = subject.portfolioValueCents;
  const riskCategory = (subject.riskCategory as ComplianceInput['riskCategory']) ?? 'MODERATE';
  const isInitialBuild = subject.isInitialBuild ?? false;
  const currentPositions = subject.currentPositions as ComplianceInput['currentPositions'];

  const complianceInput: ComplianceInput = {
    decisionPacketId,
    tenantId,
    userId,
    mandate,
    proposedTrades,
    portfolioValueCents,
    riskCategory,
    isInitialBuild,
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

  const happySubject: ComplianceCheck = {
    ccId,
    decisionPacketId,
    // Dual-field: see fallback-path note above. CDC must carry
    // `decisionId` on subject so advisory-bff can address the
    // DecisionReadModel pk; existing consumers keep reading
    // `decisionPacketId`.
    decisionId: decisionPacketId,
    taskToken: taskToken!,
    mandateSnapshot: mandate,
    status: 'COMPLETED',
    result: output.result,
    violations: output.violations,
    authorityLevel: output.authorityLevel,
    proposedTrades,
    sourceEventId: ctx.eventId,
  };

  return [
    record('ComplianceCheck', { tenantId, ...happySubject }, { pk: complianceCheckPk(tenantId, ccId), sk: 'ComplianceCheck' }),
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

function projectMandateSnapshot(payload: EventPayload, ctx: EventContext): WriteIntent {
  // parseSubject validates the Mandate event against the producer's own MandateSchema
  // (investor-bff emits MandateSchema.parse(row) for all four mandate events). A contract
  // violation throws ZodError → poison-pill/DLQ, subsuming the old hand-rolled
  // NotRetryableError guard for a missing operatingMode.
  const subject = parseSubject(payload, MandateSchema);
  // Identity is DRY — read tenantId/userId from the event context, not the subject.
  const tenantId = ctx.tenantId;
  const userId = ctx.userId ?? tenantId;

  const version = subject.__version;
  if (typeof version !== 'number') {
    logger.warn('Mandate event missing __version — skipping MandateSnapshot projection', {
      tenantId, userId, eventType: ctx.eventType,
    });
    return skip();
  }

  // Full-row P1 projection on the Mandate version line. Every Mandate event now
  // carries the full image + Mandate __version, so one projector writes the whole
  // row; the version guard subsumes the old REVOKED-skip idempotency.
  logger.info('MandateSnapshot projected', { tenantId, userId, version, eventType: ctx.eventType });
  return projectVersioned(
    'MandateSnapshot',
    {
      tenantId,
      userId,
      mandateId: subject.mandateId,
      level: subject.level,
      status: subject.status,
      operatingMode: subject.operatingMode,
      effectiveDate: subject.effectiveDate,
      revokedAt: subject.revokedAt ?? null,
    },
    { version, overrides: { pk: guardrailPolicyPk(tenantId, userId), sk: 'MandateSnapshot' } },
  );
}

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent | WriteIntent[]> | WriteIntent | WriteIntent[]> = {};

  // RECOMMENDATION_PROPOSED is emitted by decision-workflow-ctrl SF's
  // WaitForCompliance state with the taskToken, packet data, and an
  // awaitingCompliance=true flag. We are the sole consumer.
  handlers[DecisionWorkflowEventTypes.RECOMMENDATION_PROPOSED] = (payload, ctx) =>
    processDecisionPacket(deps, payload, ctx);

  // Single full-row P1 projector: every Mandate event (ISSUED / OPERATING_MODE_CHANGED /
  // REVOKED) now carries the full Mandate image + __version. projectMandateSnapshot
  // writes a version-guarded upsert; the __version guard subsumes the old
  // REVOKED-skip conditional idempotency.
  handlers[InvestorCrossDomainEventTypes.MANDATE_ISSUED] = (payload, ctx) =>
    projectMandateSnapshot(payload, ctx);
  handlers[InvestorCrossDomainEventTypes.OPERATING_MODE_CHANGED] = (payload, ctx) =>
    projectMandateSnapshot(payload, ctx);
  handlers[InvestorCrossDomainEventTypes.MANDATE_REVOKED] = (payload, ctx) =>
    projectMandateSnapshot(payload, ctx);
  handlers[InvestorCrossDomainEventTypes.MANDATE_REAFFIRMED] = (payload, ctx) =>
    projectMandateSnapshot(payload, ctx);

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
