import type { WriteIntent } from '../types/write-intent';
import type { EventPayload, HandlerEntry } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import type { SQSRecord } from 'aws-lambda';
import { normalizeHandler } from '../engine/normalize-handler';

export interface TestHarnessConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  poisonPill?: { maxReceiveCount: number };
}

export interface TestResult {
  intents: WriteIntent[];
  metrics: Record<string, number>;
  errors: Array<{ messageId: string; error: Error; retryable: boolean }>;
  batchItemFailures: string[];
  deduplicated: number;
  poisonPills: number;
  skipped: number;
}

export function createTestHarness(config: TestHarnessConfig) {
  const normalizedHandlers = new Map<string, ReturnType<typeof normalizeHandler>>();
  for (const [eventType, entry] of Object.entries(config.handlers)) {
    normalizedHandlers.set(eventType, normalizeHandler(entry));
  }

  return {
    async process(records: SQSRecord[]): Promise<TestResult> {
      const intents: WriteIntent[] = [];
      const errors: Array<{ messageId: string; error: Error; retryable: boolean }> = [];
      const batchItemFailures: string[] = [];
      let poisonPills = 0;
      let skipped = 0;
      let deduplicated = 0;
      const metrics: Record<string, number> = {
        EventProcessed: 0,
        EventFailed: 0,
        EventDeduplicated: 0,
        EventDropped: 0,
        PoisonPillDetected: 0,
        EventSkipped: 0,
        BatchSize: 0,
      };

      const maxReceive = config.poisonPill?.maxReceiveCount ?? 5;

      for (const sqsRecord of records) {
        metrics.BatchSize++;
        const messageId = sqsRecord.messageId;
        const receiveCount = parseInt(sqsRecord.attributes?.ApproximateReceiveCount ?? '1', 10);

        if (receiveCount > maxReceive) {
          poisonPills++;
          metrics.PoisonPillDetected++;
          continue;
        }

        try {
          const body = JSON.parse(sqsRecord.body);
          const event = body.detail ?? body;
          const eventType = event.type;
          const tenantId = event.context?.tenantId ?? 'test-tenant';

          const handler = normalizedHandlers.get(eventType);
          if (!handler) {
            skipped++;
            metrics.EventSkipped++;
            continue;
          }

          const ctx: EventContext = {
            eventId: event.id,
            eventType,
            tenantId,
            userId: event.context?.userId,
            timestamp: event.timestamp,
            receiveCount,
            serviceName: config.serviceName,
            record: sqsRecord,
          };

          const payload: EventPayload = { subject: event.subject, context: event.context };
          const result = await handler(payload, ctx);
          intents.push(...result);
          metrics.EventProcessed++;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          errors.push({ messageId, error: err, retryable: true });
          batchItemFailures.push(messageId);
          metrics.EventFailed++;
        }
      }

      return { intents, metrics, errors, batchItemFailures, deduplicated, poisonPills, skipped };
    },
  };
}
