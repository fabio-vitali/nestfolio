/* eslint-disable @typescript-eslint/no-explicit-any */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import {
  createEventHandler, skip,
  type EventPayload, type EventContext,
  requireEnv, logger,
} from '@nestfolio/event-processor';

export interface KbIngestionDeps {
  readonly s3: S3Client;
  readonly bedrockAgent: BedrockAgentClient;
  readonly kbBucket: string;
  readonly kbId: string;
  readonly kbDataSourceId: string;
}

export const createKbIngestionHandlers = (deps: KbIngestionDeps) => {
  const handleIngestion = async (payload: EventPayload, ctx: EventContext) => {
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

    // Write to S3 with structured key
    const filingId = (subject.filingId ?? subject.id ?? Date.now()) as string;
    const key = `${ctx.eventType.toLowerCase()}/${filingId}.txt`;

    logger.info('Writing KB content to S3', { key, eventType: ctx.eventType });

    await deps.s3.send(new PutObjectCommand({
      Bucket: deps.kbBucket,
      Key: key,
      Body: content,
      ContentType: 'text/plain',
    }));

    // Trigger KB sync
    await deps.bedrockAgent.send(new StartIngestionJobCommand({
      knowledgeBaseId: deps.kbId,
      dataSourceId: deps.kbDataSourceId,
    }));

    logger.info('KB sync triggered', { kbId: deps.kbId });
    return skip();
  };

  return {
    SEC_PROSPECTUS_UPDATED: handleIngestion,
    SEC_10K_UPDATED: handleIngestion,
  };
};

// --- Production wiring ---

const KB_BUCKET = requireEnv('KB_BUCKET');
const KB_ID = requireEnv('KB_ID');
const KB_DATA_SOURCE_ID = requireEnv('KB_DATA_SOURCE_ID');
const TABLE_NAME = requireEnv('TABLE_NAME');
const BUS_NAME = requireEnv('BUS_NAME');

const s3 = new S3Client({});
const bedrockAgent = new BedrockAgentClient({});

const deps: KbIngestionDeps = { s3, bedrockAgent, kbBucket: KB_BUCKET, kbId: KB_ID, kbDataSourceId: KB_DATA_SOURCE_ID };

export const handler = createEventHandler({
  serviceName: 'portfolio-engine-ctrl-kb',
  handlers: createKbIngestionHandlers(deps),
  table: TABLE_NAME,
  bus: BUS_NAME,
  errorEventType: 'PORTFOLIO_ENGINE_KB_INGESTION_FAILED',
});
