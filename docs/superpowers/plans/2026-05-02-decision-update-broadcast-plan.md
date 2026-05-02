# Decision-update broadcast pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate Steps 9-10 e2e flakiness in `new-investor-happy-path.spec.ts` by shipping a backend-driven WSS push for `DecisionReadModel.status` changes — generalising the pattern as two new `event-processor` pipelines so it's reusable across the system.

**Architecture:** Two new pipelines (`broadcastFromStream`, `broadcastFromQueue`) + a shared SigV4 helper in `libs/event-processor`. advisory-bff gains a new `DecisionPublisher` Lambda that broadcasts on DDB-stream MODIFY events; the schema gains a tenant-filtered `publishDecisionUpdate` IAM mutation wired into `onDecisionUpdate`. dashboard-bff and investor-bff migrate their existing AppSync IAM publisher patterns to the new pipelines (closes the rule-of-three duplication). advisory-mfe attaches the subscription before issuing queries (R1) and version-guards against stale frames.

**Tech Stack:** TypeScript, AWS CDK, AWS Lambda, AWS AppSync (GraphQL + JS resolvers), DynamoDB Streams, SQS, EventBridge, Vitest, Angular (signal store + Apollo), Playwright.

**Spec:** `docs/superpowers/specs/2026-05-02-decision-update-broadcast-design.md`.

**Validation gate:** `pnpm nx run nestfolio-e2e:e2e` against deployed dev — `new-investor-happy-path.spec.ts` reaches Step 11 in 5 consecutive runs. **No POM changes ship** (per `feedback_e2e_ui_assertions_only.md`).

---

## Phase 1 — Library: `event-processor` broadcast primitives

### Task 1: Shared SigV4 helper — `postAppSyncMutation`

**Files:**
- Create: `libs/event-processor/src/shared/post-appsync-mutation.ts`
- Create: `libs/event-processor/test/shared/post-appsync-mutation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/event-processor/test/shared/post-appsync-mutation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postAppSyncMutation } from '../../src/shared/post-appsync-mutation';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: () => async () => ({
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  }),
}));

describe('postAppSyncMutation', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { ok: true } }),
    });
  });

  it('signs the request with SigV4 (Authorization + X-Amz-Date headers present)', async () => {
    await postAppSyncMutation({
      appsyncUrl: 'https://abc.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
      mutation: 'mutation Foo { foo }',
      variables: {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('warns and returns when appsyncUrl is empty (no fetch call)', async () => {
    await postAppSyncMutation({
      appsyncUrl: '',
      region: 'us-east-1',
      mutation: 'mutation Foo { foo }',
      variables: {},
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs and skips on HTTP non-2xx (no throw)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(postAppSyncMutation({
      appsyncUrl: 'https://abc.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
      mutation: 'mutation Foo { foo }',
      variables: {},
    })).resolves.toBeUndefined();
  });

  it('logs and skips on GraphQL errors[] (no throw)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errors: [{ message: 'boom' }] }),
    });
    await expect(postAppSyncMutation({
      appsyncUrl: 'https://abc.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
      mutation: 'mutation Foo { foo }',
      variables: {},
    })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run event-processor:test --testPathPatterns=post-appsync-mutation`
Expected: FAIL with `Cannot find module '../../src/shared/post-appsync-mutation'`.

- [ ] **Step 3: Implement the helper**

Create `libs/event-processor/src/shared/post-appsync-mutation.ts`:

```ts
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { logger } from '../internal';

export interface PostAppSyncMutationArgs {
  appsyncUrl: string;
  region?: string;
  mutation: string;
  variables: Record<string, unknown>;
}

/**
 * SigV4-signed POST to AppSync. Used by broadcast pipelines to fire
 * @aws_iam-protected mutations that trigger @aws_subscribe broadcasts.
 *
 * Behavior contract (matches dashboard-publisher precedent shipped 2026-04-30):
 * - Missing appsyncUrl: warn + return (no throw).
 * - HTTP non-2xx: log + return (no throw).
 * - GraphQL errors[]: log + return (no throw).
 *
 * Broadcast loss is non-fatal — the engine's at-least-once retry budget
 * is reserved for genuinely transient failures, not silent broadcast drops.
 */
export async function postAppSyncMutation(args: PostAppSyncMutationArgs): Promise<void> {
  const { appsyncUrl, region = 'us-east-1', mutation, variables } = args;
  if (!appsyncUrl) {
    logger.warn('postAppSyncMutation: appsyncUrl empty — skipping');
    return;
  }

  const url = new URL(appsyncUrl);
  const body = JSON.stringify({ query: mutation, variables });

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service: 'appsync',
    sha256: Sha256,
  });

  const signed = await signer.sign({
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    protocol: url.protocol,
    headers: { 'Content-Type': 'application/json', host: url.hostname },
    body,
  });

  const response = await fetch(appsyncUrl, {
    method: 'POST',
    headers: signed.headers as Record<string, string>,
    body,
  });

  if (!response.ok) {
    logger.error('postAppSyncMutation: HTTP failure', { status: response.status });
    return;
  }
  const json = (await response.json()) as { errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    logger.error('postAppSyncMutation: GraphQL errors', { errors: json.errors });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run event-processor:test --testPathPatterns=post-appsync-mutation`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/shared/post-appsync-mutation.ts libs/event-processor/test/shared/post-appsync-mutation.test.ts
git commit -m "feat(event-processor): add postAppSyncMutation shared SigV4 helper"
```

---

### Task 2: `broadcastFromStream` pipeline

**Files:**
- Create: `libs/event-processor/src/pipelines/broadcast-from-stream.ts`
- Create: `libs/event-processor/test/pipelines/broadcast-from-stream.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/event-processor/test/pipelines/broadcast-from-stream.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DynamoDBStreamEvent } from 'aws-lambda';

const postAppSyncMutation = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/shared/post-appsync-mutation', () => ({ postAppSyncMutation }));

import { broadcastFromStream } from '../../src/pipelines/broadcast-from-stream';

const MUTATION = 'mutation PublishX($id: ID!) { publishX(id: $id) { id } }';

function makeEvent(records: Array<{
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  newImage?: Record<string, unknown>;
  oldImage?: Record<string, unknown>;
}>): DynamoDBStreamEvent {
  const marshall = (item: Record<string, unknown>): Record<string, { S?: string; N?: string; L?: unknown[] }> => {
    const out: Record<string, { S?: string; N?: string; L?: unknown[] }> = {};
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === 'string') out[k] = { S: v };
      else if (typeof v === 'number') out[k] = { N: String(v) };
      else if (Array.isArray(v)) out[k] = { L: [] };
    }
    return out;
  };
  return {
    Records: records.map((r, i) => ({
      eventID: `evt-${i}`,
      eventName: r.eventName,
      eventSource: 'aws:dynamodb',
      dynamodb: {
        ...(r.newImage ? { NewImage: marshall(r.newImage) } : {}),
        ...(r.oldImage ? { OldImage: marshall(r.oldImage) } : {}),
      },
    })),
  } as unknown as DynamoDBStreamEvent;
}

