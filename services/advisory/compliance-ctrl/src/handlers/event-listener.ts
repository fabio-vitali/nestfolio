import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, getUUID } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard } from '@nestfolio/lambda-utils';
import { ComplianceRepository } from '../repositories/compliance.repository';
import { RuleEngine, type ComplianceInput, type MandateSnapshot } from '../rules/rule-engine';
import { MandateValidator } from '../rules/mandate-validator';
import { GuardrailEvaluator } from '../rules/guardrail-evaluator';
import { SuitabilityChecker } from '../rules/suitability-checker';
import { AuthorityResolver } from '../rules/authority-resolver';

const TABLE_NAME = process.env.TABLE_NAME!;
const dynamoClient = new DynamoDBClient({});
const repository = new ComplianceRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const ruleEngine = new RuleEngine(
  new MandateValidator(),
  new GuardrailEvaluator(),
  new SuitabilityChecker(),
  new AuthorityResolver(),
);

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  for (const record of event.Records) {
    try {
      const uow = parseRecord(record);
      const eventType = uow.event.type;

      logger.info('Processing event', { eventType, eventId: uow.event.id });

      const isNew = await idempotencyGuard.ensureOnce(eventType, uow.event.id);
      if (!isNew) {
        logger.info('Duplicate event, skipping', { eventId: uow.event.id });
        continue;
      }

      if (
        eventType === 'DECISION_PACKET_CREATED' ||
        eventType === 'DECISION_PACKET_ENRICHED'
      ) {
        await processDecisionPacket(uow.event);
      } else {
        logger.info('No handler for event type, skipping', { eventType });
      }
    } catch (error) {
      logger.error('Failed to process record', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      failures.push(record.messageId);
    }
  }

  return {
    batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
  };
};

async function processDecisionPacket(
  event: Record<string, unknown>,
): Promise<void> {
  const subject = event.subject as Record<string, unknown>;
  const context = event.context as Record<string, unknown>;
  const tenantId = (context.tenantId ?? subject.tenantId) as string;
  const userId = subject.userId as string ?? tenantId;
  const decisionPacketId = subject.decisionId as string;

  // Load mandate snapshot from DynamoDB
  const mandateRecord = await repository.getMandateSnapshot(tenantId, userId);
  if (!mandateRecord) {
    logger.error('No mandate snapshot found for user', { tenantId, userId });
    // Create a compliance check with BLOCKED result for missing mandate
    const ccId = getUUID();
    await repository.createComplianceCheck(tenantId, ccId, decisionPacketId, {
      mandateId: 'NONE',
      level: 'ADVISORY',
      monthlyTurnoverCapPercent: 0,
      maxSingleTradePercent: 0,
      effectiveDate: new Date().toISOString(),
      revokedAt: null,
    });
    await repository.updateCheckResult(tenantId, ccId, 'BLOCKED', [
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
  await repository.createComplianceCheck(tenantId, ccId, decisionPacketId, mandate);

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

  const output = ruleEngine.evaluate(complianceInput);

  // Persist result
  await repository.updateCheckResult(
    tenantId,
    ccId,
    output.result,
    output.violations,
    output.authorityLevel,
  );

  // Create audit artifact
  const artifactId = getUUID();
  await repository.createAuditArtifact(tenantId, ccId, artifactId, {
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
