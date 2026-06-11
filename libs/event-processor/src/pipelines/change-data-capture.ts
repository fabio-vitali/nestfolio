// Emission contract: AT-LEAST-ONCE.
//
// `detail.id` carries the DDB Stream `eventID`, which is stable per stream
// record but the same record can be delivered to the egress Lambda more than
// once: bisectBatchOnError + retryAttempts:3, shard rebalances under load,
// and Lambda transient throttling all republish previously-processed records.
// We do not dedup at egress — the platform contract is consumer-side
// idempotency via `record()`'s `attribute_not_exists(pk)`, which absorbs
// duplicate deliveries at write time on consumer tables. Tests asserting
// EB-layer at-most-once will flake under load.
import type { DynamoDBStreamEvent } from 'aws-lambda';
import type { PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import type { ZodTypeAny } from 'zod';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { EgestionEngine } from '../engine/egestion-engine';
import { EventBridgePublisher } from '../util/event-bridge-publisher';
import { getUUID, NotRetryableError } from '../internal';

type RuntimeFieldDispatch = {
  field: string;
  map: Record<string, string>;
  default?: string;
};

type RuntimePassthrough = {
  field: string;
  passthrough: true;
};

type RuntimeModifyEmission =
  | { always: string; onFieldChange?: Record<string, string> }
  | { always?: string; onFieldChange: Record<string, string> };

type RuntimeMapping = string | RuntimeFieldDispatch | RuntimePassthrough | RuntimeModifyEmission;
type RuntimeConfig = Record<string, RuntimeMapping>;

export interface ChangeDataCaptureConfig {
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last';
  };
  bus?: string;
  concurrency?: number;
  /**
   * Typed mode: presence of either `schemas` or `exemptTypenames` activates it.
   * - The completeness guard runs at init: every emitted `__typename` (from
   *   `EVENT_TYPE_MAP`) MUST be covered by a schema or listed in `exemptTypenames`.
   * - A covered `__typename` emits `schema.parse(record)` as its subject — DRY:
   *   the subject IS the contract (envelope/identity fields are dropped).
   * A bare call (neither field) is legacy mode: emits the fat row, no guard.
   */
  schemas?: Record<string, ZodTypeAny>;   // keyed by __typename → producer WS-1 contract
  exemptTypenames?: string[];             // emitted __typenames knowingly without a contract
}

