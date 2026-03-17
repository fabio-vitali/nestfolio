/* eslint-disable @typescript-eslint/no-explicit-any */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
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

    logger.info('Writing KB content to S3', { key, eventType: ctx.eventType });

    await deps.s3.send(new PutObjectCommand({
      Bucket: deps.kbBucket,
      Key: key,
      Body: content,
      ContentType: 'text/plain',
    }));

    await deps.bedrockAgent.send(new StartIngestionJobCommand({
      knowledgeBaseId: deps.kbId,
      dataSourceId: deps.kbDataSourceId,
    }));

    logger.info('KB sync triggered', { kbId: deps.kbId });
    return skip();
  };

  return {
    DECISION_BLOCKED: handleIngestion,
    DECISION_APPROVED: handleIngestion,
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
  serviceName: 'investor-profile-ctrl-kb',
  handlers: createKbIngestionHandlers(deps),
  table: TABLE_NAME,
  bus: BUS_NAME,
  errorEventType: 'INVESTOR_PROFILE_KB_INGESTION_FAILED',
});
