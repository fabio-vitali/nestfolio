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

export const createKbIngestionHandlers = (deps: KbIngestionDeps) => {
  const handleIngestion = async (payload: EventPayload, ctx: EventContext) => {
    // boundary: SEC_PROSPECTUS_UPDATED and SEC_10K_UPDATED are external SEC EDGAR
    // feed events with no producer CDC zod contracts (third-party ingestion).
    const subject = payload.subject ?? {};

    // Determine content: inline or pre-signed URL
    let content: string;
    if (subject.content) {
      content = subject.content as string;
    } else if (subject.preSignedUrl) {
      const response = await fetch(subject.preSignedUrl as string);
      if (!response.ok) throw new Error(`Failed to fetch pre-signed URL: ${response.status}`);
      content = await response.text();
    } else {
      throw new Error(`No content or preSignedUrl in ${ctx.eventType} event`);
    }

    // Trigger KB sync (side effect)
    await deps.bedrockAgent.send(new StartIngestionJobCommand({
      knowledgeBaseId: deps.kbId,
      dataSourceId: deps.kbDataSourceId,
    }));

    logger.info('KB sync triggered', { kbId: deps.kbId });

    // S3 write handled by the pipeline via store() intent
    const filingId = (subject.filingId ?? subject.id ?? Date.now()) as string;
    const key = `${ctx.eventType.toLowerCase()}/${filingId}.txt`;
    return store(content, { key });
  };

  return {
    SEC_PROSPECTUS_UPDATED: handleIngestion,
    SEC_10K_UPDATED: handleIngestion,
  };
};

// --- Production wiring ---

const KB_ID = requireEnv('KB_ID');
const KB_DATA_SOURCE_ID = requireEnv('KB_DATA_SOURCE_ID');

const bedrockAgent = new BedrockAgentClient({});

const deps: KbIngestionDeps = { bedrockAgent, kbId: KB_ID, kbDataSourceId: KB_DATA_SOURCE_ID };

export const handler = materializeToBucket({
  serviceName: 'portfolio-engine-ctrl-kb',
  handlers: createKbIngestionHandlers(deps),
  bucket: requireEnv('KB_BUCKET'),
});
