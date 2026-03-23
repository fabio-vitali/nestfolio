import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import {
  materializeToBucket, store,
  type EventPayload, type EventContext,
  requireEnv, logger,
} from '@nestfolio/event-processor';

export interface KbIngestionDeps {
  readonly bedrockAgent: BedrockAgentClient;
  readonly kbId: string;
  readonly kbDataSourceId: string;
}

function buildNarrative(eventType: string, subject: Record<string, unknown>): string {
  if (eventType === 'DECISION_BLOCKED') {
    return `Decision ${subject.decisionId} blocked: ${subject.reason ?? 'No reason provided'}. Risk category: ${subject.riskCategory ?? 'unknown'}. Details: ${JSON.stringify(subject)}`;
  }
  return `Decision ${subject.decisionId} approved at ${subject.authorityLevel ?? 'L1'}. Risk category: ${subject.riskCategory ?? 'unknown'}. Summary: ${JSON.stringify(subject)}`;
}

export const createKbIngestionHandlers = (deps: KbIngestionDeps) => {
  const handleIngestion = async (payload: EventPayload, ctx: EventContext) => {
    const subject = payload.subject ?? {};
    const decisionId = subject.decisionId as string;
    const content = buildNarrative(ctx.eventType, subject as Record<string, unknown>);
    const key = `compliance/${ctx.eventType.toLowerCase()}/${decisionId}-${Date.now()}.txt`;

    logger.info('Triggering KB sync', { eventType: ctx.eventType });

    await deps.bedrockAgent.send(new StartIngestionJobCommand({
      knowledgeBaseId: deps.kbId,
      dataSourceId: deps.kbDataSourceId,
    }));

    logger.info('KB sync triggered', { kbId: deps.kbId });
    return store(content, { key });
  };

  return {
    DECISION_BLOCKED: handleIngestion,
    DECISION_APPROVED: handleIngestion,
  };
};

// --- Production wiring ---

const KB_ID = requireEnv('KB_ID');
const KB_DATA_SOURCE_ID = requireEnv('KB_DATA_SOURCE_ID');

const bedrockAgent = new BedrockAgentClient({});

const deps: KbIngestionDeps = { bedrockAgent, kbId: KB_ID, kbDataSourceId: KB_DATA_SOURCE_ID };

export const handler = materializeToBucket({
  serviceName: 'investor-profile-ctrl-kb',
  handlers: createKbIngestionHandlers(deps),
  bucket: requireEnv('KB_BUCKET'),
});
