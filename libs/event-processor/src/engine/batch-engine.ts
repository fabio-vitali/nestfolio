import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { parseRecord, isRetryable, traceEvent, extractTenantId, createServiceMetrics, publishErrorEvent } from '@nestfolio/lambda-utils';
import type { HandlerEntry } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import { normalizeHandler } from './normalize-handler';
import { IntentExecutor } from './intent-executor';
import { ErrorCollector } from './error-collector';
import { asyncPool } from '../util/async-pool';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_POISON_PILL_MAX = 5;

export interface BatchEngineConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  docClient: DynamoDBDocumentClient;
  tableName: string;
  busName?: string;
  concurrency?: number;
  poisonPillMaxReceiveCount?: number;
  errorEventType?: string;
}

export class BatchEngine {
  private readonly normalizedHandlers: Map<string, ReturnType<typeof normalizeHandler>>;
  private readonly intentExecutor: IntentExecutor;
  private readonly config: BatchEngineConfig;

  constructor(config: BatchEngineConfig) {
    this.config = config;
    this.intentExecutor = new IntentExecutor({ docClient: config.docClient, tableName: config.tableName });
    this.normalizedHandlers = new Map();
    for (const [eventType, entry] of Object.entries(config.handlers)) {
      this.normalizedHandlers.set(eventType, normalizeHandler(entry));
    }
  }

  async process(event: SQSEvent): Promise<SQSBatchResponse> {
    const startedAt = Date.now();
    const collector = new ErrorCollector();
    const concurrency = this.config.concurrency ?? DEFAULT_CONCURRENCY;
    const maxReceive = this.config.poisonPillMaxReceiveCount ?? DEFAULT_POISON_PILL_MAX;

    await asyncPool(
      event.Records,
      async (sqsRecord) => {
        const messageId = sqsRecord.messageId;
        const receiveCount = parseInt(sqsRecord.attributes?.ApproximateReceiveCount ?? '1', 10);

        // Poison pill check
        if (receiveCount > maxReceive) {
          collector.recordPoisonPill(messageId);
          return;
        }

        try {
          // Parse
          const uow = parseRecord(sqsRecord);
          const eventType = uow.event.type;

          // Context
          const tenantId = extractTenantId(uow.event);
          traceEvent(eventType, uow.event.id, tenantId);

          // Route
          const handler = this.normalizedHandlers.get(eventType);
          if (!handler) {
            collector.recordSkipped(messageId);
            return;
          }

          // Build context
          const ctx: EventContext = {
            eventId: uow.event.id,
            eventType,
            tenantId,
            userId: uow.event.context?.userId as string | undefined,
            timestamp: uow.event.timestamp,
            receiveCount,
            serviceName: this.config.serviceName,
            record: sqsRecord,
          };

          // Execute handler → intents
          const intents = await handler({ subject: uow.event.subject, context: uow.event.context }, ctx);

          // Execute intents
          let anyDeduplicated = false;
          for (const intent of intents) {
            const result = await this.intentExecutor.execute(intent, ctx);
            if (result.deduplicated) anyDeduplicated = true;
          }

          if (anyDeduplicated) {
            collector.recordDeduplicated(messageId, eventType);
          } else {
            collector.recordSuccess(messageId, eventType);
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          const retryable = isRetryable(err);
          collector.recordError(messageId, 'UNKNOWN', err, retryable);
        }
      },
      { concurrency },
    );

    const results = collector.getResults();

    // Publish non-retryable errors to bus
    if (results.droppedErrors.length > 0 && this.config.busName) {
      const errorType = this.config.errorEventType ?? `${this.config.serviceName.toUpperCase().replace(/-/g, '_')}_FAILED`;
      for (const { error } of results.droppedErrors) {
        await publishErrorEvent({ name: this.config.busName } as any, errorType, error);
      }
    }

    // BatchDuration metric
    results.metrics.BatchDuration = Date.now() - startedAt;

    return {
      batchItemFailures: results.batchItemFailures.map((id) => ({ itemIdentifier: id })),
    };
  }
}
