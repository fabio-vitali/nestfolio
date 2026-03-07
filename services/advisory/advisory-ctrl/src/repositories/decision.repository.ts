import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { TableRepository, getUUID, getTime, log, type TableEntry } from '@nestfolio/platform-core';
import type { BusEvent } from '@nestfolio/platform-core';

function decisionPk(tenantId: string, dpId: string): string {
  return `DecisionPacket#${tenantId}#${dpId}`;
}

function workflowPk(tenantId: string, wfId: string): string {
  return `Workflow#${tenantId}#${wfId}`;
}

export class DecisionRepository extends TableRepository {
  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  @log()
  async createDecisionPacket(
    tenantId: string,
    dpId: string,
    triggerEvent: BusEvent,
    investorContext: Record<string, unknown>,
  ): Promise<void> {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(tenantId, dpId),
      sk: 'DecisionPacket',
      __typename: 'DecisionPacket',
      tenantId,
      timestamp: now,
      decisionId: dpId,
      trigger: triggerEvent.type,
      triggerEvent,
      investorContext,
      status: 'DRAFT',
      proposedTrades: [],
      explanation: '',
      complianceChecks: [],
      agentInvocations: [],
      confirmationRequired: false,
      confirmedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.put(item);
  }

  @log()
  async getDecisionPacket(tenantId: string, dpId: string): Promise<Record<string, unknown> | null> {
    const pk = decisionPk(tenantId, dpId);
    const items = await this.queryByPk(pk, 'DecisionPacket');
    return items.length > 0 ? items[0] : null;
  }

  @log()
  async updateDecisionStatus(
    tenantId: string,
    dpId: string,
    status: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const pk = decisionPk(tenantId, dpId);
    const now = getTime();

    const decisionUpdate: TableEntry = {
      pk,
      sk: 'DecisionPacket',
      __typename: 'DecisionPacket',
      tenantId,
      timestamp: now,
      decisionId: dpId,
      status,
      updatedAt: now,
      ...(details ?? {}),
    };

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
        { Put: { TableName: this.tableName, Item: decisionUpdate } },
        { Put: { TableName: this.tableName, Item: editEvent } },
      ],
    });
  }

  @log()
  async recordAgentInvocation(
    tenantId: string,
    dpId: string,
    step: number,
    agentName: string,
    input: unknown,
    output: unknown,
    latencyMs: number,
  ): Promise<void> {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(tenantId, dpId),
      sk: `AgentInvocation#${step}#${agentName}`,
      __typename: 'AgentInvocation',
      tenantId,
      timestamp: now,
      invocationId: getUUID(),
      decisionId: dpId,
      step,
      agentName,
      modelId: 'stub',
      input,
      output,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: 'COMPLETED',
      errorMessage: null,
      startedAt: now,
      completedAt: now,
    };
    await this.put(item);
  }

  @log()
  async recordReasoningOutput(
    tenantId: string,
    dpId: string,
    agentName: string,
    output: unknown,
  ): Promise<void> {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(tenantId, dpId),
      sk: `ReasoningOutput#${agentName}`,
      __typename: 'ReasoningOutput',
      tenantId,
      timestamp: now,
      decisionId: dpId,
      agentName,
      output,
    };
    await this.put(item);
  }

  @log()
  async updateWorkflowState(
    tenantId: string,
    wfId: string,
    state: Record<string, unknown>,
  ): Promise<void> {
    const now = getTime();
    const item: TableEntry = {
      pk: workflowPk(tenantId, wfId),
      sk: 'WorkflowState',
      __typename: 'WorkflowState',
      tenantId,
      timestamp: now,
      workflowId: wfId,
      ...state,
    };
    await this.put(item);
  }
}
