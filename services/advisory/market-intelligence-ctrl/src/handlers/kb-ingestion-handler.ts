/* eslint-disable @typescript-eslint/no-explicit-any */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import {
  createEventHandler, skip,
  type EventPayload, type EventContext,
  requireEnv, logger,
} from '@nestfolio/event-processor';

const SOURCE_PREFIX_MAP: Record<string, string> = {
  YAHOO_FINANCE_UPDATED: 'feeds/yahoo-finance',
  MARKETWATCH_UPDATED: 'feeds/marketwatch',
  SEC_8K_FILED: 'feeds/sec-8k',
  FRED_INDICATORS_UPDATED: 'feeds/fred-indicators',
  ALPHA_VANTAGE_NEWS_UPDATED: 'feeds/alpha-vantage-news',
};

export interface KbIngestionDeps {
  readonly s3: S3Client;
  readonly bedrockAgent: BedrockAgentClient;
  readonly kbBucket: string;
  readonly kbId: string;
  readonly kbDataSourceId: string;
}

function buildFeedContent(eventType: string, subject: Record<string, unknown>): string {
  const articles = (subject.articles as any[]) ?? [];
  const source = subject.source as string ?? eventType;
  const lines = articles.map((a: any) => `${a.title ?? 'Untitled'}: ${a.description ?? ''}`);
  return `Source: ${source}\n\n${lines.join('\n\n')}`;
}

export const createKbIngestionHandlers = (deps: KbIngestionDeps) => {
  const handleIngestion = async (payload: EventPayload, ctx: EventContext) => {
    const subject = payload.subject ?? {};
    const prefix = SOURCE_PREFIX_MAP[ctx.eventType];
    if (!prefix) {
      logger.warn('Unknown feed event type', { eventType: ctx.eventType });
      return skip();
    }

    const date = new Date().toISOString().slice(0, 10);
    const id = (subject.id as string) ?? `${Date.now()}`;
    const key = `${prefix}/${date}/${id}.txt`;
    const content = buildFeedContent(ctx.eventType, subject as Record<string, unknown>);

    logger.info('Writing KB feed content to S3', { key, eventType: ctx.eventType });

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
    YAHOO_FINANCE_UPDATED: handleIngestion,
    MARKETWATCH_UPDATED: handleIngestion,
    SEC_8K_FILED: handleIngestion,
    FRED_INDICATORS_UPDATED: handleIngestion,
    ALPHA_VANTAGE_NEWS_UPDATED: handleIngestion,
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
  serviceName: 'market-intelligence-ctrl-kb',
  handlers: createKbIngestionHandlers(deps),
  table: TABLE_NAME,
  bus: BUS_NAME,
  errorEventType: 'MARKET_INTELLIGENCE_KB_INGESTION_FAILED',
});
