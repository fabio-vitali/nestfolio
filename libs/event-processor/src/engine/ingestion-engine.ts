import { isRetryable, traceEvent, extractRequestContext, logger } from '../internal';
import type { HandlerEntry } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import { normalizeHandler } from './normalize-handler';
import { IntentExecutor } from './intent-executor';
import { ErrorCollector } from './error-collector';
import { asyncPool } from '../util/async-pool';
import { ErrorEventPublisher } from './error-event-publisher';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { S3Client } from '@aws-sdk/client-s3';
import type { IngestionRecord, IngestionResult } from './ingestion-types';

const DEFAULT_CONCURRENCY = 5;

export interface IngestionEngineConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  docClient: DynamoDBDocumentClient;
  tableName: string;
  busName?: string;
  concurrency?: number;
  errorEventType?: string;
  s3Client?: S3Client;
  bucket?: string;
}

export class IngestionEngine {
  private readonly normalizedHandlers: Map<string, ReturnType<typeof normalizeHandler>>;
  private readonly intentExecutor: IntentExecutor;
  private readonly errorPublisher?: ErrorEventPublisher;
  private readonly config: IngestionEngineConfig;

  constructor(config: IngestionEngineConfig) {
    this.config = config;
    this.intentExecutor = new IntentExecutor({
      docClient: config.docClient,
      tableName: config.tableName,
      s3Client: config.s3Client,
      bucket: config.bucket,
    });
    if (config.busName) {
      this.errorPublisher = new ErrorEventPublisher(config.busName, config.serviceName);
    }
    this.normalizedHandlers = new Map();
    for (const [eventType, entry] of Object.entries(config.handlers)) {
      this.normalizedHandlers.set(eventType, normalizeHandler(entry));
    }
  }

  async process(records: IngestionRecord[]): Promise<IngestionResult> {
    const startedAt = Date.now();
    const collector = new ErrorCollector();
    const concurrency = this.config.concurrency ?? DEFAULT_CONCURRENCY;

    await asyncPool(
      records,
      async (ingestionRecord) => {
        const { id, event, metadata } = ingestionRecord;
        let parsedPayload: unknown;

        try {
          const eventType = event.type;
          parsedPayload = { type: event.type, subject: event.subject, id: event.id };

          const reqCtx = extractRequestContext(event);
          traceEvent(eventType, event.id, reqCtx.tenantId, reqCtx.userId);

          // Route
          const handler = this.normalizedHandlers.get(eventType);
          if (!handler) {
            collector.recordSkipped(id);
            return;
          }

          // Build context (EventContext extends RequestContext — no duplication)
          const ctx: EventContext = {
            ...reqCtx,
            eventId: event.id,
            eventType,
            timestamp: event.timestamp,
            receiveCount: metadata.receiveCount,
            serviceName: this.config.serviceName,
            record: ingestionRecord,
          };

          // Execute handler → intents
          const intents = await handler({ subject: event.subject as Record<string, unknown>, context: event.context as Record<string, unknown> }, ctx);

          // Execute intents
          let anyDeduplicated = false;
          logger.info('intents produced', { count: intents.length, tags: intents.map((i) => i._tag) });
          for (const intent of intents) {
            logger.info('executing intent', { tag: intent._tag, table: this.config.tableName });
            const result = await this.intentExecutor.execute(intent, ctx);
            logger.info('intent result', { tag: result._tag, success: result.success, deduplicated: result.deduplicated });
            if (result.deduplicated) anyDeduplicated = true;
          }

          if (anyDeduplicated) {
            collector.recordDeduplicated(id, eventType);
          } else {
            collector.recordSuccess(id, eventType);
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          const retryable = isRetryable(err);
          // Surface the failure on the same Lambda log stream as the
          // upstream "executing intent" line. Without this log the catch
          // is invisible — a record() that throws on a marshalling error
          // (e.g. undefined value) leaves only an "executing intent" line
          // followed by the wrapper's "completed" line, producing the
          // illusion of a successful no-op write while CDC never fires.
          logger.error('record processing failed', {
            eventId: ingestionRecord.event.id,
            eventType: ingestionRecord.event.type,
            errorName: err.name,
            errorMessage: err.message,
            retryable,
          });
          collector.recordError(id, err, retryable, parsedPayload);
        }
      },
      { concurrency },
    );

    const results = collector.getResults();

    // Publish non-retryable errors to bus
    if (results.droppedErrors.length > 0 && this.errorPublisher) {
      const errorType =
        this.config.errorEventType ??
        `${this.config.serviceName.toUpperCase().replace(/-/g, '_')}_FAILED`;
      await this.errorPublisher.publishErrors(
        results.droppedErrors.map(({ error, causedBy }) => ({ error, causedBy })),
        errorType,
      );
    }

    // BatchDuration metric
    results.metrics.BatchDuration = Date.now() - startedAt;

    return {
      failures: results.batchItemFailures,
      metrics: results.metrics,
      droppedErrors: results.droppedErrors,
    };
  }
}
