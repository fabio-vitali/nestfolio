/* eslint-disable @typescript-eslint/no-explicit-any */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { TableRepository, getTime, type TableEntry, type RequestContext } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { WorkflowStatus } from '../domain/models';

function decisionPk(tenantId: string, dpId: string): string {
  return `DecisionPacket#${tenantId}#${dpId}`;
}

interface CreateDecisionPacketInput {
  readonly decisionId: string;
  readonly trigger: string;
  readonly triggerEventId: string;
  readonly executionArn: string | null;
  readonly explanation: string;
  readonly proposedTrades: unknown[];
  readonly confirmationRequired: boolean;
}

export class DecisionPacketRepository extends TableRepository {
  private readonly log = withMethodLogging('DecisionPacketRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  /** Idempotent create — returns false if packet already exists. */
  readonly createDecisionPacket = this.log('createDecisionPacket', async (
    input: CreateDecisionPacketInput,
    ctx: RequestContext,
  ): Promise<boolean> => {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(ctx.tenantId, input.decisionId),
      sk: 'DecisionPacket',
      __typename: 'DecisionPacket',
      ...ctx,
      timestamp: now,
      decisionId: input.decisionId,
      trigger: input.trigger,
      triggerEventId: input.triggerEventId,
      executionArn: input.executionArn,
      explanation: input.explanation,
      proposedTrades: input.proposedTrades,
      confirmationRequired: input.confirmationRequired,
      status: 'PENDING' as WorkflowStatus,
      __version: 1,
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
