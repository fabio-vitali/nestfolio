import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  createEventHandler, skip,
  type EventPayload, type EventContext,
  requireEnv, logger,
} from '@nestfolio/event-processor';
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient } from '@nestfolio/agent-core';
import { createAgentService } from '../agent-service';

export interface EventListenerDeps {
  readonly agentService: { runPipeline: (event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly bus: { publish: (events: Array<{ type: string; subject: Record<string, unknown> }>) => Promise<void> };
  readonly memoryClient: MemoryClient;
}

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  handlers['ANALYZE_INVESTOR_PROFILE'] = async (payload, ctx) => {
    const subject = payload.subject ?? {};
    const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
    const decisionId = subject.decisionId as string;
    const taskToken = subject.taskToken as string;

    logger.info('Processing ANALYZE_INVESTOR_PROFILE', { decisionId, tenantId });

    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);
    const tenantHistory = await session.searchLongTermMemory('investor preferences risk tolerance');

    const result = await deps.agentService.runPipeline({
      tenantId,
      decisionId,
      taskToken,
      investorProfile: subject.investorProfile ?? subject.context ?? {},
      portfolioState: subject.portfolioState ?? {},
      tenantHistory: tenantHistory.map(r => r.content),
    });

    await session.writeAgentOutput(result);

    await deps.bus.publish([{
      type: 'INVESTOR_PROFILE_COMPLETED',
      subject: {
        decisionId,
        tenantId,
        taskToken,
      },
    }]);

    logger.info('Published INVESTOR_PROFILE_COMPLETED', { decisionId });
    return skip();
  };

  return handlers;
};

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');
const BUS_NAME = requireEnv('BUS_NAME');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const ebClient = new EventBridgeClient({});

const agentService = createAgentService({ docClient, tableName: TABLE_NAME });

const bus = {
  publish: async (events: Array<{ type: string; subject: Record<string, unknown> }>) => {
    await ebClient.send(new PutEventsCommand({
      Entries: events.map((e) => ({
        EventBusName: BUS_NAME,
        Source: 'nestfolio.investor-profile-ctrl',
        DetailType: e.type,
        Detail: JSON.stringify({ type: e.type, subject: e.subject }),
      })),
    }));
  },
};

const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'investor-profile' })
  : createNoOpMemoryClient();

const deps: EventListenerDeps = { agentService, bus, memoryClient };

export const handler = createEventHandler({
  serviceName: 'investor-profile-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: BUS_NAME,
  errorEventType: 'INVESTOR_PROFILE_CTRL_FAILED',
});
