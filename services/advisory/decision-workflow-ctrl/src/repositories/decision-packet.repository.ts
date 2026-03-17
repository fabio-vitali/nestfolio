import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { WorkflowStatus, AgentStep } from '../service-domain/models';

function decisionPk(tenantId: string, dpId: string): string {
  return `DecisionPacket#${tenantId}#${dpId}`;
}

export interface CreateDecisionPacketInput {
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
      investorProfileOutput: null,
      marketAnalysisOutput: null,
      portfolioOutput: null,
      narrativeOutput: null,
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

    const editEvent: TableEntry = {
      pk,
      sk: `EditEvent#${now}#${getUUID()}`,
      __typename: 'EditEvent',
      tenantId,
      timestamp: now,
      operation: 'replace',
      path: `/decisionPacket/${dpId}/status`,
      value: { status, ...(details ?? {}) },
      editedBy: 'system',
      editedAt: now,
    };

    await this.transactWrite({
      TransactItems: [
        this.buildTransactUpdate(pk, 'DecisionPacket', {
          status,
          updatedAt: now,
          timestamp: now,
          ...(details ?? {}),
        }) as any,
        { Put: { TableName: this.tableName, Item: editEvent } },
      ],
    });
  });

  /** Store agent output as a sub-item under the DecisionPacket partition. */
  readonly storeAgentOutput = this.log('storeAgentOutput', async (
    tenantId: string,
    dpId: string,
    agentStep: AgentStep,
    output: Record<string, unknown>,
  ): Promise<void> => {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(tenantId, dpId),
      sk: `AgentOutput#${agentStep}`,
      __typename: 'AgentOutput',
      tenantId,
      timestamp: now,
      decisionId: dpId,
      agentStep,
      output,
    };
    await this.put(item);
  });
}
