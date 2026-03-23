/* eslint-disable @typescript-eslint/no-explicit-any */
import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import {
  materializeToBucket, store,
  type EventPayload, type EventContext,
  requireEnv, logger,
  skip,
} from '@nestfolio/event-processor';

const SOURCE_PREFIX_MAP: Record<string, string> = {
  YAHOO_FINANCE_UPDATED: 'feeds/yahoo-finance',
  MARKETWATCH_UPDATED: 'feeds/marketwatch',
  SEC_8K_FILED: 'feeds/sec-8k',
  FRED_INDICATORS_UPDATED: 'feeds/fred-indicators',
  ALPHA_VANTAGE_NEWS_UPDATED: 'feeds/alpha-vantage-news',
};

export interface KbIngestionDeps {
  readonly bedrockAgent: BedrockAgentClient;
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

    const content = buildFeedContent(ctx.eventType, subject as Record<string, unknown>);

    // Trigger KB sync (side effect)
    await deps.bedrockAgent.send(new StartIngestionJobCommand({
      knowledgeBaseId: deps.kbId,
      dataSourceId: deps.kbDataSourceId,
    }));

    logger.info('KB sync triggered', { kbId: deps.kbId });

    // S3 write handled by the pipeline via store() intent
    const date = new Date().toISOString().slice(0, 10);
    const id = (subject.id as string) ?? `${Date.now()}`;
    const key = `${prefix}/${date}/${id}.txt`;
    return store(content, { key });
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

const KB_ID = requireEnv('KB_ID');
const KB_DATA_SOURCE_ID = requireEnv('KB_DATA_SOURCE_ID');

const bedrockAgent = new BedrockAgentClient({});

const deps: KbIngestionDeps = { bedrockAgent, kbId: KB_ID, kbDataSourceId: KB_DATA_SOURCE_ID };

export const handler = materializeToBucket({
  serviceName: 'market-intelligence-ctrl-kb',
  handlers: createKbIngestionHandlers(deps),
  bucket: requireEnv('KB_BUCKET'),
});
