import type { WriteIntent } from '../types/write-intent';
import type { EventPayload, HandlerEntry } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import type { SQSRecord, DynamoDBRecord } from 'aws-lambda';
import { normalizeHandler } from '../engine/normalize-handler';
import { unmarshalStream } from '../util/unmarshal-stream';
import { groupBy as groupByUtil } from '../util/group-by';
import { isRetryable } from '../internal';
import { asTenantId, asUserId } from '../platform/types/branded';

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
      const deduplicated = 0;
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
            tenantId: asTenantId(tenantId),
            userId: asUserId(event.context?.userId ?? 'test-user'),
            region: event.context?.region ?? 'us-east-1',
            eventId: event.id,
            eventType,
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

// --- Stream Test Harnesses ---

export interface StreamTestResult {
  processed: number;
  filtered: number;
  errors: Array<{ groupKey?: string; error: Error; retryable: boolean }>;
  thrown: boolean;
  metrics: Record<string, number>;
}

export interface CdcTestResult extends StreamTestResult {
  publishedEvents: Array<{
    eventType: string;
    subject: Record<string, unknown>;
    context: Record<string, unknown>;
  }>;
}

export interface ReducerTestResult<S> extends StreamTestResult {
  snapshots: Map<string, { state: S; version: number; lastEventSequence: number }>;
  dailyCheckpoints: Map<string, S>;
  queriedGroups: string[];
}

interface StreamTestConfig {
  serviceName: string;
  processRecord?: (record: StreamRecord, ctx: StreamContext) => Promise<void>;
  processGroup?: (groupKey: string, records: StreamRecord[], ctx: StreamContext) => Promise<void>;
  groupBy?: { key: (record: StreamRecord) => string; pick?: 'first' | 'last' | 'all' };
  filter?: (record: StreamRecord) => boolean;
}

export function createStreamTestHarness(config: StreamTestConfig) {
  return {
    async process(records: DynamoDBRecord[]): Promise<StreamTestResult> {
      let processed = 0;
      let filtered = 0;
      const errors: StreamTestResult['errors'] = [];

      const parsed = records
        .map((r) => unmarshalStream(r, config.serviceName))
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const afterFilter = config.filter
        ? parsed.filter((p) => {
            const pass = config.filter!(p.streamRecord);
            if (!pass) filtered++;
            return pass;
          })
        : parsed;

      if (config.groupBy && config.processGroup) {
        const pick = config.groupBy.pick ?? 'all';
        const groupConfig = { key: (p: typeof afterFilter[number]) => config.groupBy!.key(p.streamRecord), pick } as
          | { key: (p: typeof afterFilter[number]) => string; pick: 'all' }
          | { key: (p: typeof afterFilter[number]) => string; pick: 'first' | 'last' };
        const groups = groupByUtil(afterFilter, groupConfig as { key: (p: typeof afterFilter[number]) => string; pick: 'all' });

        for (const [groupKey, items] of groups.entries()) {
          const recs = Array.isArray(items) ? items : [items];
          try {
            await config.processGroup(groupKey, recs.map((r) => r.streamRecord), recs[0].ctx);
            processed++;
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            errors.push({ groupKey, error: err, retryable: isRetryable(err) });
          }
        }
      } else if (config.processRecord) {
        for (const { streamRecord, ctx } of afterFilter) {
          try {
            await config.processRecord(streamRecord, ctx);
            processed++;
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            errors.push({ error: err, retryable: isRetryable(err) });
          }
        }
      }

      const thrown = errors.some((e) => e.retryable);

      return { processed, filtered, errors, thrown, metrics: {} };
    },
  };
}

