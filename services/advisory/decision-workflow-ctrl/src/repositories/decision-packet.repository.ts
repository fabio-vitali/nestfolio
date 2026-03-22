/* eslint-disable @typescript-eslint/no-explicit-any */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { TableRepository, getTime, type TableEntry } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { WorkflowStatus } from '../domain/models';

function decisionPk(tenantId: string, dpId: string): string {
  return `DecisionPacket#${tenantId}#${dpId}`;
}

interface CreateDecisionPacketInput {
  readonly tenantId: string;
  readonly decisionId: string;
  readonly trigger: string;
  readonly triggerEventId: string;
  readonly executionArn: string | null;
}

export class DecisionPacketRepository extends TableRepository {
  private readonly log = withMethodLogging('DecisionPacketRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  /** Idempotent create — returns false if packet already exists. */
  readonly createDecisionPacket = this.log('createDecisionPacket', async (
    input: CreateDecisionPacketInput,
  ): Promise<boolean> => {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(input.tenantId, input.decisionId),
      sk: 'DecisionPacket',
      __typename: 'DecisionPacket',
      tenantId: input.tenantId,
      timestamp: now,
      decisionId: input.decisionId,
      trigger: input.trigger,
      triggerEventId: input.triggerEventId,
      executionArn: input.executionArn,
      status: 'INITIATED' as WorkflowStatus,
      complianceResult: null,
      authorityLevel: null,
      userDecision: null,
      blockReason: null,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
    };
    return this.putIfNotExists(item);
  });

  readonly getDecisionPacket = this.log('getDecisionPacket', async (
    tenantId: string,
    dpId: string,
  ): Promise<Record<string, unknown> | null> => {
    const pk = decisionPk(tenantId, dpId);
    const items = await this.queryByPk(pk, 'DecisionPacket');
    return items.length > 0 ? items[0] : null;
  });

  /** Update status with optional extra attributes. Writes an EditEvent for audit trail. */
  readonly updateStatus = this.log('updateStatus', async (
    tenantId: string,
    dpId: string,
    status: WorkflowStatus,
    details?: Record<string, unknown>,
  ): Promise<void> => {
    const pk = decisionPk(tenantId, dpId);
    const now = getTime();

    await this.transactWrite({
      TransactItems: [
        this.buildTransactUpdate(pk, 'DecisionPacket', {
          status,
          updatedAt: now,
          timestamp: now,
          ...(details ?? {}),
        }) as any,
      ],
    });
  });

}
