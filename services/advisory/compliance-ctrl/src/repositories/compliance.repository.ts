import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, EntityNotFoundError, type TableEntry, type RequestContext } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { MandateSnapshot } from '../rules/rule-engine';

function complianceCheckPk(tenantId: string, ccId: string): string {
  return `ComplianceCheck#${tenantId}#${ccId}`;
}

function guardrailPolicyPk(tenantId: string, userId: string): string {
  return `GuardrailPolicy#${tenantId}#${userId}`;
}

export class ComplianceRepository extends TableRepository {
  private readonly log = withMethodLogging('ComplianceRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createComplianceCheck = this.log('createComplianceCheck', async (
    ctx: RequestContext,
    ccId: string,
    decisionPacketId: string,
    mandateSnapshot: MandateSnapshot,
    sourceEventId?: string,
  ): Promise<boolean> => {
    const now = getTime();
    const item: TableEntry = {
      pk: complianceCheckPk(ctx.tenantId, ccId),
      sk: 'ComplianceCheck',
      __typename: 'ComplianceCheck',
      ...ctx,
      timestamp: now,
      ccId,
      decisionPacketId,
      mandateSnapshot,
      sourceEventId: sourceEventId ?? null,
      status: 'PENDING',
      result: null,
      violations: [],
      authorityLevel: null,
      createdAt: now,
      updatedAt: now,
    };
    return this.putIfNotExists(item);
  });

  readonly getComplianceCheck = this.log('getComplianceCheck', async (
    tenantId: string,
    ccId: string,
  ): Promise<Record<string, unknown>> => {
    const pk = complianceCheckPk(tenantId, ccId);
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: 'ComplianceCheck' },
      }),
    );
    if (!result.Item) {
      throw new EntityNotFoundError('ComplianceCheck', `${tenantId}#${ccId}`);
    }
    return result.Item;
  });

  readonly updateCheckResult = this.log('updateCheckResult', async (
    ctx: RequestContext,
    ccId: string,
    checkResult: 'APPROVED' | 'BLOCKED',
    violations: unknown[],
    authorityLevel: 'L1' | 'L2',
  ): Promise<Record<string, unknown>> => {
    const pk = complianceCheckPk(ctx.tenantId, ccId);
    const now = getTime();

    const updateResult = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: 'ComplianceCheck' },
        UpdateExpression:
          'SET #status = :status, #result = :result, violations = :violations, authorityLevel = :authorityLevel, updatedAt = :now, #ts = :ts',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#result': 'result',
          '#ts': 'timestamp',
        },
        ExpressionAttributeValues: {
          ':status': 'COMPLETED',
          ':result': checkResult,
          ':violations': violations,
          ':authorityLevel': authorityLevel,
          ':now': now,
          ':ts': now,
        },
        ConditionExpression: 'attribute_exists(pk)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    if (!updateResult.Attributes) {
      throw new EntityNotFoundError('ComplianceCheck', `${ctx.tenantId}#${ccId}`);
    }

    return updateResult.Attributes;
  });

  readonly createAuditArtifact = this.log('createAuditArtifact', async (
    ctx: RequestContext,
    ccId: string,
    artifactId: string,
    artifact: Record<string, unknown>,
  ): Promise<boolean> => {
    const now = getTime();
    const item: TableEntry = {
      pk: complianceCheckPk(ctx.tenantId, ccId),
      sk: `AuditArtifact#${artifactId}`,
      __typename: 'AuditArtifact',
      ...ctx,
      timestamp: now,
      artifactId,
      ...artifact,
      createdAt: now,
    };
    return this.putIfNotExists(item);
  });

  readonly getGuardrailPolicy = this.log('getGuardrailPolicy', async (
    tenantId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> => {
    const pk = guardrailPolicyPk(tenantId, userId);
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: 'GuardrailPolicy' },
      }),
    );
    return result.Item ?? null;
  });

  readonly putMandateSnapshot = this.log('putMandateSnapshot', async (
    ctx: RequestContext,
    mandate: Record<string, unknown>,
  ): Promise<void> => {
    const now = getTime();
    const item: TableEntry = {
      pk: guardrailPolicyPk(ctx.tenantId, ctx.userId),
      sk: 'MandateSnapshot',
      __typename: 'MandateSnapshot',
      ...ctx,
      timestamp: now,
      ...mandate,
      snapshotAt: now,
    };
    await this.put(item);
  });

  readonly getMandateSnapshot = this.log('getMandateSnapshot', async (
    tenantId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> => {
    const pk = guardrailPolicyPk(tenantId, userId);
    // Strongly consistent read: the SQS Lambda may run multiple containers
    // in parallel. When INVESTOR_PROFILE_CREATED (writer) and
    // RECOMMENDATION_PROPOSED (reader) are processed back-to-back on
    // different containers, an eventually-consistent read can miss the
    // freshly-written MandateSnapshot row and the rule engine would
    // emit a spurious MANDATE_MISSING violation. The DDB strongly
    // consistent read is the correct guarantee here — within the same
    // partition the writer's commit is visible immediately.
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: 'MandateSnapshot' },
        ConsistentRead: true,
      }),
    );
    return result.Item ?? null;
  });
}
