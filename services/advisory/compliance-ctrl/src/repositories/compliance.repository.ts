import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, log, type TableEntry } from '@nestfolio/platform-core';
import { EntityNotFoundError } from '@nestfolio/domain-core';
import type { MandateSnapshot } from '../rules/rule-engine';

function complianceCheckPk(tenantId: string, ccId: string): string {
  return `ComplianceCheck#${tenantId}#${ccId}`;
}

function guardrailPolicyPk(tenantId: string, userId: string): string {
  return `GuardrailPolicy#${tenantId}#${userId}`;
}

export class ComplianceRepository extends TableRepository {
  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  @log()
  async createComplianceCheck(
    tenantId: string,
    ccId: string,
    decisionPacketId: string,
    mandateSnapshot: MandateSnapshot,
  ): Promise<void> {
    const now = getTime();
    const item: TableEntry = {
      pk: complianceCheckPk(tenantId, ccId),
      sk: 'ComplianceCheck',
      __typename: 'ComplianceCheck',
      tenantId,
      timestamp: now,
      ccId,
      decisionPacketId,
      mandateSnapshot,
      status: 'PENDING',
      result: null,
      violations: [],
      authorityLevel: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.put(item);
  }

  @log()
  async getComplianceCheck(
    tenantId: string,
    ccId: string,
  ): Promise<Record<string, unknown>> {
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
  }

  @log()
  async updateCheckResult(
    tenantId: string,
    ccId: string,
    checkResult: 'APPROVED' | 'BLOCKED',
    violations: unknown[],
    authorityLevel: 'L1' | 'L2',
  ): Promise<Record<string, unknown>> {
    const pk = complianceCheckPk(tenantId, ccId);
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
      throw new EntityNotFoundError('ComplianceCheck', `${tenantId}#${ccId}`);
    }

    // Create edit event
    const editEvent: TableEntry = {
      pk,
      sk: `EditEvent#${now}#${getUUID()}`,
      __typename: 'EditEvent',
      tenantId,
      timestamp: now,
      operation: 'replace',
      path: `/complianceCheck/${ccId}/result`,
      value: { result: checkResult, authorityLevel, violations },
      editedBy: 'compliance-ctrl',
      editedAt: now,
    };
    await this.put(editEvent);

    return updateResult.Attributes;
  }

  @log()
  async createAuditArtifact(
    tenantId: string,
    ccId: string,
    artifactId: string,
    artifact: Record<string, unknown>,
  ): Promise<void> {
    const now = getTime();
    const item: TableEntry = {
      pk: complianceCheckPk(tenantId, ccId),
      sk: `AuditArtifact#${artifactId}`,
      __typename: 'AuditArtifact',
      tenantId,
      timestamp: now,
      artifactId,
      ...artifact,
      createdAt: now,
    };
    await this.put(item);
  }

  @log()
  async getGuardrailPolicy(
    tenantId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const pk = guardrailPolicyPk(tenantId, userId);
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: 'GuardrailPolicy' },
      }),
    );
    return result.Item ?? null;
  }

  @log()
  async putMandateSnapshot(
    tenantId: string,
    userId: string,
    mandate: Record<string, unknown>,
  ): Promise<void> {
    const now = getTime();
    const item: TableEntry = {
      pk: guardrailPolicyPk(tenantId, userId),
      sk: 'MandateSnapshot',
      __typename: 'MandateSnapshot',
      tenantId,
      timestamp: now,
      ...mandate,
      snapshotAt: now,
    };
    await this.put(item);
  }

  @log()
  async getMandateSnapshot(
    tenantId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const pk = guardrailPolicyPk(tenantId, userId);
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: 'MandateSnapshot' },
      }),
    );
    return result.Item ?? null;
  }
}
