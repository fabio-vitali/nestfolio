import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  DeleteCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry } from '@nestfolio/platform-core';
import { withMethodLogging } from '@nestfolio/lambda-utils';

function reconciliationPk(tenantId: string, reconciliationId: string): string {
  return `Reconciliation#${tenantId}#${reconciliationId}`;
}

function lockPk(tenantId: string): string {
  return `ReconciliationLock#${tenantId}`;
}

export class ReconciliationRepository extends TableRepository {
  private readonly log = withMethodLogging('ReconciliationRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createReconciliation = this.log('createReconciliation',
    async (
      tenantId: string,
      reconciliationId: string,
      triggerType: string,
    ): Promise<void> => {
      const now = getTime();
      const item: TableEntry = {
        pk: reconciliationPk(tenantId, reconciliationId),
        sk: 'Reconciliation',
        __typename: 'Reconciliation',
        tenantId,
        timestamp: now,
        reconciliationId,
        triggerType,
        status: 'STARTED',
        driftRecordCount: 0,
        startedAt: now,
        completedAt: null,
        failedAt: null,
        failureReason: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.put(item);
    },
  );

  readonly getReconciliation = this.log('getReconciliation',
    async (
      tenantId: string,
      reconciliationId: string,
    ): Promise<Record<string, unknown> | null> => {
      const pk = reconciliationPk(tenantId, reconciliationId);
      const items = await this.queryByPk(pk, 'Reconciliation');
      return items.length > 0 ? items[0] : null;
    },
  );

  readonly updateReconciliationStatus = this.log('updateReconciliationStatus',
    async (
      tenantId: string,
      reconciliationId: string,
      status: string,
      details?: Record<string, unknown>,
    ): Promise<void> => {
      const pk = reconciliationPk(tenantId, reconciliationId);
      const now = getTime();

      const editEvent: TableEntry = {
        pk,
        sk: `EditEvent#${now}#${getUUID()}`,
        __typename: 'EditEvent',
        tenantId,
        timestamp: now,
        operation: 'replace',
        path: `/reconciliation/${reconciliationId}/status`,
        value: { status, ...(details ?? {}) },
        editedBy: 'system',
        editedAt: now,
      };

      await this.transactWrite({
        TransactItems: [
          this.buildTransactUpdate(pk, 'Reconciliation', {
            status,
            updatedAt: now,
            timestamp: now,
            ...(status === 'COMPLETED' ? { completedAt: now } : {}),
            ...(status === 'FAILED' ? { failedAt: now } : {}),
            ...(details ?? {}),
          }) as any,
          { Put: { TableName: this.tableName, Item: editEvent } },
        ],
      });
    },
  );

  readonly createDriftRecord = this.log('createDriftRecord',
    async (
      tenantId: string,
      reconciliationId: string,
      instrument: string,
      intentQty: number,
      settlementQty: number,
      drift: number,
    ): Promise<void> => {
      const now = getTime();
      const item: TableEntry = {
        pk: reconciliationPk(tenantId, reconciliationId),
        sk: `DriftRecord#${instrument}`,
        __typename: 'DriftRecord',
        tenantId,
        timestamp: now,
        reconciliationId,
        instrument,
        intentQty,
        settlementQty,
        drift,
        createdAt: now,
      };
      await this.put(item);
    },
  );

  readonly getDriftRecords = this.log('getDriftRecords',
    async (
      tenantId: string,
      reconciliationId: string,
    ): Promise<Record<string, unknown>[]> => {
      const pk = reconciliationPk(tenantId, reconciliationId);
      return this.queryByPk(pk, 'DriftRecord#');
    },
  );

  readonly acquireLock = this.log('acquireLock',
    async (tenantId: string): Promise<boolean> => {
      const now = getTime();
      const lockTtl = Date.now() + 5 * 60 * 1000; // 5 minutes

      try {
        await this.docClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: {
              pk: lockPk(tenantId),
              sk: 'ReconciliationLock',
              __typename: 'ReconciliationLock',
              tenantId,
              timestamp: now,
              expiresAt: lockTtl,
              acquiredAt: now,
            },
            ConditionExpression: 'attribute_not_exists(pk) OR expiresAt < :now',
            ExpressionAttributeValues: { ':now': Date.now() },
          }),
        );
        return true;
      } catch (error: unknown) {
        const err = error as { name?: string };
        if (err.name === 'ConditionalCheckFailedException') {
          return false;
        }
        throw error;
      }
    },
  );

  readonly releaseLock = this.log('releaseLock',
    async (tenantId: string): Promise<void> => {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { pk: lockPk(tenantId), sk: 'ReconciliationLock' },
        }),
      );
    },
  );

  readonly isLocked = this.log('isLocked',
    async (tenantId: string): Promise<boolean> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk: lockPk(tenantId), sk: 'ReconciliationLock' },
        }),
      );

      if (!result.Item) return false;

      const expiresAt = result.Item.expiresAt as number;
      return expiresAt > Date.now();
    },
  );
}