export function createCdcTestHarness(config: {
  serviceName: string;
  eventTypeMap: Record<string, string | ((record: StreamRecord) => string)>;
  groupBy?: { key: (record: StreamRecord) => string; pick?: 'first' | 'last' };
}) {
  return {
    async process(records: DynamoDBRecord[]): Promise<CdcTestResult> {
      const publishedEvents: CdcTestResult['publishedEvents'] = [];
      let processed = 0;
      const filtered = 0;
      const errors: StreamTestResult['errors'] = [];

      const parsed = records
        .map((r) => unmarshalStream(r, config.serviceName))
        .filter((r): r is NonNullable<typeof r> => r !== null);

      // Group or process individually
      const items = config.groupBy
        ? (() => {
            const groups = groupByUtil(parsed, {
              key: (p) => config.groupBy!.key(p.streamRecord),
              pick: config.groupBy.pick ?? 'last',
            });
            return Array.from(groups.values()).map((v) => (Array.isArray(v) ? v[v.length - 1] : v));
          })()
        : parsed;

      for (const { streamRecord, ctx } of items) {
        const key = `${streamRecord.__typename}:${ctx.eventName}`;
        const resolver = config.eventTypeMap[key];
        if (!resolver) continue;

        const eventType = typeof resolver === 'function' ? resolver(streamRecord) : resolver;
        const subject = streamRecord as unknown as Record<string, unknown>;

        publishedEvents.push({
          eventType,
          subject,
          context: { tenantId: streamRecord.tenantId },
        });
        processed++;
      }

      return { processed, filtered, errors, thrown: false, metrics: {}, publishedEvents };
    },
  };
}

export function createReducerTestHarness<S>(config: {
  serviceName: string;
  filter?: (record: StreamRecord) => boolean;
  groupBy: { key: (record: StreamRecord) => string };
  reducer: (state: S, event: Record<string, unknown>) => S;
  initialState: S | (() => S);
  snapshot: { key: (groupKey: string) => { pk: string; sk: string }; daily?: boolean };
}) {
  const seededSnapshots = new Map<string, { state: S; version: number; lastSeq: number }>();
  const seededEvents = new Map<string, Record<string, unknown>[]>();

  return {
    seedSnapshot(groupKey: string, state: S, version: number, lastSeq: number): void {
      seededSnapshots.set(groupKey, { state, version, lastSeq });
    },

    seedEvents(groupKey: string, events: Record<string, unknown>[]): void {
      seededEvents.set(groupKey, events);
    },

    async process(records: DynamoDBRecord[]): Promise<ReducerTestResult<S>> {
      const snapshots = new Map<string, { state: S; version: number; lastEventSequence: number }>();
      const dailyCheckpoints = new Map<string, S>();
      const queriedGroups: string[] = [];
      let processed = 0;
      let filtered = 0;
      const errors: StreamTestResult['errors'] = [];

      const parsed = records
        .map((r) => unmarshalStream(r, config.serviceName))
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const afterFilter = config.filter
        ? parsed.filter((p) => {
            const pass = config.filter!(p.streamRecord);
            if (!pass) filtered++;
            return pass;
          })
        : parsed;

      if (afterFilter.length === 0) {
        return { processed, filtered, errors, thrown: false, metrics: {}, snapshots, dailyCheckpoints, queriedGroups };
      }

      const groups = groupByUtil(afterFilter, { key: (p) => config.groupBy.key(p.streamRecord) });

      for (const [groupKey] of groups.entries()) {
        try {
          queriedGroups.push(groupKey);
          const seeded = seededSnapshots.get(groupKey);
          const currentState = seeded?.state
            ?? (typeof config.initialState === 'function' ? (config.initialState as () => S)() : config.initialState);
          const lastSeq = seeded?.lastSeq ?? 0;
          const currentVersion = seeded?.version ?? 0;

          const events = seededEvents.get(groupKey) ?? [];
          const sorted = [...events].sort((a, b) => ((a.sequenceNo as number) ?? 0) - ((b.sequenceNo as number) ?? 0));

          const nextState = sorted.reduce((s, e) => config.reducer(s, e), currentState);
          const maxSeq = sorted.reduce((max, e) => Math.max(max, (e.sequenceNo as number) ?? 0), lastSeq);

          snapshots.set(groupKey, {
            state: nextState,
            version: currentVersion + 1,
            lastEventSequence: maxSeq,
          });

          if (config.snapshot.daily) {
            const today = new Date().toISOString().slice(0, 10);
            dailyCheckpoints.set(`${groupKey}#${today}`, nextState);
          }

          processed++;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          errors.push({ groupKey, error: err, retryable: true });
        }
      }

      const thrown = errors.some((e) => e.retryable);
      return { processed, filtered, errors, thrown, metrics: {}, snapshots, dailyCheckpoints, queriedGroups };
    },
  };
}
