import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SFNClient, StartExecutionCommand, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import {
  createEventHandler, skip,
  type EventPayload, type EventContext,
  requireEnv, logger, getUUID,
} from '@nestfolio/event-processor';
import { DecisionPacketRepository } from '../repositories/decision-packet.repository';
import {
  TRIGGER_EVENT_TYPES,
  AGENT_COMPLETION_EVENT_TYPES,
  COMPLIANCE_EVENT_TYPES,
  USER_RESPONSE_EVENT_TYPES,
} from '../service-domain/events';

export interface EventListenerDeps {
  readonly repository: DecisionPacketRepository;
  readonly sfnSend: (command: unknown) => Promise<unknown>;
  readonly stateMachineArn: string;
}

/** Map agent completion event types to agent step names */
const AGENT_STEP_MAP: Record<string, string> = {
  INVESTOR_PROFILE_COMPLETED: 'investor-profile',
  MARKET_ANALYSIS_COMPLETED: 'market-intelligence',
  PORTFOLIO_COMPLETED: 'portfolio-engine',
  NARRATIVE_COMPLETED: 'advisory-narrative',
};

// --- Handler functions ---

async function handleTriggerEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const tenantId = (payload.subject?.tenantId as string) ?? ctx.tenantId;
  const decisionId = getUUID();

  // Start Step Functions execution
  const startCmd = new StartExecutionCommand({
    stateMachineArn: deps.stateMachineArn,
    name: `decision-${decisionId}`,
    input: JSON.stringify({
      decisionId,
      tenantId,
      trigger: ctx.eventType,
      triggerEventId: ctx.eventId,
      context: payload.subject ?? {},
    }),
  });

  const result = (await deps.sfnSend(startCmd)) as { executionArn?: string };

  // Create DecisionPacket in DDB (idempotent)
  await deps.repository.createDecisionPacket({
    tenantId,
    decisionId,
    trigger: ctx.eventType,
    triggerEventId: ctx.eventId,
    executionArn: result.executionArn ?? null,
  });

  logger.info('Started decision workflow', { decisionId, trigger: ctx.eventType, tenantId });
  return skip();
}

async function handleAgentCompletion(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = payload.subject ?? {};
  const taskToken = subject.taskToken as string;
  const decisionId = subject.decisionId as string;
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const outputs = (subject.outputs as Record<string, unknown>) ?? {};

  if (!taskToken) {
    throw new Error(`Missing taskToken in ${ctx.eventType} event`);
  }

  const agentStep = AGENT_STEP_MAP[ctx.eventType];

  // Store agent output in DDB
  if (agentStep && decisionId) {
    await deps.repository.storeAgentOutput(tenantId, decisionId, agentStep as any, outputs);
  }

  // Resume Step Functions
  const sendCmd = new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify(outputs),
  });
  await deps.sfnSend(sendCmd);

  logger.info('Resumed workflow after agent completion', { agentStep, decisionId });
  return skip();
}

async function handleComplianceEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = payload.subject ?? {};
  const taskToken = subject.taskToken as string;
  const decisionId = subject.decisionId as string;
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const authorityLevel = (subject.authorityLevel as string) ?? 'L2';
  const reason = subject.reason as string | undefined;

  if (!taskToken) {
    throw new Error(`Missing taskToken in ${ctx.eventType} event`);
  }

  const isApproved = ctx.eventType === 'DECISION_APPROVED';
  const decision = isApproved ? 'APPROVED' : 'BLOCKED';
  const status = isApproved
    ? (authorityLevel === 'L1' ? 'APPROVED' : 'AWAITING_CONFIRMATION')
    : 'BLOCKED';

  // Update DDB
  if (decisionId) {
    await deps.repository.updateStatus(tenantId, decisionId, status as any, {
      complianceResult: decision,
      authorityLevel,
      ...(reason ? { blockReason: reason } : {}),
    });
  }

  // Resume Step Functions
  const sendCmd = new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify({ decision, authorityLevel, ...(reason ? { reason } : {}) }),
  });
  await deps.sfnSend(sendCmd);

  logger.info('Resumed workflow after compliance', { decision, decisionId });
  return skip();
}

async function handleUserResponse(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = payload.subject ?? {};
  const taskToken = subject.taskToken as string;
  const decisionId = subject.decisionId as string;
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const reason = subject.reason as string | undefined;

  if (!taskToken) {
    throw new Error(`Missing taskToken in ${ctx.eventType} event`);
  }

  const isConfirmed = ctx.eventType === 'USER_CONFIRMED';
  const decision = isConfirmed ? 'CONFIRMED' : 'REJECTED';

  // Update DDB
  if (decisionId) {
    await deps.repository.updateStatus(tenantId, decisionId, decision as any, {
      userDecision: decision,
      ...(reason ? { rejectionReason: reason } : {}),
    });
  }

  // Resume Step Functions
  const sendCmd = new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
  });
  await deps.sfnSend(sendCmd);

  logger.info('Resumed workflow after user response', { decision, decisionId });
  return skip();
}

// --- Handler map builder ---

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  for (const type of TRIGGER_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => handleTriggerEvent(deps, payload, ctx);
  }

  for (const type of AGENT_COMPLETION_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => handleAgentCompletion(deps, payload, ctx);
  }

  for (const type of COMPLIANCE_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => handleComplianceEvent(deps, payload, ctx);
  }

  for (const type of USER_RESPONSE_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => handleUserResponse(deps, payload, ctx);
  }

  return handlers;
};

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');
const STATE_MACHINE_ARN = requireEnv('STATE_MACHINE_ARN');
const dynamoClient = new DynamoDBClient({});
const sfnClient = new SFNClient({});
const repository = new DecisionPacketRepository(TABLE_NAME, dynamoClient);

const deps: EventListenerDeps = {
  repository,
  sfnSend: (cmd) => sfnClient.send(cmd as any),
  stateMachineArn: STATE_MACHINE_ARN,
};

export const handler = createEventHandler({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'DECISION_WORKFLOW_FAILED',
});
