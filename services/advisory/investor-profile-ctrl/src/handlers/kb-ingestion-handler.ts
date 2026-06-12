import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import {
  materializeToBucket, store, parseSubject,
  type EventPayload, type EventContext,
  requireEnv, logger,
} from '@nestfolio/event-processor';
import { ComplianceCheckSchema, type ComplianceCheck } from '@nestfolio/compliance-ctrl/contracts';

export interface KbIngestionDeps {
  readonly bedrockAgent: BedrockAgentClient;
  readonly kbId: string;
  readonly kbDataSourceId: string;
}

function buildNarrative(eventType: string, subject: ComplianceCheck): string {
  if (eventType === 'DECISION_BLOCKED') {
    const reasons = subject.violations.map(v => v.description).join('; ') || 'No reason provided';
    return `Decision ${subject.decisionId} blocked: ${reasons}. Authority: ${subject.authorityLevel}. Details: ${JSON.stringify(subject)}`;
  }
  return `Decision ${subject.decisionId} approved at ${subject.authorityLevel}. Summary: ${JSON.stringify(subject)}`;
}

export const createKbIngestionHandlers = (deps: KbIngestionDeps) => {
  const handleIngestion = async (payload: EventPayload, ctx: EventContext) => {
    const subject = parseSubject(payload, ComplianceCheckSchema);
    const decisionId = subject.decisionId;
    const content = buildNarrative(ctx.eventType, subject);
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