describe('broadcastFromStream', () => {
  beforeEach(() => postAppSyncMutation.mockReset().mockResolvedValue(undefined));

  it('broadcasts on INSERT for matched typename (skipInsert default false)', async () => {
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Foo: {
          mutation: MUTATION,
          mapImage: (img) => ({ id: img.id }),
        },
      },
    });
    await handler(makeEvent([{ eventName: 'INSERT', newImage: { sk: 'Foo', id: 'a' } }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledWith(expect.objectContaining({
      mutation: MUTATION, variables: { id: 'a' },
    }));
  });

  it('skips INSERT when skipInsert true', async () => {
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Foo: { mutation: MUTATION, skipInsert: true, mapImage: (img) => ({ id: img.id }) },
      },
    });
    await handler(makeEvent([{ eventName: 'INSERT', newImage: { sk: 'Foo', id: 'a' } }]), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('skips MODIFY when no whenChanged field changed', async () => {
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Foo: { mutation: MUTATION, whenChanged: ['status'], mapImage: (img) => ({ id: img.id }) },
      },
    });
    await handler(makeEvent([{
      eventName: 'MODIFY',
      oldImage: { sk: 'Foo', id: 'a', status: 'X', other: 'p' },
      newImage: { sk: 'Foo', id: 'a', status: 'X', other: 'q' },
    }]), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('broadcasts MODIFY when a whenChanged field changes', async () => {
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Foo: { mutation: MUTATION, whenChanged: ['status'], mapImage: (img) => ({ id: img.id }) },
      },
    });
    await handler(makeEvent([{
      eventName: 'MODIFY',
      oldImage: { sk: 'Foo', id: 'a', status: 'X' },
      newImage: { sk: 'Foo', id: 'a', status: 'Y' },
    }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
  });

  it('skips records with unmatched typename', async () => {
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: { Foo: { mutation: MUTATION, mapImage: () => ({}) } },
    });
    await handler(makeEvent([{ eventName: 'INSERT', newImage: { sk: 'Bar', id: 'x' } }]), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('shouldBroadcast escape hatch overrides whenChanged', async () => {
    const shouldBroadcast = vi.fn().mockReturnValue(true);
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Foo: {
          mutation: MUTATION,
          whenChanged: ['status'],
          shouldBroadcast,
          mapImage: (img) => ({ id: img.id }),
        },
      },
    });
    // status unchanged but predicate returns true
    await handler(makeEvent([{
      eventName: 'MODIFY',
      oldImage: { sk: 'Foo', id: 'a', status: 'X' },
      newImage: { sk: 'Foo', id: 'a', status: 'X' },
    }]), {} as never, () => {});
    expect(shouldBroadcast).toHaveBeenCalledTimes(1);
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run event-processor:test --testPathPatterns=broadcast-from-stream`
Expected: FAIL with `Cannot find module '../../src/pipelines/broadcast-from-stream'`.

- [ ] **Step 3: Implement the pipeline**

Create `libs/event-processor/src/pipelines/broadcast-from-stream.ts`:

```ts
import type { DynamoDBStreamEvent, DynamoDBStreamHandler, DynamoDBRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { logger } from '../internal';
import { postAppSyncMutation } from '../shared/post-appsync-mutation';

export interface StreamBroadcastEntry {
  /** GraphQL mutation source string. */
  mutation: string;
  /**
   * Field list. Broadcast iff strict equality differs on at least one field
   * between OldImage and NewImage. Arrays/objects always compare unequal
   * (different references after unmarshall) — over-broadcasts on collections,
   * which is the safer default. Use shouldBroadcast for value-equality.
   */
  whenChanged?: string[];
  /** Optional escape hatch — supplied predicate overrides whenChanged. */
  shouldBroadcast?: (
    newImage: Record<string, unknown>,
    oldImage: Record<string, unknown> | undefined,
    eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  ) => boolean;
  /** Default false — INSERT events broadcast. */
  skipInsert?: boolean;
  /** Builds mutation variables from the new image. */
  mapImage: (newImage: Record<string, unknown>) => Record<string, unknown>;
}

export interface BroadcastFromStreamConfig {
  serviceName: string;
  appsyncUrl: string;
  region?: string;
  /** Keyed by the row's `sk` (or `__typename` if your stream uses it). */
  broadcasts: Record<string, StreamBroadcastEntry>;
}

export function broadcastFromStream(config: BroadcastFromStreamConfig): DynamoDBStreamHandler {
  return async (event: DynamoDBStreamEvent): Promise<void> => {
    for (const record of event.Records) {
      try {
        await processRecord(record, config);
      } catch (err) {
        logger.error('broadcast-from-stream: record failed', {
          serviceName: config.serviceName,
          eventID: record.eventID,
          err: (err as Error).message,
        });
        // At-least-once: rethrow so the engine can surface for retry.
        throw err;
      }
    }
  };
}

async function processRecord(
  record: DynamoDBRecord,
  config: BroadcastFromStreamConfig,
): Promise<void> {
  const eventName = record.eventName as 'INSERT' | 'MODIFY' | 'REMOVE' | undefined;
  if (!eventName || eventName === 'REMOVE') return;

  const newImageRaw = record.dynamodb?.NewImage as Record<string, AttributeValue> | undefined;
  const oldImageRaw = record.dynamodb?.OldImage as Record<string, AttributeValue> | undefined;
  if (!newImageRaw) return;

  const newImage = unmarshall(newImageRaw);
  const oldImage = oldImageRaw ? unmarshall(oldImageRaw) : undefined;

  const typename = String(newImage.sk ?? newImage.__typename ?? '');
  const entry = config.broadcasts[typename];
  if (!entry) return;

  if (eventName === 'INSERT' && entry.skipInsert) return;

  if (entry.shouldBroadcast) {
    if (!entry.shouldBroadcast(newImage, oldImage, eventName)) return;
  } else if (eventName === 'MODIFY' && entry.whenChanged) {
    const changed = entry.whenChanged.some((f) => oldImage?.[f] !== newImage[f]);
    if (!changed) return;
  }

  const variables = entry.mapImage(newImage);
  logger.info('broadcast-from-stream: firing', {
    serviceName: config.serviceName,
    pipelineName: 'broadcast-from-stream',
    eventID: record.eventID,
    typename,
    eventName,
  });
  await postAppSyncMutation({
    appsyncUrl: config.appsyncUrl,
    region: config.region,
    mutation: entry.mutation,
    variables,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run event-processor:test --testPathPatterns=broadcast-from-stream`
Expected: PASS — 6/6.

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/pipelines/broadcast-from-stream.ts libs/event-processor/test/pipelines/broadcast-from-stream.test.ts
git commit -m "feat(event-processor): add broadcastFromStream pipeline"
```

---

### Task 3: `broadcastFromQueue` pipeline

**Files:**
- Create: `libs/event-processor/src/pipelines/broadcast-from-queue.ts`
- Create: `libs/event-processor/test/pipelines/broadcast-from-queue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/event-processor/test/pipelines/broadcast-from-queue.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQSEvent } from 'aws-lambda';

const postAppSyncMutation = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/shared/post-appsync-mutation', () => ({ postAppSyncMutation }));

import { broadcastFromQueue } from '../../src/pipelines/broadcast-from-queue';

const MUTATION = 'mutation PublishX($id: ID!) { publishX(id: $id) { id } }';

function makeSqsEvent(events: Array<{ type: string; subject: Record<string, unknown> }>): SQSEvent {
  return {
    Records: events.map((e, i) => ({
      messageId: `m-${i}`,
      receiptHandle: `r-${i}`,
      body: JSON.stringify({
        id: `evt-${i}`,
        type: e.type,
        timestamp: '2026-05-02T00:00:00Z',
        subject: e.subject,
        context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
      }),
      attributes: {} as never,
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: '',
      awsRegion: 'us-east-1',
    })),
  } as SQSEvent;
}

describe('broadcastFromQueue', () => {
  beforeEach(() => postAppSyncMutation.mockReset().mockResolvedValue(undefined));

  it('broadcasts a single mutation when mapPayload returns an object', async () => {
    const handler = broadcastFromQueue({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        FOO_HAPPENED: {
          mutation: MUTATION,
          mapPayload: (payload) => ({ id: (payload.subject as { id: string }).id }),
        },
      },
    });
    const result = await handler(makeSqsEvent([{ type: 'FOO_HAPPENED', subject: { id: 'a' } }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    expect(postAppSyncMutation).toHaveBeenCalledWith(expect.objectContaining({ variables: { id: 'a' } }));
    expect(result?.batchItemFailures ?? []).toEqual([]);
  });

  it('broadcasts N mutations when mapPayload returns an array (fan-out)', async () => {
    const handler = broadcastFromQueue({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        FAN_OUT: {
          mutation: MUTATION,
          mapPayload: () => [
            { id: 'a' },
            { id: 'b' },
            { id: 'c' },
          ],
        },
      },
    });
    await handler(makeSqsEvent([{ type: 'FAN_OUT', subject: {} }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(3);
    expect(postAppSyncMutation).toHaveBeenNthCalledWith(1, expect.objectContaining({ variables: { id: 'a' } }));
    expect(postAppSyncMutation).toHaveBeenNthCalledWith(2, expect.objectContaining({ variables: { id: 'b' } }));
    expect(postAppSyncMutation).toHaveBeenNthCalledWith(3, expect.objectContaining({ variables: { id: 'c' } }));
  });

  it('skips events with unconfigured types', async () => {
    const handler = broadcastFromQueue({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: { FOO: { mutation: MUTATION, mapPayload: () => ({}) } },
    });
    await handler(makeSqsEvent([{ type: 'BAR', subject: {} }]), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('reports batch item failure when a record throws', async () => {
    postAppSyncMutation.mockRejectedValueOnce(new Error('boom'));
    const handler = broadcastFromQueue({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: { FOO: { mutation: MUTATION, mapPayload: () => ({ id: 'a' }) } },
    });
    const result = await handler(makeSqsEvent([{ type: 'FOO', subject: {} }]), {} as never, () => {});
    expect(result?.batchItemFailures.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run event-processor:test --testPathPatterns=broadcast-from-queue`
Expected: FAIL with `Cannot find module '../../src/pipelines/broadcast-from-queue'`.

- [ ] **Step 3: Implement the pipeline**

Create `libs/event-processor/src/pipelines/broadcast-from-queue.ts`:

```ts
import type { SQSEvent, SQSHandler, SQSBatchResponse, SQSBatchItemFailure, SQSRecord } from 'aws-lambda';
import { logger } from '../internal';
import type { EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import { postAppSyncMutation } from '../shared/post-appsync-mutation';

export interface QueueBroadcastEntry {
  mutation: string;
  /**
   * Returns either a single variables object (one mutation per event) or an
   * array (multiple mutations per event — e.g. one inbound BROKER_CIRCUIT_OPEN
   * fans out to three feature-flag mutations).
   */
  mapPayload: (
    payload: EventPayload,
    ctx: EventContext,
  ) => Record<string, unknown> | Record<string, unknown>[];
}

export interface BroadcastFromQueueConfig {
  serviceName: string;
  appsyncUrl: string;
  region?: string;
  /** Keyed by event detail-type. */
  broadcasts: Record<string, QueueBroadcastEntry>;
}

export function broadcastFromQueue(config: BroadcastFromQueueConfig): SQSHandler {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: SQSBatchItemFailure[] = [];
    for (const record of event.Records) {
      try {
        await processSqsRecord(record, config);
      } catch (err) {
        logger.error('broadcast-from-queue: record failed', {
          serviceName: config.serviceName,
          messageId: record.messageId,
          err: (err as Error).message,
        });
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

async function processSqsRecord(
  record: SQSRecord,
  config: BroadcastFromQueueConfig,
): Promise<void> {
  const envelope = JSON.parse(record.body) as {
    id?: string;
    type: string;
    timestamp?: string;
    subject?: Record<string, unknown>;
    context?: EventContext;
  };

  const entry = config.broadcasts[envelope.type];
  if (!entry) return;

  const payload: EventPayload = {
    subject: envelope.subject ?? {},
    timestamp: envelope.timestamp,
  } as EventPayload;
  const ctx = (envelope.context ?? {}) as EventContext;

  const result = entry.mapPayload(payload, ctx);
  const calls = Array.isArray(result) ? result : [result];

  for (const variables of calls) {
    logger.info('broadcast-from-queue: firing', {
      serviceName: config.serviceName,
      pipelineName: 'broadcast-from-queue',
      eventId: envelope.id,
      type: envelope.type,
    });
    await postAppSyncMutation({
      appsyncUrl: config.appsyncUrl,
      region: config.region,
      mutation: entry.mutation,
      variables,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run event-processor:test --testPathPatterns=broadcast-from-queue`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/pipelines/broadcast-from-queue.ts libs/event-processor/test/pipelines/broadcast-from-queue.test.ts
git commit -m "feat(event-processor): add broadcastFromQueue pipeline"
```

---

### Task 4: Export from public index

**Files:**
- Modify: `libs/event-processor/src/pipelines/index.ts`
- Modify: `libs/event-processor/src/index.ts`

- [ ] **Step 1: Add exports to pipelines index**

Edit `libs/event-processor/src/pipelines/index.ts` — append at the bottom:

```ts
export { broadcastFromStream } from './broadcast-from-stream';
export type { BroadcastFromStreamConfig, StreamBroadcastEntry } from './broadcast-from-stream';
export { broadcastFromQueue } from './broadcast-from-queue';
export type { BroadcastFromQueueConfig, QueueBroadcastEntry } from './broadcast-from-queue';
```

- [ ] **Step 2: Add the shared helper to the public surface**

Open `libs/event-processor/src/index.ts`. After the existing exports, append:

```ts
export { postAppSyncMutation } from './shared/post-appsync-mutation';
export type { PostAppSyncMutationArgs } from './shared/post-appsync-mutation';
```

If `index.ts` re-exports from `./pipelines` via a single statement, the pipeline exports are picked up automatically. If it re-exports each name explicitly, add the four new names there too.

- [ ] **Step 3: Run lib build + full lib tests**

Run: `pnpm nx run event-processor:build && pnpm nx run event-processor:test`
Expected: build OK; all event-processor tests PASS (existing + new).

- [ ] **Step 4: Commit**

```bash
git add libs/event-processor/src/pipelines/index.ts libs/event-processor/src/index.ts
git commit -m "chore(event-processor): export broadcast pipelines from public surface"
```

---

## Phase 2 — advisory-bff: schema, resolver, publisher Lambda, stack wiring

### Task 5: Schema — `publishDecisionUpdate` mutation + `tenantId` filter on `onDecisionUpdate`

**Files:**
- Modify: `services/advisory/advisory-bff/src/schema.graphql`

- [ ] **Step 1: Replace the `Subscription` block and append the mutation + input**

Edit `services/advisory/advisory-bff/src/schema.graphql`. Replace the current subscription block:

```graphql
type Subscription {
  onDecisionUpdate: DecisionPacket!
  @aws_subscribe(mutations: ["confirmDecision", "rejectDecision"])
}
```

with:

```graphql
type Subscription {
  onDecisionUpdate(tenantId: ID!): DecisionPacket!
  @aws_subscribe(mutations: ["confirmDecision", "rejectDecision", "publishDecisionUpdate"])
  @aws_cognito_user_pools
  @aws_iam
}
```

In the `Mutation` block, append:

```graphql
  publishDecisionUpdate(
    decisionId: ID!
    tenantId: ID!
    status: DecisionStatus!
    explanation: String!
    proposedTrades: [ProposedTradeInput!]!
    version: Int!
    updatedAt: String!
  ): DecisionPacket! @aws_iam
```

After the `ProposedTrade` type definition, add:

```graphql
input ProposedTradeInput {
  symbol: String!
  assetClass: String!
  side: TradeSide!
  quantityOrAmountCents: Int!
  targetWeightPercent: Float!
  rationale: String!
}
```

- [ ] **Step 2: Run schema-validation-adjacent tests**

Run: `pnpm nx run advisory-bff:test`
Expected: existing tests PASS (no test depends on subscription having no args yet — if any do, they'll be updated when their owning code is updated in later tasks).

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-bff/src/schema.graphql
git commit -m "feat(advisory-bff): add publishDecisionUpdate mutation + tenantId filter on onDecisionUpdate"
```

---

### Task 6: JS resolver — `publish-decision-update.fn.js` (echo)

**Files:**
- Create: `services/advisory/advisory-bff/src/graphql/js-function/publish-decision-update.fn.js`

- [ ] **Step 1: Create the resolver**

Create `services/advisory/advisory-bff/src/graphql/js-function/publish-decision-update.fn.js`:

```js
// IAM-only echo resolver. No DDB access — this mutation is a pure broadcast
// vehicle for the @aws_subscribe filter on onDecisionUpdate. AppSync's
// filter-arg matching compares the subscriber's tenantId argument against
// fields in the mutation RESPONSE — so this resolver echoes ALL arguments
// back unchanged to make the response carry tenantId (and every other field
// the client fragment selects).
//
// Schema: see services/advisory/advisory-bff/src/schema.graphql — the
// mutation is annotated @aws_iam, so only the DecisionPublisher Lambda can
// invoke it via SigV4-signed POST.
export function request(_ctx) {
  return { payload: null };
}

export function response(ctx) {
  // Provide schema-required defaults for fields that are non-null in
  // DecisionPacket but not arguments to publishDecisionUpdate (e.g.,
  // confirmationRequired, complianceChecks, agentInvocations, trigger,
  // createdAt). The subscriber doesn't depend on these for filtering or
  // for the version-guarded store update — they're carried for type safety.
  const args = ctx.arguments;
  return {
    decisionId: args.decisionId,
    tenantId: args.tenantId,
    status: args.status,
    explanation: args.explanation,
    proposedTrades: args.proposedTrades,
    version: args.version,
    updatedAt: args.updatedAt,
    trigger: 'BROADCAST',
    confirmationRequired: false,
    complianceChecks: [],
    agentInvocations: [],
    confirmedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    createdAt: args.updatedAt,
  };
}
```

- [ ] **Step 2: Run advisory-bff tests**

Run: `pnpm nx run advisory-bff:test`
Expected: PASS — `discoverJsResolvers` picks up the new file at synth time, runtime tests don't exercise it yet.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-bff/src/graphql/js-function/publish-decision-update.fn.js
git commit -m "feat(advisory-bff): add publish-decision-update JS resolver (echo)"
```

---

### Task 7: `decision-publisher.ts` Lambda handler

**Files:**
- Create: `services/advisory/advisory-bff/src/handlers/decision-publisher.ts`
- Create: `services/advisory/advisory-bff/test/unit/handlers/decision-publisher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/advisory/advisory-bff/test/unit/handlers/decision-publisher.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DynamoDBStreamEvent } from 'aws-lambda';

const postAppSyncMutation = vi.fn().mockResolvedValue(undefined);
vi.mock('@nestfolio/event-processor', async () => {
  const actual = await vi.importActual<typeof import('@nestfolio/event-processor')>('@nestfolio/event-processor');
  return { ...actual, postAppSyncMutation };
});

process.env.APPSYNC_URL = 'https://x.example/graphql';
process.env.AWS_REGION = 'us-east-1';

import { handler } from '../../../src/handlers/decision-publisher';

function streamEvent(record: {
  eventName: 'INSERT' | 'MODIFY';
  newImage: Record<string, unknown>;
  oldImage?: Record<string, unknown>;
}): DynamoDBStreamEvent {
  const m = (item: Record<string, unknown>) => {
    const out: Record<string, { S?: string; N?: string; L?: unknown[] }> = {};
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === 'string') out[k] = { S: v };
      else if (typeof v === 'number') out[k] = { N: String(v) };
      else if (Array.isArray(v)) out[k] = { L: [] };
    }
    return out;
  };
  return {
    Records: [{
      eventID: 'evt-1',
      eventName: record.eventName,
      eventSource: 'aws:dynamodb',
      dynamodb: {
        NewImage: m(record.newImage),
        ...(record.oldImage ? { OldImage: m(record.oldImage) } : {}),
      },
    }],
  } as unknown as DynamoDBStreamEvent;
}

describe('decision-publisher', () => {
  beforeEach(() => postAppSyncMutation.mockReset().mockResolvedValue(undefined));

  it('broadcasts when DecisionReadModel.status flips to AWAITING_CONFIRMATION', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'PENDING', explanation: '', version: 1 },
      newImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'AWAITING_CONFIRMATION', explanation: 'rationale', version: 2, updatedAt: '2026-05-02T00:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = postAppSyncMutation.mock.calls[0][0];
    expect(call.variables).toMatchObject({
      decisionId: 'd1', tenantId: 't1', status: 'AWAITING_CONFIRMATION',
      explanation: 'rationale', version: 2,
    });
  });

  it('skips MODIFY when no UI-relevant field changed', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'PENDING', explanation: '', version: 1, taskToken: 'a' },
      newImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'PENDING', explanation: '', version: 1, taskToken: 'b' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('broadcasts on INSERT (initial materialisation visible to early subscribers)', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'PENDING', explanation: '', version: 1, updatedAt: '2026-05-02T00:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
  });

  it('skips records with sk other than DecisionReadModel', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { sk: 'UserConfirmation', decisionId: 'd1', tenantId: 't1' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run advisory-bff:test --testPathPatterns=decision-publisher`
Expected: FAIL with `Cannot find module '../../../src/handlers/decision-publisher'`.

- [ ] **Step 3: Implement the handler**

Create `services/advisory/advisory-bff/src/handlers/decision-publisher.ts`:

```ts
import { broadcastFromStream } from '@nestfolio/event-processor';

const PUBLISH_DECISION_UPDATE = `
  mutation PublishDecisionUpdate(
    $decisionId: ID!
    $tenantId: ID!
    $status: DecisionStatus!
    $explanation: String!
    $proposedTrades: [ProposedTradeInput!]!
    $version: Int!
    $updatedAt: String!
  ) {
    publishDecisionUpdate(
      decisionId: $decisionId
      tenantId: $tenantId
      status: $status
      explanation: $explanation
      proposedTrades: $proposedTrades
      version: $version
      updatedAt: $updatedAt
    ) {
      decisionId
      tenantId
      status
      explanation
      proposedTrades { symbol assetClass side quantityOrAmountCents targetWeightPercent rationale }
      version
      updatedAt
    }
  }
`;

export const handler = broadcastFromStream({
  serviceName: 'advisory-bff',
  appsyncUrl: process.env.APPSYNC_URL ?? '',
  region: process.env.AWS_REGION,
  broadcasts: {
    DecisionReadModel: {
      mutation: PUBLISH_DECISION_UPDATE,
      // skipInsert default false — initial PENDING state lands at clients that
      // subscribed before the SF advanced to AWAITING_CONFIRMATION. Defence
      // against subscribe-before-write race; downstream version-guard in MFE
      // dedupes if the same image arrives via getDecision query.
      whenChanged: ['status', 'explanation', 'proposedTrades', 'version'],
      mapImage: (item) => ({
        decisionId: String(item.decisionId ?? ''),
        tenantId: String(item.tenantId ?? ''),
        status: String(item.status ?? 'PENDING'),
        explanation: String(item.explanation ?? ''),
        proposedTrades: Array.isArray(item.proposedTrades) ? item.proposedTrades : [],
        version: Number(item.version ?? 0),
        updatedAt: String(item.updatedAt ?? new Date().toISOString()),
      }),
    },
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run advisory-bff:test --testPathPatterns=decision-publisher`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-bff/src/handlers/decision-publisher.ts services/advisory/advisory-bff/test/unit/handlers/decision-publisher.test.ts
git commit -m "feat(advisory-bff): add DecisionPublisher Lambda for WSS broadcast on status change"
```

---

### Task 8: Service stack — `enableIamAuth`, DecisionPublisher Lambda, IAM grant

**Files:**
- Modify: `services/advisory/advisory-bff/src/service.stack.ts`

- [ ] **Step 1: Apply the stack changes**

Open `services/advisory/advisory-bff/src/service.stack.ts`. Apply these edits:

Add imports at the top (alongside the existing imports):

```ts
import { join } from 'path';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
```

Replace the `new Facade(...)` block with one that enables IAM auth (keep the rest of its config intact):

```ts
    const facade = new Facade(this, 'Facade', {
      state,
      enableIamAuth: true,
      userPoolSsmPath: `/nestfolio/${this.prefix}-investor/auth/userPoolId`,
      jsResolvers: discoverJsResolvers(__dirname, {
        noneDataSource: ['publishDecisionUpdate'],
        preSteps: {
          confirmDecision: ['get-decision-readback.fn.js'],
          rejectDecision: ['get-decision-readback.fn.js'],
        },
        extraSteps: {
          confirmDecision: ['get-decision-readback.fn.js'],
          rejectDecision: ['get-decision-readback.fn.js'],
        },
      }),
    });
```

Note the bare `new Facade(...)` becomes `const facade = new Facade(...)` so we can reference `facade.api.arn` and `facade.graphqlUrl` below.

After the `new MfeBucket(...)` line, before `this.addObservability(...)`, add:

```ts
    const decisionPublisher = new NodejsFunction(this, 'DecisionPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'decision-publisher.ts'),
      environment: facade.graphqlUrl ? { APPSYNC_URL: facade.graphqlUrl } : {},
    });
    decisionPublisher.addEventSource(
      new DynamoEventSource(state.getTable(), {
        startingPosition: StartingPosition.LATEST,
        retryAttempts: 3,
      }),
    );
    if (facade.api) {
      decisionPublisher.addToRolePolicy(new PolicyStatement({
        actions: ['appsync:GraphQL'],
        resources: [`${facade.api.arn}/*`],
      }));
    }
```

Update the final observability call to include the new function:

```ts
    this.addObservability({ ingress, egress, lambdas: { decisionPublisher } });
```

(If `addObservability`'s signature differs, append `decisionPublisher` to whatever map it expects — refer to `services/investor/dashboard-bff/src/service.stack.ts:73` for the existing precedent.)

- [ ] **Step 2: Run stack synth + service tests**

Run: `pnpm nx run advisory-bff:test`
Expected: PASS — all tests, including any `service.stack.test.ts` snapshot updates if they exist.

If snapshot tests fail because of the new construct, run with update flag once and inspect:
```bash
pnpm nx run advisory-bff:test -u
```
Verify the diff is *only* the new function + IAM grant + `enableIamAuth: true`.

Run synth to confirm CDK compiles:
```bash
pnpm nx run advisory-bff:synth
```
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-bff/src/service.stack.ts services/advisory/advisory-bff/test/
git commit -m "feat(advisory-bff): wire DecisionPublisher Lambda + enable IAM auth on Facade"
```

---

### Task 9: Integration test — `DECISION_PACKET_UPDATED → publishDecisionUpdate fired`

**Files:**
- Create: `services/advisory/advisory-bff/test/integration/decision-broadcast.integration.test.ts`

- [ ] **Step 1: Locate existing integration test patterns**

Run: `ls services/advisory/advisory-bff/test/integration/`
Read one existing file (e.g., `advisory-bff.integration.test.ts` if present) to see how the integration harness boots advisory-bff in this repo and how AppSync mutation calls are mocked. Match that style.

- [ ] **Step 2: Write the integration test**

Create `services/advisory/advisory-bff/test/integration/decision-broadcast.integration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Spy on postAppSyncMutation so we can assert the broadcast fires with the
// expected variables when an inbound USER_CONFIRMATION_REQUESTED transitions
// the DecisionReadModel.status via the existing decisionStatusChanged
// transform → DDB write → DDB stream → DecisionPublisher Lambda chain.
const postAppSyncMutation = vi.fn().mockResolvedValue(undefined);
vi.mock('@nestfolio/event-processor', async () => {
  const actual = await vi.importActual<typeof import('@nestfolio/event-processor')>('@nestfolio/event-processor');
  return { ...actual, postAppSyncMutation };
});

// Bring up a local DDB + run the ingress + egress lambdas in-process. Replace
// this block with whatever IntegrationContext / setup helper this repo uses
// (refer to services/advisory/advisory-bff/test/integration/*.integration.test.ts
// for the precedent).
import { IntegrationContext } from '@nestfolio/test-support';

describe('decision-broadcast integration', () => {
  let ctx: IntegrationContext;

  beforeEach(async () => {
    postAppSyncMutation.mockReset().mockResolvedValue(undefined);
    ctx = await IntegrationContext.boot({ service: 'advisory-bff' });
  });

  it('fires publishDecisionUpdate when USER_CONFIRMATION_REQUESTED arrives', async () => {
    // Seed an existing DecisionReadModel at status=PENDING so the next
    // status-change transform issues a MODIFY (not an INSERT skipped by the
    // initial PENDING placeholder).
    const tenantId = 't-int-1';
    const decisionId = 'd-int-1';

    await ctx.publish('DECISION_PACKET_CREATED', {
      tenantId, decisionId, version: 1,
    });
    await ctx.flushPipeline();
    await ctx.publish('USER_CONFIRMATION_REQUESTED', {
      tenantId, decisionId, taskToken: 'tok-x', version: 2,
    });
    await ctx.flushPipeline();

    expect(postAppSyncMutation).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        decisionId, tenantId,
        status: 'AWAITING_CONFIRMATION',
      }),
    }));
  });

  it('does not fire publishDecisionUpdate when only taskToken changes (whenChanged guard)', async () => {
    const tenantId = 't-int-2';
    const decisionId = 'd-int-2';
    await ctx.publish('DECISION_PACKET_CREATED', { tenantId, decisionId, version: 1 });
    await ctx.flushPipeline();
    postAppSyncMutation.mockReset();

    // A sibling event that only updates taskToken without changing status
    // (synthetic — model the case where two USER_CONFIRMATION_REQUESTED
    // events with identical status but different tokens land back-to-back).
    await ctx.publishWithFields('USER_CONFIRMATION_REQUESTED', {
      tenantId, decisionId, taskToken: 'tok-y', version: 1, // same version → no status flip
    });
    await ctx.flushPipeline();

    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });
});
```

If `IntegrationContext` / `publishWithFields` aren't the exact harness names in this repo, adapt to whatever the existing integration tests use. The asserting shape is what matters.

- [ ] **Step 3: Run integration tests**

Run: `pnpm nx run advisory-bff:test-integration`
Expected: PASS — 2/2.

If the harness API differs, adjust the test until it passes — the assertion shape (`postAppSyncMutation` is called with the right variables on transition; not called when no UI-field changes) is the contract.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/advisory-bff/test/integration/decision-broadcast.integration.test.ts
git commit -m "test(advisory-bff): integration coverage for decision-update broadcast"
```

---

## Phase 3 — dashboard-bff: migrate to `broadcastFromStream`

### Task 10: Replace inline `callAppSyncMutation` with the pipeline

**Files:**
- Modify: `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts`
- Modify: `services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts` (path may differ — match the actual file location)

- [ ] **Step 1: Read existing test to understand assertion shape**

Read `services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts` (or wherever the test lives). Note which behaviour it asserts — the migration must not break those assertions.

- [ ] **Step 2: Update existing tests to spy on `postAppSyncMutation`**

If the existing test mocks `fetch` (the inline path), switch to mocking `postAppSyncMutation` from `@nestfolio/event-processor`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DynamoDBStreamEvent } from 'aws-lambda';

const postAppSyncMutation = vi.fn().mockResolvedValue(undefined);
vi.mock('@nestfolio/event-processor', async () => {
  const actual = await vi.importActual<typeof import('@nestfolio/event-processor')>('@nestfolio/event-processor');
  return { ...actual, postAppSyncMutation };
});

process.env.APPSYNC_URL = 'https://x.example/graphql';
process.env.AWS_REGION = 'us-east-1';

import { handler } from '../../../src/handlers/dashboard-publisher';

describe('dashboard-publisher (post-migration)', () => {
  beforeEach(() => postAppSyncMutation.mockReset().mockResolvedValue(undefined));

  it('broadcasts publishDashboardUpdate when AdvisoryStatus row changes', async () => {
    // Use a DDB-stream-event factory matching the existing test style.
    // The expected mutation variables are unchanged from pre-migration.
    // … existing assertion adapted to call postAppSyncMutation instead of fetch.
  });

  it('skips records whose sk is not AdvisoryStatus', async () => {
    // … unchanged behaviour from pre-migration.
  });
});
```

Preserve the existing test cases — only change the mock target and the assertion (`fetch` → `postAppSyncMutation`).

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm nx run dashboard-bff:test --testPathPatterns=dashboard-publisher`
Expected: FAIL — handler still calls `fetch` directly, mock on `postAppSyncMutation` never trips.

- [ ] **Step 4: Migrate the handler**

Replace the entire body of `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` with:

```ts
import { broadcastFromStream } from '@nestfolio/event-processor';

const PUBLISH_DASHBOARD_UPDATE = `
  mutation PublishDashboardUpdate($tenantId: ID!, $advisoryStatus: AdvisoryStatusInput) {
    publishDashboardUpdate(tenantId: $tenantId, advisoryStatus: $advisoryStatus) {
      tenantId
      advisoryStatus {
        pendingDecisionsCount
        lastRecommendationAt
        lastDecisionStatus
        updatedAt
      }
    }
  }
`;

export const handler = broadcastFromStream({
  serviceName: 'dashboard-bff',
  appsyncUrl: process.env.APPSYNC_URL ?? '',
  region: process.env.AWS_REGION,
  broadcasts: {
    AdvisoryStatus: {
      mutation: PUBLISH_DASHBOARD_UPDATE,
      // skipInsert false — first AdvisoryStatus materialisation also
      // broadcasts (matches pre-migration semantics: handler fired on both
      // INSERT and MODIFY).
      whenChanged: ['pendingDecisionsCount', 'lastRecommendationAt', 'lastDecisionStatus'],
      mapImage: (item) => {
        const tenantId = String(item.pk ?? '').slice(2); // 'T#<tenantId>' → '<tenantId>'
        return {
          tenantId,
          advisoryStatus: {
            pendingDecisionsCount: Number(item.pendingDecisionsCount ?? 0),
            lastRecommendationAt: item.lastRecommendationAt ?? null,
            lastDecisionStatus: item.lastDecisionStatus ?? null,
            updatedAt: String(item.updatedAt ?? new Date().toISOString()),
          },
        };
      },
    },
  },
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm nx run dashboard-bff:test`
Expected: PASS — all dashboard-bff tests, including the migrated dashboard-publisher tests.

Run synth:
```bash
pnpm nx run dashboard-bff:synth
```
Expected: success — service.stack.ts is unchanged.

- [ ] **Step 6: Commit**

```bash
git add services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts services/investor/dashboard-bff/test/
git commit -m "refactor(dashboard-bff): migrate dashboard-publisher to broadcastFromStream pipeline"
```

---

## Phase 4 — investor-bff: Lambda split

### Task 11: New `broadcast-listener.ts` handler with `broadcastFromQueue`

**Files:**
- Create: `services/investor/investor-bff/src/handlers/broadcast-listener.ts`
- Create: `services/investor/investor-bff/test/unit/handlers/broadcast-listener.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/investor/investor-bff/test/unit/handlers/broadcast-listener.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQSEvent } from 'aws-lambda';

const postAppSyncMutation = vi.fn().mockResolvedValue(undefined);
vi.mock('@nestfolio/event-processor', async () => {
  const actual = await vi.importActual<typeof import('@nestfolio/event-processor')>('@nestfolio/event-processor');
  return { ...actual, postAppSyncMutation };
});

process.env.APPSYNC_URL = 'https://x.example/graphql';
process.env.AWS_REGION = 'us-east-1';

import { handler } from '../../../src/handlers/broadcast-listener';

function sqsEvent(events: Array<{ type: string; subject: Record<string, unknown> }>): SQSEvent {
  return {
    Records: events.map((e, i) => ({
      messageId: `m-${i}`,
      receiptHandle: `r-${i}`,
      body: JSON.stringify({
        id: `evt-${i}`,
        type: e.type,
        timestamp: '2026-05-02T00:00:00Z',
        subject: e.subject,
        context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
      }),
      attributes: {} as never,
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: '',
      awsRegion: 'us-east-1',
    })),
  } as SQSEvent;
}

describe('broadcast-listener', () => {
  beforeEach(() => postAppSyncMutation.mockReset().mockResolvedValue(undefined));

  it('on BROKER_CIRCUIT_OPEN fires updateFeatureFlag for the 3 gated flags (disabled)', async () => {
    await handler(sqsEvent([{ type: 'BROKER_CIRCUIT_OPEN', subject: {} }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(3);
    const flags = postAppSyncMutation.mock.calls.map((c) => c[0].variables);
    expect(flags).toEqual([
      { name: 'confirmDecision', enabled: false, reason: 'Broker connectivity issue' },
      { name: 'initiateDeposit', enabled: false, reason: 'Broker connectivity issue' },
      { name: 'requestWithdrawal', enabled: false, reason: 'Broker connectivity issue' },
    ]);
  });

  it('on BROKER_CIRCUIT_CLOSED fires updateFeatureFlag for the 3 gated flags (enabled)', async () => {
    await handler(sqsEvent([{ type: 'BROKER_CIRCUIT_CLOSED', subject: {} }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(3);
    const flags = postAppSyncMutation.mock.calls.map((c) => c[0].variables);
    expect(flags).toEqual([
      { name: 'confirmDecision', enabled: true },
      { name: 'initiateDeposit', enabled: true },
      { name: 'requestWithdrawal', enabled: true },
    ]);
  });

  it('on DEPOSIT_DETECTED fires publishDepositEvent with the inbound subject', async () => {
    await handler(sqsEvent([{
      type: 'DEPOSIT_DETECTED',
      subject: {
        tenantId: 't1', userId: 'u1', depositId: 'dep-1',
        amountCents: 500000, currency: 'EUR',
      },
    }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    expect(postAppSyncMutation.mock.calls[0][0].variables).toMatchObject({
      input: {
        depositId: 'dep-1', tenantId: 't1', userId: 'u1',
        status: 'DETECTED', amountCents: 500000, currency: 'EUR',
      },
    });
  });

  it('skips events with unconfigured types', async () => {
    await handler(sqsEvent([{ type: 'BALANCE_UPDATED', subject: {} }]), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run investor-bff:test --testPathPatterns=broadcast-listener`
Expected: FAIL with `Cannot find module '../../../src/handlers/broadcast-listener'`.

- [ ] **Step 3: Implement the handler**

Create `services/investor/investor-bff/src/handlers/broadcast-listener.ts`:

```ts
import { broadcastFromQueue, type EventPayload } from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '../domain/events';
import { InvestorIngestEventTypes } from '@nestfolio/investor-adpt/domain';

const UPDATE_FEATURE_FLAG = `
  mutation UpdateFeatureFlag($name: String!, $enabled: Boolean!, $reason: String) {
    updateFeatureFlag(name: $name, enabled: $enabled, reason: $reason) {
      name enabled reason updatedAt
    }
  }
`;

const PUBLISH_DEPOSIT_EVENT = `
  mutation PublishDepositEvent($input: DepositEventInput!) {
    publishDepositEvent(input: $input) {
      depositId tenantId userId status amountCents currency occurredAt reason
    }
  }
`;

const GATED_FLAGS = ['confirmDecision', 'initiateDeposit', 'requestWithdrawal'] as const;

export const handler = broadcastFromQueue({
  serviceName: 'investor-bff',
  appsyncUrl: process.env.APPSYNC_URL ?? '',
  region: process.env.AWS_REGION,
  broadcasts: {
    [InvestorBffEventTypes.BROKER_CIRCUIT_OPEN]: {
      mutation: UPDATE_FEATURE_FLAG,
      mapPayload: () => GATED_FLAGS.map((name) => ({
        name,
        enabled: false,
        reason: 'Broker connectivity issue',
      })),
    },
    [InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED]: {
      mutation: UPDATE_FEATURE_FLAG,
      mapPayload: () => GATED_FLAGS.map((name) => ({
        name,
        enabled: true,
      })),
    },
    [InvestorIngestEventTypes.DEPOSIT_DETECTED]: {
      mutation: PUBLISH_DEPOSIT_EVENT,
      mapPayload: (payload: EventPayload) => {
        const subject = payload.subject as {
          tenantId: string;
          userId: string;
          depositId: string;
          amountCents: number;
          currency: string;
        };
        const occurredAt = (payload as { occurredAt?: string }).occurredAt
          ?? payload.timestamp
          ?? new Date().toISOString();
        return {
          input: {
            depositId: subject.depositId,
            tenantId: subject.tenantId,
            userId: subject.userId,
            status: 'DETECTED',
            amountCents: subject.amountCents,
            currency: subject.currency,
            occurredAt,
            reason: null,
          },
        };
      },
    },
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run investor-bff:test --testPathPatterns=broadcast-listener`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/handlers/broadcast-listener.ts services/investor/investor-bff/test/unit/handlers/broadcast-listener.test.ts
git commit -m "feat(investor-bff): add broadcast-listener handler (broadcastFromQueue)"
```

---

### Task 12: Stack — add `BroadcastIngress`, drop broadcast event types from existing `Ingress`

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts`
- Modify (if exists): `services/investor/investor-bff/test/unit/service.stack.test.ts`

- [ ] **Step 1: Update stack to add second Ingress + drop overlapping event types from primary Ingress**

Open `services/investor/investor-bff/src/service.stack.ts`. Locate the existing `new Ingress(this, 'Ingress', { ... eventTypes: [...] })`.

Remove from the existing primary Ingress's `eventTypes` array these three entries:
- `InvestorBffEventTypes.BROKER_CIRCUIT_OPEN`
- `InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED`
- `InvestorIngestEventTypes.DEPOSIT_DETECTED`

After the existing Ingress declaration, add the second Ingress + IAM grants:

```ts
    const broadcastIngress = new Ingress(this, 'BroadcastIngress', {
      state,
      handler: 'broadcast-listener.ts',
      eventTypes: [
        InvestorBffEventTypes.BROKER_CIRCUIT_OPEN,
        InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED,
        InvestorIngestEventTypes.DEPOSIT_DETECTED,
      ],
    });
    if (facade.graphqlUrl) {
      broadcastIngress.lambda.addEnvironment('APPSYNC_URL', facade.graphqlUrl);
    }
    if (facade.api) {
      broadcastIngress.lambda.addToRolePolicy(new PolicyStatement({
        actions: ['appsync:GraphQL'],
        resources: [`${facade.api.arn}/*`],
      }));
    }
```

(If `Ingress` doesn't expose a `handler:` prop, refer to how `decision-workflow-ctrl/src/service.stack.ts` declares its dual `TriggerIngress`/`CallbackIngress` — match the same overload pattern. The original `Ingress` likely defaults to `event-listener.ts`; the second Ingress must point at `broadcast-listener.ts` somehow — either via a `handler:` prop, an `entry:` prop, or by passing a `NodejsFunction` directly. Use whatever the existing dual-Ingress precedent uses.)

Update `addObservability` to include the new ingress:

```ts
    this.addObservability({ ingress, broadcastIngress, egress });
```

(Match the actual signature.)

- [ ] **Step 2: Update / create stack test asserting both Ingress constructs exist**

If `service.stack.test.ts` exists, add an assertion:

```ts
it('provisions a second BroadcastIngress for AppSync mutation broadcasts', () => {
  // Match against CDK template - exact assertion style depends on existing tests.
  // Look for: a second SQS queue + Lambda function whose Environment includes APPSYNC_URL,
  // and whose IAM role has the appsync:GraphQL permission.
  expect(template.findResources('AWS::SQS::Queue').length).toBeGreaterThanOrEqual(2);
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: { Variables: Match.objectLike({ APPSYNC_URL: Match.anyValue() }) },
  });
});
```

If no `service.stack.test.ts` exists, skip this step. Coverage will come from synth + integration.

- [ ] **Step 3: Run synth + tests**

Run: `pnpm nx run investor-bff:synth && pnpm nx run investor-bff:test`
Expected: synth succeeds; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add services/investor/investor-bff/src/service.stack.ts services/investor/investor-bff/test/
git commit -m "feat(investor-bff): split broadcast handlers into BroadcastIngress + Lambda"
```

---

### Task 13: Drop broadcast handlers + SigV4 helper from `event-listener.ts`

**Files:**
- Modify: `services/investor/investor-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-bff/test/unit/handlers/event-listener.test.ts`

- [ ] **Step 1: Remove the inline `callAppSyncMutation` helper + the 3 broadcast handlers**

Open `services/investor/investor-bff/src/handlers/event-listener.ts`. Delete:

1. The imports for `SignatureV4`, `Sha256`, `defaultProvider` at the top (now unused).
2. The exported `callAppSyncMutation` function (~30-40 lines).
3. The constants `UPDATE_FEATURE_FLAG` and `PUBLISH_DEPOSIT_EVENT` (now unused — they live in `broadcast-listener.ts`).
4. The handlers for `[InvestorBffEventTypes.BROKER_CIRCUIT_OPEN]`, `[InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED]`, and `[InvestorIngestEventTypes.DEPOSIT_DETECTED]` — these no longer route here (the event types were dropped from the primary Ingress in Task 12).

The remaining handlers (USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED, OPERATING_MODE_CHANGED, GO_LIVE_CONFIRMED) stay untouched.

- [ ] **Step 2: Drop the deleted-handler test cases from `event-listener.test.ts`**

Open `services/investor/investor-bff/test/unit/handlers/event-listener.test.ts`. Remove all `it(...)` / `describe(...)` blocks that test:
- `BROKER_CIRCUIT_OPEN` flag flips
- `BROKER_CIRCUIT_CLOSED` flag flips
- `DEPOSIT_DETECTED` deposit broadcast

Coverage for these three behaviours now lives in `broadcast-listener.test.ts` (Task 11).

- [ ] **Step 3: Run tests**

Run: `pnpm nx run investor-bff:test`
Expected: all PASS — materialize-side coverage intact, broadcast-side coverage moved to broadcast-listener tests.

- [ ] **Step 4: Run synth one more time**

Run: `pnpm nx run investor-bff:synth`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/handlers/event-listener.ts services/investor/investor-bff/test/unit/handlers/event-listener.test.ts
git commit -m "refactor(investor-bff): drop broadcast handlers + SigV4 helper from event-listener"
```

---

## Phase 5 — advisory-mfe: subscription wiring

### Task 14: Update GraphQL queries — add `tenantId` to `ON_DECISION_UPDATE` + `DECISION_FIELDS`

**Files:**
- Modify: `apps/advisory-mfe/src/app/graphql/advisory-bff.queries.ts`

- [ ] **Step 1: Add `tenantId` to the fragment + the subscription**

Open `apps/advisory-mfe/src/app/graphql/advisory-bff.queries.ts`. Locate `DECISION_FIELDS` and add `tenantId` to the selection set (alongside `decisionId`):

```ts
export const DECISION_FIELDS = gql`
  fragment DecisionFields on DecisionPacket {
    decisionId
    tenantId
    status
    explanation
    proposedTrades { symbol assetClass side quantityOrAmountCents targetWeightPercent rationale }
    confirmationRequired
    confirmedAt
    rejectedAt
    rejectionReason
    version
    createdAt
    updatedAt
  }
`;
```

Locate `ON_DECISION_UPDATE`. Replace it with:

```ts
export const ON_DECISION_UPDATE = gql`
  subscription OnDecisionUpdate($tenantId: ID!) {
    onDecisionUpdate(tenantId: $tenantId) {
      ...DecisionFields
    }
  }
  ${DECISION_FIELDS}
`;
```

(Preserve existing fragment compositions — only the `tenantId` filter arg + selection are new.)

- [ ] **Step 2: Run advisory-mfe tests**

Run: `pnpm nx run advisory-mfe:test`
Expected: most pass; some component specs may now fail because they pass no `tenantId` to `subscribeToDecisionUpdates`. They'll be fixed in Task 16.

- [ ] **Step 3: Commit**

```bash
git add apps/advisory-mfe/src/app/graphql/advisory-bff.queries.ts
git commit -m "feat(advisory-mfe): add tenantId filter arg to onDecisionUpdate + DecisionFields"
```

---

### Task 15: Update `advisory.service.ts` `subscribeToDecisionUpdates` signature

**Files:**
- Modify: `apps/advisory-mfe/src/app/services/advisory.service.ts`
- Modify: `apps/advisory-mfe/src/app/services/advisory.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Open `apps/advisory-mfe/src/app/services/advisory.service.spec.ts`. Add (or update) a test:

```ts
it('subscribeToDecisionUpdates passes tenantId as the GraphQL variable', () => {
  const subscribe = vi.spyOn(graphql, 'subscribe').mockReturnValue(of({ data: null }));
  service.subscribeToDecisionUpdates('t-abc', 'd-xyz', () => undefined);
  expect(subscribe).toHaveBeenCalledWith(
    expect.anything(),                       // ON_DECISION_UPDATE document
    { tenantId: 't-abc' },                   // variables
  );
});
```

(Match the actual mocking style of the surrounding spec — `graphql` may be referenced under a different name.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run advisory-mfe:test --testPathPatterns=advisory.service`
Expected: FAIL — current signature has no `tenantId` parameter.

- [ ] **Step 3: Update the service**

Open `apps/advisory-mfe/src/app/services/advisory.service.ts`. Change the `subscribeToDecisionUpdates` signature from `(decisionId, onUpdate)` to `(tenantId, decisionId, onUpdate)`:

```ts
subscribeToDecisionUpdates(
  tenantId: string,
  decisionId: string,
  onUpdate: (decision: Decision) => void,
): void {
  this.unsubscribeFromDecisionUpdates();
  const obs = this.graphql.subscribe<{ onDecisionUpdate: Decision }>(
    ON_DECISION_UPDATE,
    { tenantId },
  );
  this.decisionUpdateSub = obs.subscribe({
    next: ({ data }) => {
      if (data?.onDecisionUpdate && data.onDecisionUpdate.decisionId === decisionId) {
        onUpdate(data.onDecisionUpdate);
      }
    },
    error: (err) => console.error('subscribeToDecisionUpdates error', err),
  });
}
```

(Match the existing surrounding code shape — the `this.graphql.subscribe` API may differ. The behavioural change is: pass `{ tenantId }` as the variables, and add `tenantId` as the first parameter.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run advisory-mfe:test --testPathPatterns=advisory.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/advisory-mfe/src/app/services/advisory.service.ts apps/advisory-mfe/src/app/services/advisory.service.spec.ts
git commit -m "feat(advisory-mfe): subscribeToDecisionUpdates accepts tenantId filter arg"
```

---

### Task 16: `decision-detail.component.ts` — R1 subscribe-before-query + version-guard

**Files:**
- Modify: `apps/advisory-mfe/src/app/decision/decision-detail.component.ts`
- Modify: `apps/advisory-mfe/test/app/decision/decision-detail.component.spec.ts`

- [ ] **Step 1: Write failing tests for R1 + version-guard**

Open `apps/advisory-mfe/test/app/decision/decision-detail.component.spec.ts`. Add four new test cases (adapt to the existing test setup style):

```ts
describe('R1 subscribe-before-query + version-guard', () => {
  it('attaches the subscription BEFORE issuing getDecision', async () => {
    const calls: string[] = [];
    advisoryService.subscribeToDecisionUpdates = vi.fn(() => { calls.push('subscribe'); });
    advisoryService.getDecision = vi.fn(async () => { calls.push('getDecision'); return DECISION_FIXTURE; });
    advisoryService.getAgentInvocations = vi.fn(async () => []);
    advisoryService.getComplianceChecks = vi.fn(async () => []);

    await component.ngOnInit();

    expect(calls.indexOf('subscribe')).toBeLessThan(calls.indexOf('getDecision'));
  });

  it('passes tenantId from authStore to subscribeToDecisionUpdates', async () => {
    authStore.user = signal({ tenantId: 't-99', /* ... */ });
    const sub = advisoryService.subscribeToDecisionUpdates = vi.fn();
    await component.ngOnInit();
    expect(sub).toHaveBeenCalledWith('t-99', DECISION_FIXTURE.decisionId, expect.any(Function));
  });

  it('drops a subscription frame whose version is older than the current store version', async () => {
    let sink: ((d: Decision) => void) | undefined;
    advisoryService.subscribeToDecisionUpdates = vi.fn((_t, _id, cb) => { sink = cb; });
    advisoryService.getDecision = vi.fn(async () => ({ ...DECISION_FIXTURE, version: 5 }));

    await component.ngOnInit();
    sink!({ ...DECISION_FIXTURE, version: 3 });

    expect(store.decision()?.version).toBe(5);
  });

  it('applies a subscription frame whose version is newer than the current store version', async () => {
    let sink: ((d: Decision) => void) | undefined;
    advisoryService.subscribeToDecisionUpdates = vi.fn((_t, _id, cb) => { sink = cb; });
    advisoryService.getDecision = vi.fn(async () => ({ ...DECISION_FIXTURE, version: 5 }));

    await component.ngOnInit();
    sink!({ ...DECISION_FIXTURE, version: 6, status: 'AWAITING_CONFIRMATION' });

    expect(store.decision()?.version).toBe(6);
    expect(store.decision()?.status).toBe('AWAITING_CONFIRMATION');
  });

  it('errors out gracefully when authStore has no tenantId (no subscribe attempt)', async () => {
    authStore.user = signal(null);
    const sub = advisoryService.subscribeToDecisionUpdates = vi.fn();
    await component.ngOnInit();
    expect(sub).not.toHaveBeenCalled();
    expect(store.error()).toBeTruthy();
  });
});
```

Place these inside the existing `describe` block (or wrap as shown). `DECISION_FIXTURE` should follow whatever fixture pattern the spec already uses.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx run advisory-mfe:test --testPathPatterns=decision-detail`
Expected: FAIL — current `loadDecision` issues queries first, has no version guard, doesn't pass tenantId.

- [ ] **Step 3: Update the component**

Open `apps/advisory-mfe/src/app/decision/decision-detail.component.ts`. Inject the auth store (refer to how `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts:172` accesses `this.authStore.user()?.tenantId`). Replace the `loadDecision` method body:

```ts
private async loadDecision(decisionId: string): Promise<void> {
  this.store.setLoading(true);
  this.store.setError(null);

  const tenantId = this.authStore.user()?.tenantId;
  if (!tenantId) {
    this.store.setError('errors.missingTenant');
    this.store.setLoading(false);
    return;
  }

  // R1: attach subscription BEFORE the queries fire. Frames that arrive
  // during query resolution are version-guarded into the store; the
  // setDecision() call from the resolved query is also version-guarded so
  // an older query result does not clobber a newer broadcast already in.
  this.advisoryService.subscribeToDecisionUpdates(tenantId, decisionId, (updated) => {
    const current = this.store.decision();
    if (!current || updated.version >= current.version) {
      this.store.setDecision(updated);
    }
  });

  try {
    const [decision, invocations, checks] = await Promise.all([
      this.advisoryService.getDecision(decisionId),
      this.advisoryService.getAgentInvocations(decisionId),
      this.advisoryService.getComplianceChecks(decisionId),
    ]);

    const current = this.store.decision();
    if (!current || decision.version >= current.version) {
      this.store.setDecision(decision);
    }
    this.store.setAgentInvocations(invocations);
    this.store.setComplianceChecks(checks);

    this.advisoryService.recordExplanationView(decisionId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('audit log failed', err);
    });
  } catch (e: unknown) {
    this.store.setError(parseError(e, 'errors.decision'));
  } finally {
    this.store.setLoading(false);
  }
}
```

Add the auth store import + injection. Refer to `apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts` for the exact import path and DI pattern:

```ts
import { AuthStore } from '@nestfolio/shell';
// ...
private readonly authStore = inject(AuthStore);
```

(Adjust the import to whatever the dashboard-mfe equivalent uses — the symbol may live under a slightly different export.)

- [ ] **Step 4: Add the `errors.missingTenant` translation key**

Open `libs/shell/src/i18n/assets/en-GB.json` and `libs/shell/src/i18n/assets/it-IT.json`. Locate the `errors.*` block and add:

```json
"errors.missingTenant": "Session error — please sign in again."
```

(Provide an it-IT equivalent: `"errors.missingTenant": "Errore di sessione — accedi di nuovo."`)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm nx run advisory-mfe:test`
Expected: PASS — all advisory-mfe tests, including the 5 new ones.

Run: `pnpm nx run advisory-mfe:lint`
Expected: PASS — lint clean.

Run: `pnpm nx run advisory-mfe:build`
Expected: bundle produced.

- [ ] **Step 6: Commit**

```bash
git add apps/advisory-mfe/src/app/decision/decision-detail.component.ts apps/advisory-mfe/test/ libs/shell/src/i18n/assets/
git commit -m "feat(advisory-mfe): R1 subscribe-before-query + version-guard for decision detail"
```

---

## Phase 6 — Validation gate (deploy + 5-run e2e)

### Task 17: Deploy to dev + 5-run e2e validation

**Files:** none (deploy + observation)

- [ ] **Step 1: Run nx-affected on the full repo**

Run: `pnpm nx affected -t test`
Expected: PASS for every affected project.

Run: `pnpm nx affected -t synth`
Expected: PASS for advisory-bff, dashboard-bff, investor-bff.

Run: `pnpm nx affected -t lint`
Expected: PASS.

- [ ] **Step 2: Deploy the changed stacks**

Run:
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff,dashboard-bff,investor-bff
```
Expected: 3 stacks deploy successfully.

CFN drift check (sanity):
```bash
aws cloudformation describe-stacks --stack-name dev-advisory-bff --query "Stacks[0].StackStatus"
aws cloudformation describe-stacks --stack-name dev-dashboard-bff --query "Stacks[0].StackStatus"
aws cloudformation describe-stacks --stack-name dev-investor-bff --query "Stacks[0].StackStatus"
```
Expected: all `UPDATE_COMPLETE` or `CREATE_COMPLETE`.

- [ ] **Step 3: Smoke-test the new mutation manually**

Run a SigV4-signed POST against `publishDecisionUpdate` with a fake decision and confirm it returns 200 + the echoed payload (no DDB write — pure echo). One option: a small `tools/spikes/decision-broadcast-spike.mjs` ad-hoc script (do NOT commit). Or hand-craft via `awscurl`:

```bash
APPSYNC_URL=$(aws ssm get-parameter --name /nestfolio/dev-advisory-bff/api/graphqlUrl --query Parameter.Value --output text)
awscurl --service appsync -X POST -d '{"query":"mutation { publishDecisionUpdate(decisionId:\"smoke-1\", tenantId:\"smoke\", status:AWAITING_CONFIRMATION, explanation:\"smoke\", proposedTrades:[], version:1, updatedAt:\"2026-05-02T00:00:00Z\") { decisionId tenantId status } }"}' $APPSYNC_URL
```
Expected: HTTP 200, JSON `{ "data": { "publishDecisionUpdate": { ... } } }`.

- [ ] **Step 4: Run the e2e gate — first run**

In a worktree:
```bash
cd .worktrees/<wt> 2>/dev/null || pwd  # ensure correct dir
lsof -i :4200 -i :4201 -i :4202 -i :4203 -i :4204 -i :4205 -t 2>/dev/null | xargs -r kill -9 2>/dev/null
sleep 2
NX_DAEMON=false NX_SOCKET_DIR=/tmp/nx-tmp NESTFOLIO_INTEG_PREFIX=dev AWS_REGION=us-east-1 pnpm nx run nestfolio-e2e:e2e
```
Expected: `new-investor-happy-path.spec.ts` reaches Step 11 (logout).

If a NEW run-time error surfaces, file-and-continue per CLAUDE.md backlog discipline UNLESS it blocks the gate.

- [ ] **Step 5: Run the e2e gate — repeat 4 more times**

Repeat Step 4's command 4 more times. Expected: all 5 runs reach Step 11.

After each run, capture from the test output:
- Pass/fail status
- If fail, the failing step + the path to `apps/nestfolio-e2e/test-results/.../error-context.md`

- [ ] **Step 6: Negative-validation regression checks**

For each of the 5 runs, in CloudWatch:
- `dev-advisory-bff/DecisionPublisher` logs — assert at least one INFO line per run with `pipelineName: 'broadcast-from-stream'` and `eventName: 'MODIFY'` for `DecisionReadModel`. Assert zero ERROR lines tagged `broadcast-from-stream`.
- `dev-investor-bff/BroadcastIngress` Lambda logs — assert at least one INFO line per run with `pipelineName: 'broadcast-from-queue'` and `type: 'DEPOSIT_DETECTED'`. Assert zero ERROR lines.
- `dev-dashboard-bff/DashboardPublisher` logs — assert pipelineName has switched to `broadcast-from-stream` (was using inline `dashboard-publisher` before this change). Assert no regression in dashboard counter delivery (Step 8 sentinel still arrives — known to be already-broken per QUEUED item, so absence remains absence; new failure modes would be a regression).

Run these queries in CloudWatch Insights against each of the four log groups:
```
fields @timestamp, pipelineName, eventName, type, level
| filter level = "ERROR" or pipelineName like /broadcast-from-/
| sort @timestamp desc
| limit 100
```

- [ ] **Step 7: Update BACKLOG, MEMORY, BACKLOG**

Edit `docs/BACKLOG.md`:
- Move the ACTIVE entry to the "Recently shipped" table at the bottom with today's date and the merge commit SHA.
- Set ACTIVE to `*(none — between workstreams; pick from QUEUED)*`.
- Remove from PARKING LOT the entry "Generalise AppSync IAM publisher pattern into a shared lib" — closed by this spec.

Update `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md` and `project_playwright_e2e_ui.md` with the ship summary (commit SHAs, validation result, any new findings filed).

- [ ] **Step 8: Final commit (docs only)**

```bash
git add docs/BACKLOG.md
git commit -m "docs(backlog): ship Spec 5 — decision-update broadcast pipeline"
```

(MEMORY.md updates are user-scoped; commit only the project-scoped BACKLOG.md change.)

---

## Self-review checklist (run before handing back to user)

After all 17 tasks land:

1. **Spec coverage** — every section of the spec has at least one task:
   - §4.1 library primitives → Tasks 1, 2, 3, 4 ✅
   - §4.2 advisory-bff broadcast wiring → Tasks 5, 6, 7, 8 ✅
   - §4.3 frontend R1 + version-guard + tenantId filter → Tasks 14, 15, 16 ✅
   - §4.4 dashboard-bff + investor-bff migrations → Tasks 10, 11, 12, 13 ✅
   - §6 testing (library + service unit + integration + frontend) → integrated into each task ✅
   - §7 validation gate → Task 17 ✅

2. **Out-of-scope discipline** — none of the tasks touch:
   - Step 8 WSS dashboard sentinel bug (separate QUEUED)
   - Operating mode wiring
   - Vestigial MemoryStrategy CDK declarations
   - PARKING-LOT items unrelated to this workstream

3. **Frequent commits** — each task ends with `git commit`. 17 commits expected, one per task, well-scoped.

4. **TDD** — every code-producing task has the order: failing test → run → implement → run → commit.

5. **Backlog discipline** — Task 17 closes the loop on `docs/BACKLOG.md` and the topic memories per CLAUDE.md § "Backlog Discipline".
