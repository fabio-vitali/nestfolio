import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry, type RequestContext } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { BusEvent } from '@nestfolio/event-processor';

function decisionPk(tenantId: string, dpId: string): string {
  return `DecisionPacket#${tenantId}#${dpId}`;
}

function workflowPk(tenantId: string, wfId: string): string {
  return `Workflow#${tenantId}#${wfId}`;
}

export class DecisionRepository extends TableRepository {
  private readonly log = withMethodLogging('DecisionRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createDecisionPacket = this.log('createDecisionPacket', async (
    dpId: string,
    triggerEvent: BusEvent,
    investorContext: Record<string, unknown>,
    ctx: RequestContext,
  ): Promise<boolean> => {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(ctx.tenantId, dpId),
      sk: 'DecisionPacket',
      __typename: 'DecisionPacket',
      ...ctx,
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
      sourceEventId: triggerEvent.id,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    return this.putIfNotExists(item);
  });

  readonly getDecisionPacket = this.log('getDecisionPacket', async (tenantId: string, dpId: string): Promise<Record<string, unknown> | null> => {
    const pk = decisionPk(tenantId, dpId);
    const items = await this.queryByPk(pk, 'DecisionPacket');
    return items.length > 0 ? items[0] : null;
  });

  readonly updateDecisionStatus = this.log('updateDecisionStatus', async (
    tenantId: string,
    dpId: string,
    status: string,
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

  readonly recordAgentInvocation = this.log('recordAgentInvocation', async (
    dpId: string,
    step: number,
    agentName: string,
    input: unknown,
    output: unknown,
    latencyMs: number,
    ctx: RequestContext,
  ): Promise<void> => {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(ctx.tenantId, dpId),
      sk: `AgentInvocation#${step}#${agentName}`,
      __typename: 'AgentInvocation',
      ...ctx,
      timestamp: now,
      invocationId: getUUID(),
      decisionId: dpId,
      step,
      agentName,
      modelId: 'unknown',
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
  });

  readonly recordReasoningOutput = this.log('recordReasoningOutput', async (
    dpId: string,
    agentName: string,
    output: unknown,
    ctx: RequestContext,
  ): Promise<void> => {
    const now = getTime();
    const item: TableEntry = {
      pk: decisionPk(ctx.tenantId, dpId),
      sk: `ReasoningOutput#${agentName}`,
      __typename: 'ReasoningOutput',
      ...ctx,
      timestamp: now,
      decisionId: dpId,
      agentName,
      output,
    };
    await this.put(item);
  });

  readonly updateWorkflowState = this.log('updateWorkflowState', async (
    wfId: string,
    state: Record<string, unknown>,
    ctx: RequestContext,
  ): Promise<void> => {
    const now = getTime();
    const item: TableEntry = {
      pk: workflowPk(ctx.tenantId, wfId),
      sk: 'WorkflowState',
      __typename: 'WorkflowState',
      ...ctx,
      timestamp: now,
      workflowId: wfId,
      ...state,
    };
    await this.put(item);
  });
}