type Emission = { eventType: string; previousSubject?: Record<string, unknown> };

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const arrB = b as unknown[];
    if (a.length !== arrB.length) return false;
    return a.every((v, i) => deepEqual(v, arrB[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  const bObj = b as Record<string, unknown>;
  return ka.every(k => k in bObj && deepEqual((a as Record<string, unknown>)[k], bObj[k]));
}

function resolveEmissions(
  record: StreamRecord,
  ctx: StreamContext,
  eventName: string,
  config: RuntimeConfig,
): Emission[] {
  const key = `${record.__typename}:${eventName}`;
  const mapping = config[key];
  if (!mapping) {
    throw new Error(`Event name resolution failed: unmapped CDC record ${key}`);
  }

  // Discriminant order assumes the CDK-side EventTypesMap → RuntimeMapping
  // serializer produces one shape per entry: string OR { passthrough } OR
  // { always } OR { map } (FieldDispatch). The variants share no overlapping
  // keys.
  if (typeof mapping === 'string') return [{ eventType: mapping }];

  if ('passthrough' in mapping) {
    const raw = (record as Record<string, unknown>)[mapping.field] as string;
    if (!raw) {
      throw new Error(`Event name resolution failed: passthrough field "${mapping.field}" is falsy for ${record.__typename}`);
    }
    // Strip composite-key suffix (e.g. 'BROKER_CIRCUIT_OPEN#2026-04-16T...' → 'BROKER_CIRCUIT_OPEN')
    const idx = raw.indexOf('#');
    return [{ eventType: idx > 0 ? raw.slice(0, idx) : raw }];
  }

  if ('always' in mapping || 'onFieldChange' in mapping) {
    const emissions: Emission[] = [];
    if ('always' in mapping && mapping.always) {
      emissions.push({ eventType: mapping.always });
    }
    if (mapping.onFieldChange && ctx.oldImage && ctx.newImage) {
      for (const [field, semanticType] of Object.entries(mapping.onFieldChange)) {
        const oldVal = ctx.oldImage[field];
        const newVal = ctx.newImage[field];
        if (!deepEqual(oldVal, newVal)) {
          emissions.push({ eventType: semanticType, previousSubject: ctx.oldImage });
        }
      }
    }
    return emissions;
  }

  // Field dispatch — empty array for unmapped values is intentional
  const value = (record as Record<string, unknown>)[mapping.field] as string;
  const eventType = mapping.map[value] ?? mapping.default ?? null;
  return eventType ? [{ eventType }] : [];
}

function buildSubject(record: StreamRecord, schemas?: Record<string, ZodTypeAny>): unknown {
  const schema = schemas?.[record.__typename];
  if (!schema) return record;                       // legacy / exempt → fat row
  try {
    return schema.parse(record);                    // DRY: subject IS the contract
  } catch (err) {
    throw new NotRetryableError(
      `publisher subject contract violation: ${record.__typename}`,
      { typename: record.__typename, issues: err instanceof Error ? err.message : String(err) },
    );
  }
}

function buildEntry(
  record: StreamRecord,
  ctx: StreamContext,
  emission: Emission,
  busName: string,
  serviceName: string,
  schemas?: Record<string, ZodTypeAny>,
): PutEventsRequestEntry {
  const detail: Record<string, unknown> = {
    id: ctx.record.eventID ?? getUUID(),
    type: emission.eventType,
    timestamp: new Date().toISOString(),
    subject: buildSubject(record, schemas),
    context: {
      tenantId: record.tenantId,
      userId: record.userId,
      region: record.region,
    },
  };
  // Old image shares the new image's __typename, so the same schema applies;
  // a missing __typename falls back to the fat old-image (defensive).
  if (emission.previousSubject) detail.previousSubject = buildSubject(emission.previousSubject as StreamRecord, schemas);

  // Tag CDC events from test tenants so other services' EB rules filter them out
  const isTestTenant = record.tenantId?.startsWith('integ-');
  const source = isTestTenant
    ? `integration-test:${serviceName}`
    : `${busName}@${serviceName}`;

  return {
    EventBusName: busName,
    Source: source,
    DetailType: emission.eventType,
    Detail: JSON.stringify(detail),
  };
}

export function changeDataCapture(
  config: ChangeDataCaptureConfig = {},
): (event: DynamoDBStreamEvent) => Promise<void> {
  const runtimeConfig: RuntimeConfig = JSON.parse(process.env.EVENT_TYPE_MAP!);
  const serviceName = process.env.SERVICE_NAME!;
  const busName = config.bus ?? process.env.BUS_NAME!;

  if (config.schemas || config.exemptTypenames) {
    const covered = new Set(Object.keys(config.schemas ?? {}));
    const exempt = new Set(config.exemptTypenames ?? []);
    const emitted = new Set(Object.keys(runtimeConfig).map((k) => k.split(':')[0]));
    const missing = [...emitted].filter((t) => !covered.has(t) && !exempt.has(t));
    if (missing.length > 0) {
      throw new Error(
        `changeDataCapture: emitted __typename(s) without a schema or exemption: ` +
        `${missing.join(', ')} (service ${serviceName})`,
      );
    }
  }

  const publisher = new EventBridgePublisher(busName, `${busName}@${serviceName}`);

  const processRecord = async (record: StreamRecord, ctx: StreamContext): Promise<void> => {
    const emissions = resolveEmissions(record, ctx, record.eventName, runtimeConfig);
    if (emissions.length === 0) return;
    const entries = emissions.map(em => buildEntry(record, ctx, em, busName, serviceName, config.schemas));
    await publisher.publish(entries);
  };

  const processGroup = async (_groupKey: string, records: StreamRecord[], ctx: StreamContext): Promise<void> => {
    const entries: PutEventsRequestEntry[] = [];
    for (const record of records) {
      const emissions = resolveEmissions(record, ctx, record.eventName, runtimeConfig);
      for (const em of emissions) {
        entries.push(buildEntry(record, ctx, em, busName, serviceName, config.schemas));
      }
    }
    if (entries.length > 0) {
      await publisher.publish(entries);
    }
  };

  if (config.groupBy) {
    const engine = new EgestionEngine({
      serviceName,
      groupBy: config.groupBy,
      processGroup,
      concurrency: config.concurrency,
      busName,
    });
    return (event: DynamoDBStreamEvent) => engine.process(event);
  }

  const engine = new EgestionEngine({
    serviceName,
    processRecord,
    concurrency: config.concurrency,
    busName,
  });
  return (event: DynamoDBStreamEvent) => engine.process(event);
}
