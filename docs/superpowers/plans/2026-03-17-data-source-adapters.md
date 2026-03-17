# Data Source Adapters — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create 5 data source adapter services that fetch external data on a schedule and publish events for Knowledge Base ingestion: yahoo-finance-adpt, marketwatch-adpt, sec-edgar-adpt, fred-adpt, alpha-vantage-adpt.

**Architecture:** Each adapter is a lightweight scheduled service: EventBridge Scheduler triggers a Lambda that fetches data from an external API. If the payload fits within 256 KB, it publishes an EventBridge event with inline content. If the payload exceeds 256 KB, it writes to the target KB S3 bucket and publishes an event with a pre-signed URL (1h TTL). Schedule configuration follows the `resolvePipelineConfig` 3-layer merge convention — sandbox: DISABLED, staging: `rate(24 hours)`, production: per-adapter rate. The AdapterSchedule CDK construct (from Plan 2) encapsulates the Scheduler + Lambda + permissions pattern.

**Tech Stack:** TypeScript, AWS CDK, EventBridge Scheduler, Lambda (NodejsFunction), S3, SSM Parameter Store, Jest

**Spec:** `docs/superpowers/specs/2026-03-17-advisory-agent-topology-design.md` (Data Source Adapter Services section)

**Plan:** 5 of 5 for Advisory Agent Topology

| Status | Chunks | Tasks | Tests |
|--------|--------|-------|-------|
| PENDING | 3 | 20 | ~45 |

---

## File Structure

### Shared utilities (in event-processor)

| File | Action |
|---|---|
| `libs/event-processor/src/lambda/publish-or-upload.ts` | CREATE — size-aware publish utility |
| `libs/event-processor/src/lambda/rss-parser.ts` | CREATE — RSS XML parser utility |
| `libs/event-processor/src/index.ts` | EDIT — add exports |
| `libs/event-processor/test/publish-or-upload.test.ts` | CREATE |
| `libs/event-processor/test/rss-parser.test.ts` | CREATE |

### yahoo-finance-adpt

| File | Action |
|---|---|
| `services/advisory/yahoo-finance-adpt/project.json` | CREATE |
| `services/advisory/yahoo-finance-adpt/tsconfig.json` | CREATE |
| `services/advisory/yahoo-finance-adpt/tsconfig.spec.json` | CREATE |
| `services/advisory/yahoo-finance-adpt/jest.config.js` | CREATE |
| `services/advisory/yahoo-finance-adpt/src/main.ts` | CREATE |
| `services/advisory/yahoo-finance-adpt/src/service.stack.ts` | CREATE |
| `services/advisory/yahoo-finance-adpt/src/service-domain/events.ts` | CREATE |
| `services/advisory/yahoo-finance-adpt/src/service-domain/index.ts` | CREATE |
| `services/advisory/yahoo-finance-adpt/src/handlers/event-publisher.ts` | CREATE |
| `services/advisory/yahoo-finance-adpt/test/event-publisher.test.ts` | CREATE |

### marketwatch-adpt

| File | Action |
|---|---|
| `services/advisory/marketwatch-adpt/project.json` | CREATE |
| `services/advisory/marketwatch-adpt/tsconfig.json` | CREATE |
| `services/advisory/marketwatch-adpt/tsconfig.spec.json` | CREATE |
| `services/advisory/marketwatch-adpt/jest.config.js` | CREATE |
| `services/advisory/marketwatch-adpt/src/main.ts` | CREATE |
| `services/advisory/marketwatch-adpt/src/service.stack.ts` | CREATE |
| `services/advisory/marketwatch-adpt/src/service-domain/events.ts` | CREATE |
| `services/advisory/marketwatch-adpt/src/service-domain/index.ts` | CREATE |
| `services/advisory/marketwatch-adpt/src/handlers/event-publisher.ts` | CREATE |
| `services/advisory/marketwatch-adpt/test/event-publisher.test.ts` | CREATE |

### sec-edgar-adpt

| File | Action |
|---|---|
| `services/advisory/sec-edgar-adpt/project.json` | CREATE |
| `services/advisory/sec-edgar-adpt/tsconfig.json` | CREATE |
| `services/advisory/sec-edgar-adpt/tsconfig.spec.json` | CREATE |
| `services/advisory/sec-edgar-adpt/jest.config.js` | CREATE |
| `services/advisory/sec-edgar-adpt/src/main.ts` | CREATE |
| `services/advisory/sec-edgar-adpt/src/service.stack.ts` | CREATE |
| `services/advisory/sec-edgar-adpt/src/service-domain/events.ts` | CREATE |
| `services/advisory/sec-edgar-adpt/src/service-domain/index.ts` | CREATE |
| `services/advisory/sec-edgar-adpt/src/handlers/event-publisher.ts` | CREATE |
| `services/advisory/sec-edgar-adpt/src/clients/edgar-api.ts` | CREATE — EDGAR API client utility |
| `services/advisory/sec-edgar-adpt/test/event-publisher.test.ts` | CREATE |
| `services/advisory/sec-edgar-adpt/test/edgar-api.test.ts` | CREATE |

### fred-adpt

| File | Action |
|---|---|
| `services/advisory/fred-adpt/project.json` | CREATE |
| `services/advisory/fred-adpt/tsconfig.json` | CREATE |
| `services/advisory/fred-adpt/tsconfig.spec.json` | CREATE |
| `services/advisory/fred-adpt/jest.config.js` | CREATE |
| `services/advisory/fred-adpt/src/main.ts` | CREATE |
| `services/advisory/fred-adpt/src/service.stack.ts` | CREATE |
| `services/advisory/fred-adpt/src/service-domain/events.ts` | CREATE |
| `services/advisory/fred-adpt/src/service-domain/index.ts` | CREATE |
| `services/advisory/fred-adpt/src/handlers/event-publisher.ts` | CREATE |
| `services/advisory/fred-adpt/test/event-publisher.test.ts` | CREATE |

### alpha-vantage-adpt

| File | Action |
|---|---|
| `services/advisory/alpha-vantage-adpt/project.json` | CREATE |
| `services/advisory/alpha-vantage-adpt/tsconfig.json` | CREATE |
| `services/advisory/alpha-vantage-adpt/tsconfig.spec.json` | CREATE |
| `services/advisory/alpha-vantage-adpt/jest.config.js` | CREATE |
| `services/advisory/alpha-vantage-adpt/pipeline.json` | CREATE — production override: `rate(12 hours)` |
| `services/advisory/alpha-vantage-adpt/src/main.ts` | CREATE |
| `services/advisory/alpha-vantage-adpt/src/service.stack.ts` | CREATE |
| `services/advisory/alpha-vantage-adpt/src/service-domain/events.ts` | CREATE |
| `services/advisory/alpha-vantage-adpt/src/service-domain/index.ts` | CREATE |
| `services/advisory/alpha-vantage-adpt/src/handlers/event-publisher.ts` | CREATE |
| `services/advisory/alpha-vantage-adpt/test/event-publisher.test.ts` | CREATE |

---

## Chunk 1: Shared Utilities + yahoo-finance-adpt + marketwatch-adpt

### Task 1: Create `publishOrUpload` utility

**Files:**
- Create: `libs/event-processor/src/lambda/publish-or-upload.ts`
- Test: `libs/event-processor/test/publish-or-upload.test.ts`
- Edit: `libs/event-processor/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/event-processor/test/publish-or-upload.test.ts
import { publishOrUpload } from '../src/lambda/publish-or-upload';

const mockPublish = jest.fn();
const mockPutObject = jest.fn().mockResolvedValue({});
const mockGetSignedUrl = jest.fn().mockResolvedValue('https://s3.example.com/presigned');

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockPutObject })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutObject', input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ _type: 'GetObject', input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

describe('publishOrUpload', () => {
  const bus = { publish: mockPublish } as any;
  const bucket = 'test-kb-bucket';

  beforeEach(() => {
    jest.clearAllMocks();
    mockPublish.mockResolvedValue(undefined);
  });

  it('publishes inline when content is under 256KB', async () => {
    const content = { source: 'test', data: 'small payload' };
    await publishOrUpload({
      bus,
      bucket,
      eventType: 'TEST_UPDATED',
      content,
      serviceName: 'test-adpt',
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const event = mockPublish.mock.calls[0][0];
    expect(event.type).toBe('TEST_UPDATED');
    expect(event.subject.content).toEqual(content);
    expect(event.subject.delivery).toBe('inline');
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it('uploads to S3 and publishes pre-signed URL when content exceeds 256KB', async () => {
    const largeContent = { source: 'test', data: 'x'.repeat(300 * 1024) };
    await publishOrUpload({
      bus,
      bucket,
      eventType: 'TEST_UPDATED',
      content: largeContent,
      serviceName: 'test-adpt',
    });

    expect(mockPutObject).toHaveBeenCalledTimes(1);
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const event = mockPublish.mock.calls[0][0];
    expect(event.type).toBe('TEST_UPDATED');
    expect(event.subject.delivery).toBe('s3-presigned');
    expect(event.subject.url).toBe('https://s3.example.com/presigned');
    expect(event.subject.content).toBeUndefined();
  });

  it('includes eventId and timestamp in the event', async () => {
    await publishOrUpload({
      bus,
      bucket,
      eventType: 'TEST_UPDATED',
      content: { data: 'test' },
      serviceName: 'test-adpt',
    });

    const event = mockPublish.mock.calls[0][0];
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor -- --testPathPattern=publish-or-upload`
Expected: FAIL — cannot find module `../src/lambda/publish-or-upload`

- [ ] **Step 3: Implement publishOrUpload**

```ts
// libs/event-processor/src/lambda/publish-or-upload.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type Bus, type BusEvent } from '../platform/bus';
import { getUUID, getTime } from '../platform/core';

const MAX_EVENT_SIZE = 256 * 1024; // 256 KB
const PRESIGNED_URL_TTL = 3600; // 1 hour

export interface PublishOrUploadParams {
  readonly bus: Bus;
  readonly bucket: string;
  readonly eventType: string;
  readonly content: Record<string, unknown>;
  readonly serviceName: string;
}

const s3 = new S3Client({});

export async function publishOrUpload(params: PublishOrUploadParams): Promise<void> {
  const { bus, bucket, eventType, content, serviceName } = params;
  const serialized = JSON.stringify(content);
  const sizeBytes = Buffer.byteLength(serialized, 'utf-8');

  const eventId = getUUID();
  const timestamp = getTime();

  if (sizeBytes <= MAX_EVENT_SIZE) {
    const event: BusEvent = {
      id: eventId,
      type: eventType,
      timestamp,
      subject: { delivery: 'inline', content },
      context: { serviceName },
    };
    await bus.publish(event);
  } else {
    const key = `${serviceName}/${eventType}/${eventId}.json`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: serialized,
        ContentType: 'application/json',
      }),
    );

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: PRESIGNED_URL_TTL },
    );

    const event: BusEvent = {
      id: eventId,
      type: eventType,
      timestamp,
      subject: { delivery: 's3-presigned', url, bucket, key },
      context: { serviceName },
    };
    await bus.publish(event);
  }
}
```

- [ ] **Step 4: Export from index**

Add to `libs/event-processor/src/index.ts`:
```ts
export { publishOrUpload, type PublishOrUploadParams } from './lambda/publish-or-upload';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx nx test event-processor -- --testPathPattern=publish-or-upload`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/lambda/publish-or-upload.ts \
       libs/event-processor/test/publish-or-upload.test.ts \
       libs/event-processor/src/index.ts
git commit -m "feat(event-processor): add publishOrUpload size-aware publish utility

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Create RSS parser utility

**Files:**
- Create: `libs/event-processor/src/lambda/rss-parser.ts`
- Test: `libs/event-processor/test/rss-parser.test.ts`
- Edit: `libs/event-processor/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/event-processor/test/rss-parser.test.ts
import { parseRssFeed, type RssArticle } from '../src/lambda/rss-parser';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Article One</title>
      <link>https://example.com/article-1</link>
      <pubDate>Mon, 17 Mar 2026 10:00:00 GMT</pubDate>
      <description>First article description</description>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/article-2</link>
      <pubDate>Mon, 17 Mar 2026 12:00:00 GMT</pubDate>
      <description>Second article description</description>
    </item>
  </channel>
</rss>`;

describe('parseRssFeed', () => {
  it('parses RSS XML into articles array', () => {
    const articles = parseRssFeed(SAMPLE_RSS);
    expect(articles).toHaveLength(2);
    expect(articles[0]).toEqual<RssArticle>({
      title: 'Article One',
      link: 'https://example.com/article-1',
      pubDate: 'Mon, 17 Mar 2026 10:00:00 GMT',
      description: 'First article description',
    });
  });

  it('returns empty array for empty feed', () => {
    const xml = `<?xml version="1.0"?><rss><channel></channel></rss>`;
    expect(parseRssFeed(xml)).toEqual([]);
  });

  it('handles missing optional fields gracefully', () => {
    const xml = `<?xml version="1.0"?>
    <rss><channel><item><title>Only Title</title></item></channel></rss>`;
    const articles = parseRssFeed(xml);
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('Only Title');
    expect(articles[0].link).toBe('');
    expect(articles[0].pubDate).toBe('');
    expect(articles[0].description).toBe('');
  });

  it('throws on invalid XML', () => {
    expect(() => parseRssFeed('not xml at all')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor -- --testPathPattern=rss-parser`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement RSS parser**

Note: Uses a lightweight regex/string-based XML parser — no external dependency needed for simple RSS.

```ts
// libs/event-processor/src/lambda/rss-parser.ts

export interface RssArticle {
  readonly title: string;
  readonly link: string;
  readonly pubDate: string;
  readonly description: string;
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Parses an RSS 2.0 XML feed string into an array of articles.
 * Lightweight implementation — no external XML parser dependency.
 */
export function parseRssFeed(xml: string): RssArticle[] {
  // Basic validity check
  if (!xml.includes('<rss') && !xml.includes('<channel')) {
    throw new Error('Invalid RSS feed: missing <rss> or <channel> element');
  }

  const items: RssArticle[] = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    items.push({
      title: extractTag(itemXml, 'title'),
      link: extractTag(itemXml, 'link'),
      pubDate: extractTag(itemXml, 'pubDate'),
      description: extractTag(itemXml, 'description'),
    });
  }

  return items;
}
```

- [ ] **Step 4: Export from index**

Add to `libs/event-processor/src/index.ts`:
```ts
export { parseRssFeed, type RssArticle } from './lambda/rss-parser';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx nx test event-processor -- --testPathPattern=rss-parser`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/lambda/rss-parser.ts \
       libs/event-processor/test/rss-parser.test.ts \
       libs/event-processor/src/index.ts
git commit -m "feat(event-processor): add RSS feed parser utility

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Scaffold yahoo-finance-adpt project

**Files:**
- Create: `services/advisory/yahoo-finance-adpt/project.json`
- Create: `services/advisory/yahoo-finance-adpt/tsconfig.json`
- Create: `services/advisory/yahoo-finance-adpt/tsconfig.spec.json`
- Create: `services/advisory/yahoo-finance-adpt/jest.config.js`
- Create: `services/advisory/yahoo-finance-adpt/src/service-domain/events.ts`
- Create: `services/advisory/yahoo-finance-adpt/src/service-domain/index.ts`

- [ ] **Step 1: Create project.json**

```json
// services/advisory/yahoo-finance-adpt/project.json
{
  "name": "yahoo-finance-adpt",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/advisory/yahoo-finance-adpt/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/yahoo-finance-adpt/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/yahoo-finance-adpt/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/advisory/yahoo-finance-adpt/jest.config.js" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:advisory", "type:adpt"]
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
// services/advisory/yahoo-finance-adpt/tsconfig.json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "types": ["node"]
  }
}
```

- [ ] **Step 3: Create tsconfig.spec.json**

```json
// services/advisory/yahoo-finance-adpt/tsconfig.spec.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["jest", "node"]
  }
}
```

- [ ] **Step 4: Create jest.config.js**

```js
// services/advisory/yahoo-finance-adpt/jest.config.js
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'yahoo-finance-adpt',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/cdk-constructs$': '<rootDir>/../../../libs/cdk-constructs/src/index.ts',
    '^@nestfolio/event-processor$': '<rootDir>/../../../libs/event-processor/src/index.ts',
    '^@nestfolio/event-processor/(.*)$': '<rootDir>/../../../libs/event-processor/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
};
```

- [ ] **Step 5: Create service-domain events**

```ts
// services/advisory/yahoo-finance-adpt/src/service-domain/events.ts
export const YahooFinanceAdptEventTypes = {
  YAHOO_FINANCE_UPDATED: 'YAHOO_FINANCE_UPDATED',
} as const;
```

```ts
// services/advisory/yahoo-finance-adpt/src/service-domain/index.ts
export { YahooFinanceAdptEventTypes } from './events';
```

- [ ] **Step 6: Commit**

```bash
git add services/advisory/yahoo-finance-adpt/
git commit -m "chore(yahoo-finance-adpt): scaffold project structure

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Implement yahoo-finance-adpt event-publisher handler

**Files:**
- Create: `services/advisory/yahoo-finance-adpt/src/handlers/event-publisher.ts`
- Test: `services/advisory/yahoo-finance-adpt/test/event-publisher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/advisory/yahoo-finance-adpt/test/event-publisher.test.ts
const mockPublishOrUpload = jest.fn().mockResolvedValue(undefined);

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  EventBridgeBus: jest.fn().mockImplementation(() => ({ publish: jest.fn() })),
  publishOrUpload: mockPublishOrUpload,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  envVar: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'yahoo-finance-adpt',
      KB_BUCKET: 'test-kb-bucket',
      TICKERS: 'VTI,BND,QQQ',
    };
    return vars[name] ?? '';
  }),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { createHandler } from '../src/handlers/event-publisher';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>VTI hits record high</title>
      <link>https://finance.yahoo.com/news/vti-record</link>
      <pubDate>Mon, 17 Mar 2026 10:00:00 GMT</pubDate>
      <description>Total market ETF reaches new all-time high</description>
    </item>
  </channel>
</rss>`;

describe('yahoo-finance-adpt event-publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_RSS),
    });
  });

  it('fetches RSS for each ticker and publishes events', async () => {
    const handler = createHandler();
    await handler();

    // 3 tickers = 3 fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://feeds.finance.yahoo.com/rss/2.0/headline?s=VTI',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // 3 tickers = 3 publishOrUpload calls
    expect(mockPublishOrUpload).toHaveBeenCalledTimes(3);
    const firstCall = mockPublishOrUpload.mock.calls[0][0];
    expect(firstCall.eventType).toBe('YAHOO_FINANCE_UPDATED');
    expect(firstCall.content.source).toBe('yahoo-finance');
    expect(firstCall.content.ticker).toBe('VTI');
    expect(firstCall.content.articles).toHaveLength(1);
    expect(firstCall.content.articles[0].title).toBe('VTI hits record high');
  });

  it('continues processing remaining tickers when one fetch fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({ ok: true, text: () => Promise.resolve(SAMPLE_RSS) });

    const handler = createHandler();
    await handler();

    // First ticker fails, remaining 2 succeed
    expect(mockPublishOrUpload).toHaveBeenCalledTimes(2);
  });

  it('skips ticker when RSS response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve('') });
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(SAMPLE_RSS) });

    const handler = createHandler();
    await handler();

    expect(mockPublishOrUpload).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test yahoo-finance-adpt -- --testPathPattern=event-publisher`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement event-publisher handler**

```ts
// services/advisory/yahoo-finance-adpt/src/handlers/event-publisher.ts
import {
  EventBridgeBus,
  envVar,
  logger,
  publishOrUpload,
  parseRssFeed,
} from '@nestfolio/event-processor';
import { YahooFinanceAdptEventTypes } from '../service-domain/events';

const FETCH_TIMEOUT_MS = 10_000;
const BASE_URL = 'https://feeds.finance.yahoo.com/rss/2.0/headline';

export function createHandler() {
  const busName = envVar('BUS_NAME');
  const serviceName = envVar('SERVICE_NAME');
  const bucket = envVar('KB_BUCKET');
  const tickers = envVar('TICKERS').split(',').map((t) => t.trim());

  const bus = new EventBridgeBus(busName, serviceName);

  return async (): Promise<void> => {
    logger.info('Starting Yahoo Finance RSS fetch', { tickers });

    for (const ticker of tickers) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(`${BASE_URL}?s=${ticker}`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          logger.warn('RSS fetch failed', { ticker, status: response.status });
          continue;
        }

        const xml = await response.text();
        const articles = parseRssFeed(xml);

        await publishOrUpload({
          bus,
          bucket,
          eventType: YahooFinanceAdptEventTypes.YAHOO_FINANCE_UPDATED,
          content: { source: 'yahoo-finance', ticker, articles },
          serviceName,
        });

        logger.info('Published Yahoo Finance update', { ticker, articleCount: articles.length });
      } catch (error) {
        logger.error('Failed to process ticker', { ticker, error });
      }
    }
  };
}

export const handler = createHandler();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test yahoo-finance-adpt -- --testPathPattern=event-publisher`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add services/advisory/yahoo-finance-adpt/src/handlers/event-publisher.ts \
       services/advisory/yahoo-finance-adpt/test/event-publisher.test.ts
git commit -m "feat(yahoo-finance-adpt): implement RSS fetch and publish handler

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Implement yahoo-finance-adpt service.stack.ts and main.ts

**Files:**
- Create: `services/advisory/yahoo-finance-adpt/src/service.stack.ts`
- Create: `services/advisory/yahoo-finance-adpt/src/main.ts`

- [ ] **Step 1: Implement service.stack.ts**

```ts
// services/advisory/yahoo-finance-adpt/src/service.stack.ts
import { join } from 'path';
import { Duration, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import {
  ServiceStack,
  defaultLambdaProps,
  Monitoring,
  ServiceDashboard,
} from '@nestfolio/cdk-constructs';

export class YahooFinanceAdptStack extends ServiceStack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & {
      prefix: string;
      schedule?: { enabled: boolean; rate: string };
      tickers?: string;
    },
  ) {
    super(scope, id, {
      ...props,
      prefix: props.prefix,
      subsystem: 'advisory',
      service: 'yahoo-finance-adpt',
      serviceDir: __dirname,
    });

    const scheduleConfig = props.schedule ?? { enabled: false, rate: 'rate(24 hours)' };
    const tickers = props.tickers ?? 'VTI,BND,QQQ,VTIP,SPY';

    // Resolve advisory bus
    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/event-hub/busArn`,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    // Resolve KB bucket
    const kbBucketName = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/kb-market/bucketName`,
    );
    const kbBucket = Bucket.fromBucketName(this, 'KbBucket', kbBucketName);

    // Event publisher Lambda
    const eventPublisher = new NodejsFunction(this, 'EventPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers/event-publisher.ts'),
      handler: 'handler',
      timeout: Duration.seconds(60),
      environment: {
        BUS_NAME: advisoryBus.eventBusName,
        SERVICE_NAME: 'yahoo-finance-adpt',
        KB_BUCKET: kbBucketName,
        TICKERS: tickers,
      },
    });

    advisoryBus.grantPutEventsTo(eventPublisher);
    kbBucket.grantReadWrite(eventPublisher);

    // EventBridge Scheduler
    new scheduler.CfnSchedule(this, 'FetchSchedule', {
      name: `${props.prefix}-yahoo-finance-fetch`,
      scheduleExpression: scheduleConfig.rate,
      state: scheduleConfig.enabled ? 'ENABLED' : 'DISABLED',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: eventPublisher.functionArn,
        roleArn: this.createSchedulerRole(eventPublisher).roleArn,
      },
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', { lambdaFunctions: [eventPublisher] });
      new ServiceDashboard(this, 'Dashboard', { lambdaFunctions: [eventPublisher] });
    }
  }

  private createSchedulerRole(fn: NodejsFunction) {
    const role = new (require('aws-cdk-lib/aws-iam').Role)(this, 'SchedulerRole', {
      assumedBy: new (require('aws-cdk-lib/aws-iam').ServicePrincipal)('scheduler.amazonaws.com'),
    });
    fn.grantInvoke(role);
    return role;
  }
}
```

- [ ] **Step 2: Implement main.ts**

```ts
// services/advisory/yahoo-finance-adpt/src/main.ts
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { YahooFinanceAdptStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'yahoo-finance-adpt');

const schedule = (config as any).schedule ?? { enabled: false, rate: 'rate(24 hours)' };

new YahooFinanceAdptStack(app, `${config.prefix}-yahoo-finance-adpt`, {
  prefix: config.prefix,
  schedule,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/yahoo-finance-adpt/src/service.stack.ts \
       services/advisory/yahoo-finance-adpt/src/main.ts
git commit -m "feat(yahoo-finance-adpt): add CDK stack with AdapterSchedule

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Scaffold marketwatch-adpt project

**Files:**
- Create: `services/advisory/marketwatch-adpt/project.json`
- Create: `services/advisory/marketwatch-adpt/tsconfig.json`
- Create: `services/advisory/marketwatch-adpt/tsconfig.spec.json`
- Create: `services/advisory/marketwatch-adpt/jest.config.js`
- Create: `services/advisory/marketwatch-adpt/src/service-domain/events.ts`
- Create: `services/advisory/marketwatch-adpt/src/service-domain/index.ts`

- [ ] **Step 1: Create project.json**

```json
// services/advisory/marketwatch-adpt/project.json
{
  "name": "marketwatch-adpt",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/advisory/marketwatch-adpt/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/marketwatch-adpt/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/marketwatch-adpt/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/advisory/marketwatch-adpt/jest.config.js" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:advisory", "type:adpt"]
}
```

- [ ] **Step 2: Create tsconfig.json, tsconfig.spec.json, jest.config.js**

Use same patterns as yahoo-finance-adpt — tsconfig.json extends `../../../tsconfig.base.json` with `module: commonjs`, tsconfig.spec.json adds `jest` type, jest.config.js uses `displayName: 'marketwatch-adpt'` with same moduleNameMapper.

- [ ] **Step 3: Create service-domain events**

```ts
// services/advisory/marketwatch-adpt/src/service-domain/events.ts
export const MarketwatchAdptEventTypes = {
  MARKETWATCH_UPDATED: 'MARKETWATCH_UPDATED',
} as const;
```

```ts
// services/advisory/marketwatch-adpt/src/service-domain/index.ts
export { MarketwatchAdptEventTypes } from './events';
```

- [ ] **Step 4: Commit**

```bash
git add services/advisory/marketwatch-adpt/
git commit -m "chore(marketwatch-adpt): scaffold project structure

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Implement marketwatch-adpt event-publisher handler

**Files:**
- Create: `services/advisory/marketwatch-adpt/src/handlers/event-publisher.ts`
- Test: `services/advisory/marketwatch-adpt/test/event-publisher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/advisory/marketwatch-adpt/test/event-publisher.test.ts
const mockPublishOrUpload = jest.fn().mockResolvedValue(undefined);

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  EventBridgeBus: jest.fn().mockImplementation(() => ({ publish: jest.fn() })),
  publishOrUpload: mockPublishOrUpload,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  envVar: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'marketwatch-adpt',
      KB_BUCKET: 'test-kb-bucket',
    };
    return vars[name] ?? '';
  }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { createHandler } from '../src/handlers/event-publisher';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Markets surge</title>
      <link>https://www.marketwatch.com/story/markets-surge</link>
      <pubDate>Mon, 17 Mar 2026 14:00:00 GMT</pubDate>
      <description>Major indices close at record highs</description>
    </item>
  </channel>
</rss>`;

describe('marketwatch-adpt event-publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_RSS),
    });
  });

  it('fetches both RSS feeds and publishes events', async () => {
    const handler = createHandler();
    await handler();

    // 2 feeds
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://feeds.marketwatch.com/marketwatch/topstories',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://feeds.marketwatch.com/marketwatch/marketpulse',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // 2 publish calls
    expect(mockPublishOrUpload).toHaveBeenCalledTimes(2);
    const firstCall = mockPublishOrUpload.mock.calls[0][0];
    expect(firstCall.eventType).toBe('MARKETWATCH_UPDATED');
    expect(firstCall.content.source).toBe('marketwatch');
    expect(firstCall.content.feed).toBe('topstories');
  });

  it('continues when one feed fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({ ok: true, text: () => Promise.resolve(SAMPLE_RSS) });

    const handler = createHandler();
    await handler();

    expect(mockPublishOrUpload).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test marketwatch-adpt -- --testPathPattern=event-publisher`
Expected: FAIL

- [ ] **Step 3: Implement event-publisher handler**

```ts
// services/advisory/marketwatch-adpt/src/handlers/event-publisher.ts
import {
  EventBridgeBus,
  envVar,
  logger,
  publishOrUpload,
  parseRssFeed,
} from '@nestfolio/event-processor';
import { MarketwatchAdptEventTypes } from '../service-domain/events';

const FETCH_TIMEOUT_MS = 10_000;

const FEEDS = [
  { name: 'topstories', url: 'https://feeds.marketwatch.com/marketwatch/topstories' },
  { name: 'marketpulse', url: 'https://feeds.marketwatch.com/marketwatch/marketpulse' },
] as const;

export function createHandler() {
  const busName = envVar('BUS_NAME');
  const serviceName = envVar('SERVICE_NAME');
  const bucket = envVar('KB_BUCKET');

  const bus = new EventBridgeBus(busName, serviceName);

  return async (): Promise<void> => {
    logger.info('Starting MarketWatch RSS fetch');

    for (const feed of FEEDS) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(feed.url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          logger.warn('RSS fetch failed', { feed: feed.name, status: response.status });
          continue;
        }

        const xml = await response.text();
        const articles = parseRssFeed(xml);

        await publishOrUpload({
          bus,
          bucket,
          eventType: MarketwatchAdptEventTypes.MARKETWATCH_UPDATED,
          content: { source: 'marketwatch', feed: feed.name, articles },
          serviceName,
        });

        logger.info('Published MarketWatch update', { feed: feed.name, articleCount: articles.length });
      } catch (error) {
        logger.error('Failed to process feed', { feed: feed.name, error });
      }
    }
  };
}

export const handler = createHandler();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test marketwatch-adpt -- --testPathPattern=event-publisher`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add services/advisory/marketwatch-adpt/src/handlers/event-publisher.ts \
       services/advisory/marketwatch-adpt/test/event-publisher.test.ts
git commit -m "feat(marketwatch-adpt): implement dual-feed RSS fetch and publish

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Implement marketwatch-adpt service.stack.ts and main.ts

**Files:**
- Create: `services/advisory/marketwatch-adpt/src/service.stack.ts`
- Create: `services/advisory/marketwatch-adpt/src/main.ts`

- [ ] **Step 1: Implement service.stack.ts**

Same pattern as yahoo-finance-adpt stack — `MarketwatchAdptStack extends ServiceStack` with:
- Advisory bus from SSM
- KB bucket from SSM (`/nestfolio/{prefix}-advisory/kb-market/bucketName`)
- EventPublisher Lambda with env vars: `BUS_NAME`, `SERVICE_NAME`, `KB_BUCKET`
- CfnSchedule with configurable `schedule` prop
- Monitoring + Dashboard
- No `TICKERS` env var (not needed)

```ts
// services/advisory/marketwatch-adpt/src/service.stack.ts
import { join } from 'path';
import { Duration, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  ServiceStack,
  defaultLambdaProps,
  Monitoring,
  ServiceDashboard,
} from '@nestfolio/cdk-constructs';

export class MarketwatchAdptStack extends ServiceStack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & {
      prefix: string;
      schedule?: { enabled: boolean; rate: string };
    },
  ) {
    super(scope, id, {
      ...props,
      prefix: props.prefix,
      subsystem: 'advisory',
      service: 'marketwatch-adpt',
      serviceDir: __dirname,
    });

    const scheduleConfig = props.schedule ?? { enabled: false, rate: 'rate(24 hours)' };

    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/event-hub/busArn`,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    const kbBucketName = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/kb-market/bucketName`,
    );
    const kbBucket = Bucket.fromBucketName(this, 'KbBucket', kbBucketName);

    const eventPublisher = new NodejsFunction(this, 'EventPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers/event-publisher.ts'),
      handler: 'handler',
      timeout: Duration.seconds(60),
      environment: {
        BUS_NAME: advisoryBus.eventBusName,
        SERVICE_NAME: 'marketwatch-adpt',
        KB_BUCKET: kbBucketName,
      },
    });

    advisoryBus.grantPutEventsTo(eventPublisher);
    kbBucket.grantReadWrite(eventPublisher);

    const schedulerRole = new Role(this, 'SchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    eventPublisher.grantInvoke(schedulerRole);

    new scheduler.CfnSchedule(this, 'FetchSchedule', {
      name: `${props.prefix}-marketwatch-fetch`,
      scheduleExpression: scheduleConfig.rate,
      state: scheduleConfig.enabled ? 'ENABLED' : 'DISABLED',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: eventPublisher.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', { lambdaFunctions: [eventPublisher] });
      new ServiceDashboard(this, 'Dashboard', { lambdaFunctions: [eventPublisher] });
    }
  }
}
```

- [ ] **Step 2: Implement main.ts**

```ts
// services/advisory/marketwatch-adpt/src/main.ts
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { MarketwatchAdptStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'marketwatch-adpt');

const schedule = (config as any).schedule ?? { enabled: false, rate: 'rate(24 hours)' };

new MarketwatchAdptStack(app, `${config.prefix}-marketwatch-adpt`, {
  prefix: config.prefix,
  schedule,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/marketwatch-adpt/src/service.stack.ts \
       services/advisory/marketwatch-adpt/src/main.ts
git commit -m "feat(marketwatch-adpt): add CDK stack with scheduled fetch

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Chunk 2: sec-edgar-adpt

### Task 9: Scaffold sec-edgar-adpt project

**Files:**
- Create: `services/advisory/sec-edgar-adpt/project.json`
- Create: `services/advisory/sec-edgar-adpt/tsconfig.json`
- Create: `services/advisory/sec-edgar-adpt/tsconfig.spec.json`
- Create: `services/advisory/sec-edgar-adpt/jest.config.js`
- Create: `services/advisory/sec-edgar-adpt/src/service-domain/events.ts`
- Create: `services/advisory/sec-edgar-adpt/src/service-domain/index.ts`

- [ ] **Step 1: Create project.json**

```json
// services/advisory/sec-edgar-adpt/project.json
{
  "name": "sec-edgar-adpt",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/advisory/sec-edgar-adpt/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/sec-edgar-adpt/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/sec-edgar-adpt/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/advisory/sec-edgar-adpt/jest.config.js" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:advisory", "type:adpt"]
}
```

- [ ] **Step 2: Create tsconfig.json, tsconfig.spec.json, jest.config.js**

Same pattern as yahoo-finance-adpt — `displayName: 'sec-edgar-adpt'`.

- [ ] **Step 3: Create service-domain events**

```ts
// services/advisory/sec-edgar-adpt/src/service-domain/events.ts
export const SecEdgarAdptEventTypes = {
  SEC_8K_FILED: 'SEC_8K_FILED',
  SEC_PROSPECTUS_UPDATED: 'SEC_PROSPECTUS_UPDATED',
  SEC_10K_UPDATED: 'SEC_10K_UPDATED',
} as const;
```

```ts
// services/advisory/sec-edgar-adpt/src/service-domain/index.ts
export { SecEdgarAdptEventTypes } from './events';
```

- [ ] **Step 4: Commit**

```bash
git add services/advisory/sec-edgar-adpt/
git commit -m "chore(sec-edgar-adpt): scaffold project structure

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Implement EDGAR API client utility

**Files:**
- Create: `services/advisory/sec-edgar-adpt/src/clients/edgar-api.ts`
- Test: `services/advisory/sec-edgar-adpt/test/edgar-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/advisory/sec-edgar-adpt/test/edgar-api.test.ts
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import {
  fetchSubmissions,
  filterRecentFilings,
  type EdgarFiling,
} from '../src/clients/edgar-api';

const SAMPLE_SUBMISSIONS = {
  cik: '0000102909',
  entityType: 'ETF',
  name: 'Vanguard Index Funds',
  recentFilings: {
    filings: [
      { accessionNumber: '0001-23-456', form: '8-K', filingDate: '2026-03-17', primaryDocument: 'doc.htm' },
      { accessionNumber: '0001-23-457', form: '485BPOS', filingDate: '2026-03-16', primaryDocument: 'prospectus.htm' },
      { accessionNumber: '0001-23-458', form: '10-K', filingDate: '2026-03-15', primaryDocument: 'annual.htm' },
      { accessionNumber: '0001-23-459', form: 'N-CSR', filingDate: '2026-03-10', primaryDocument: 'report.htm' },
    ],
  },
};

describe('edgar-api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_SUBMISSIONS),
    });
  });

  describe('fetchSubmissions', () => {
    it('fetches submissions for a CIK with User-Agent header', async () => {
      const result = await fetchSubmissions('0000102909');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://data.sec.gov/submissions/CIK0000102909.json',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('nestfolio'),
          }),
        }),
      );
      expect(result.cik).toBe('0000102909');
    });
  });

  describe('filterRecentFilings', () => {
    it('returns only filings matching target forms since cutoff date', () => {
      const filings = filterRecentFilings(
        SAMPLE_SUBMISSIONS.recentFilings.filings as EdgarFiling[],
        ['8-K', '485BPOS', '10-K'],
        '2026-03-15',
      );
      expect(filings).toHaveLength(3);
      expect(filings.map((f) => f.form)).toEqual(['8-K', '485BPOS', '10-K']);
    });

    it('excludes filings before cutoff date', () => {
      const filings = filterRecentFilings(
        SAMPLE_SUBMISSIONS.recentFilings.filings as EdgarFiling[],
        ['8-K', '485BPOS', '10-K', 'N-CSR'],
        '2026-03-16',
      );
      expect(filings).toHaveLength(2);
    });

    it('excludes forms not in target list', () => {
      const filings = filterRecentFilings(
        SAMPLE_SUBMISSIONS.recentFilings.filings as EdgarFiling[],
        ['8-K'],
        '2026-03-01',
      );
      expect(filings).toHaveLength(1);
      expect(filings[0].form).toBe('8-K');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test sec-edgar-adpt -- --testPathPattern=edgar-api`
Expected: FAIL

- [ ] **Step 3: Implement EDGAR API client**

```ts
// services/advisory/sec-edgar-adpt/src/clients/edgar-api.ts

const BASE_URL = 'https://data.sec.gov';
const USER_AGENT = 'nestfolio/1.0 (advisory-agent; contact@nestfolio.dev)';
const FETCH_TIMEOUT_MS = 15_000;

export interface EdgarFiling {
  readonly accessionNumber: string;
  readonly form: string;
  readonly filingDate: string;
  readonly primaryDocument: string;
}

export interface EdgarSubmissions {
  readonly cik: string;
  readonly entityType: string;
  readonly name: string;
  readonly recentFilings: {
    readonly filings: EdgarFiling[];
  };
}

export async function fetchSubmissions(cik: string): Promise<EdgarSubmissions> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const response = await fetch(`${BASE_URL}/submissions/CIK${cik}.json`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`EDGAR API error: ${response.status} for CIK ${cik}`);
  }

  return response.json() as Promise<EdgarSubmissions>;
}

/**
 * Filters filings to only include target form types filed since the cutoff date.
 */
export function filterRecentFilings(
  filings: EdgarFiling[],
  targetForms: string[],
  sinceDate: string,
): EdgarFiling[] {
  const formSet = new Set(targetForms);
  return filings.filter(
    (f) => formSet.has(f.form) && f.filingDate >= sinceDate,
  );
}

/**
 * Builds a filing content URL from an accession number and primary document.
 */
export function buildFilingUrl(accessionNumber: string, primaryDocument: string): string {
  const stripped = accessionNumber.replace(/-/g, '');
  return `${BASE_URL}/Archives/edgar/data/${stripped}/${primaryDocument}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test sec-edgar-adpt -- --testPathPattern=edgar-api`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/advisory/sec-edgar-adpt/src/clients/edgar-api.ts \
       services/advisory/sec-edgar-adpt/test/edgar-api.test.ts
git commit -m "feat(sec-edgar-adpt): add EDGAR API client with submissions fetch and filing filter

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Implement sec-edgar-adpt event-publisher handler

**Files:**
- Create: `services/advisory/sec-edgar-adpt/src/handlers/event-publisher.ts`
- Test: `services/advisory/sec-edgar-adpt/test/event-publisher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/advisory/sec-edgar-adpt/test/event-publisher.test.ts
const mockPublishOrUpload = jest.fn().mockResolvedValue(undefined);
const mockFetchSubmissions = jest.fn();
const mockFilterRecentFilings = jest.fn();

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  EventBridgeBus: jest.fn().mockImplementation(() => ({ publish: jest.fn() })),
  publishOrUpload: mockPublishOrUpload,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  envVar: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'sec-edgar-adpt',
      KB_BUCKET: 'test-kb-bucket',
      TRACKED_CIKS: '0000102909,0000088053',
    };
    return vars[name] ?? '';
  }),
}));

jest.mock('../src/clients/edgar-api', () => ({
  fetchSubmissions: (...args: unknown[]) => mockFetchSubmissions(...args),
  filterRecentFilings: (...args: unknown[]) => mockFilterRecentFilings(...args),
  buildFilingUrl: jest.fn().mockReturnValue('https://sec.gov/filing.htm'),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { createHandler } from '../src/handlers/event-publisher';

describe('sec-edgar-adpt event-publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchSubmissions.mockResolvedValue({
      cik: '0000102909',
      name: 'Vanguard',
      recentFilings: { filings: [] },
    });
    mockFilterRecentFilings.mockReturnValue([]);
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html>Filing content</html>'),
    });
  });

  it('fetches submissions for each tracked CIK', async () => {
    const handler = createHandler();
    await handler();

    expect(mockFetchSubmissions).toHaveBeenCalledTimes(2);
    expect(mockFetchSubmissions).toHaveBeenCalledWith('0000102909');
    expect(mockFetchSubmissions).toHaveBeenCalledWith('0000088053');
  });

  it('publishes SEC_8K_FILED for 8-K filings', async () => {
    mockFilterRecentFilings.mockReturnValue([
      { accessionNumber: '0001-23-456', form: '8-K', filingDate: '2026-03-17', primaryDocument: 'doc.htm' },
    ]);

    const handler = createHandler();
    await handler();

    const call8k = mockPublishOrUpload.mock.calls.find(
      (c: any) => c[0].eventType === 'SEC_8K_FILED',
    );
    expect(call8k).toBeDefined();
    expect(call8k![0].content.source).toBe('sec-edgar');
    expect(call8k![0].content.form).toBe('8-K');
  });

  it('publishes SEC_PROSPECTUS_UPDATED for 485BPOS filings', async () => {
    mockFilterRecentFilings.mockReturnValue([
      { accessionNumber: '0001-23-457', form: '485BPOS', filingDate: '2026-03-16', primaryDocument: 'prospectus.htm' },
    ]);

    const handler = createHandler();
    await handler();

    const callProspectus = mockPublishOrUpload.mock.calls.find(
      (c: any) => c[0].eventType === 'SEC_PROSPECTUS_UPDATED',
    );
    expect(callProspectus).toBeDefined();
  });

  it('publishes SEC_10K_UPDATED for 10-K filings', async () => {
    mockFilterRecentFilings.mockReturnValue([
      { accessionNumber: '0001-23-458', form: '10-K', filingDate: '2026-03-15', primaryDocument: 'annual.htm' },
    ]);

    const handler = createHandler();
    await handler();

    const call10k = mockPublishOrUpload.mock.calls.find(
      (c: any) => c[0].eventType === 'SEC_10K_UPDATED',
    );
    expect(call10k).toBeDefined();
  });

  it('continues processing remaining CIKs when one fails', async () => {
    mockFetchSubmissions
      .mockRejectedValueOnce(new Error('EDGAR API error'))
      .mockResolvedValueOnce({
        cik: '0000088053',
        name: 'BlackRock',
        recentFilings: { filings: [] },
      });

    const handler = createHandler();
    await handler();

    expect(mockFetchSubmissions).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test sec-edgar-adpt -- --testPathPattern=event-publisher`
Expected: FAIL

- [ ] **Step 3: Implement event-publisher handler**

```ts
// services/advisory/sec-edgar-adpt/src/handlers/event-publisher.ts
import {
  EventBridgeBus,
  envVar,
  logger,
  publishOrUpload,
} from '@nestfolio/event-processor';
import { fetchSubmissions, filterRecentFilings, buildFilingUrl } from '../clients/edgar-api';
import { SecEdgarAdptEventTypes } from '../service-domain/events';

const TARGET_FORMS = ['8-K', '485BPOS', 'N-1A', '10-K', '10-Q'];

const FORM_TO_EVENT: Record<string, string> = {
  '8-K': SecEdgarAdptEventTypes.SEC_8K_FILED,
  '485BPOS': SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED,
  'N-1A': SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED,
  '10-K': SecEdgarAdptEventTypes.SEC_10K_UPDATED,
  '10-Q': SecEdgarAdptEventTypes.SEC_10K_UPDATED,
};

function getCutoffDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function createHandler() {
  const busName = envVar('BUS_NAME');
  const serviceName = envVar('SERVICE_NAME');
  const bucket = envVar('KB_BUCKET');
  const ciks = envVar('TRACKED_CIKS').split(',').map((c) => c.trim());

  const bus = new EventBridgeBus(busName, serviceName);

  return async (): Promise<void> => {
    const sinceDate = getCutoffDate();
    logger.info('Starting SEC EDGAR filing scan', { ciks, sinceDate });

    for (const cik of ciks) {
      try {
        const submissions = await fetchSubmissions(cik);
        const filings = filterRecentFilings(
          submissions.recentFilings.filings,
          TARGET_FORMS,
          sinceDate,
        );

        logger.info('Found filings', { cik, name: submissions.name, count: filings.length });

        for (const filing of filings) {
          const eventType = FORM_TO_EVENT[filing.form];
          if (!eventType) continue;

          try {
            const filingUrl = buildFilingUrl(filing.accessionNumber, filing.primaryDocument);
            const response = await fetch(filingUrl, {
              headers: { 'User-Agent': 'nestfolio/1.0 (advisory-agent; contact@nestfolio.dev)' },
            });

            const content = response.ok ? await response.text() : '';

            await publishOrUpload({
              bus,
              bucket,
              eventType,
              content: {
                source: 'sec-edgar',
                cik,
                issuer: submissions.name,
                form: filing.form,
                filingDate: filing.filingDate,
                accessionNumber: filing.accessionNumber,
                body: content,
              },
              serviceName,
            });

            logger.info('Published filing event', {
              eventType,
              cik,
              form: filing.form,
              accessionNumber: filing.accessionNumber,
            });
          } catch (error) {
            logger.error('Failed to fetch/publish filing', {
              cik,
              accessionNumber: filing.accessionNumber,
              error,
            });
          }
        }
      } catch (error) {
        logger.error('Failed to process CIK', { cik, error });
      }
    }
  };
}

export const handler = createHandler();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test sec-edgar-adpt -- --testPathPattern=event-publisher`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add services/advisory/sec-edgar-adpt/src/handlers/event-publisher.ts \
       services/advisory/sec-edgar-adpt/test/event-publisher.test.ts
git commit -m "feat(sec-edgar-adpt): implement filing scan and multi-event publish

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Implement sec-edgar-adpt service.stack.ts and main.ts

**Files:**
- Create: `services/advisory/sec-edgar-adpt/src/service.stack.ts`
- Create: `services/advisory/sec-edgar-adpt/src/main.ts`

- [ ] **Step 1: Implement service.stack.ts**

Same pattern as yahoo-finance-adpt stack but with:
- `SecEdgarAdptStack extends ServiceStack` with subsystem `advisory`, service `sec-edgar-adpt`
- KB bucket SSM: both `/nestfolio/{prefix}-advisory/kb-market/bucketName` (for 8-K) and `/nestfolio/{prefix}-advisory/kb-fund/bucketName` (for prospectuses/10-K). Use market bucket as primary; consumer services handle routing.
- Env vars: `BUS_NAME`, `SERVICE_NAME`, `KB_BUCKET`, `TRACKED_CIKS` (default: `0000102909,0000088053,0000914208`)
- Lambda timeout: 120s (EDGAR filings can be large and multiple)
- Schedule default: `rate(24 hours)`

```ts
// services/advisory/sec-edgar-adpt/src/service.stack.ts
import { join } from 'path';
import { Duration, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  ServiceStack,
  defaultLambdaProps,
  Monitoring,
  ServiceDashboard,
} from '@nestfolio/cdk-constructs';

export class SecEdgarAdptStack extends ServiceStack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & {
      prefix: string;
      schedule?: { enabled: boolean; rate: string };
    },
  ) {
    super(scope, id, {
      ...props,
      prefix: props.prefix,
      subsystem: 'advisory',
      service: 'sec-edgar-adpt',
      serviceDir: __dirname,
    });

    const scheduleConfig = props.schedule ?? { enabled: false, rate: 'rate(24 hours)' };

    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/event-hub/busArn`,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    const kbBucketName = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/kb-market/bucketName`,
    );
    const kbBucket = Bucket.fromBucketName(this, 'KbBucket', kbBucketName);

    const eventPublisher = new NodejsFunction(this, 'EventPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers/event-publisher.ts'),
      handler: 'handler',
      timeout: Duration.seconds(120),
      memorySize: 512,
      environment: {
        BUS_NAME: advisoryBus.eventBusName,
        SERVICE_NAME: 'sec-edgar-adpt',
        KB_BUCKET: kbBucketName,
        TRACKED_CIKS: '0000102909,0000088053,0000914208',
      },
    });

    advisoryBus.grantPutEventsTo(eventPublisher);
    kbBucket.grantReadWrite(eventPublisher);

    const schedulerRole = new Role(this, 'SchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    eventPublisher.grantInvoke(schedulerRole);

    new scheduler.CfnSchedule(this, 'FetchSchedule', {
      name: `${props.prefix}-sec-edgar-fetch`,
      scheduleExpression: scheduleConfig.rate,
      state: scheduleConfig.enabled ? 'ENABLED' : 'DISABLED',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: eventPublisher.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', { lambdaFunctions: [eventPublisher] });
      new ServiceDashboard(this, 'Dashboard', { lambdaFunctions: [eventPublisher] });
    }
  }
}
```

- [ ] **Step 2: Implement main.ts**

```ts
// services/advisory/sec-edgar-adpt/src/main.ts
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { SecEdgarAdptStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'sec-edgar-adpt');

const schedule = (config as any).schedule ?? { enabled: false, rate: 'rate(24 hours)' };

new SecEdgarAdptStack(app, `${config.prefix}-sec-edgar-adpt`, {
  prefix: config.prefix,
  schedule,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/sec-edgar-adpt/src/service.stack.ts \
       services/advisory/sec-edgar-adpt/src/main.ts
git commit -m "feat(sec-edgar-adpt): add CDK stack with S3 write access for large filings

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Add sec-edgar-adpt integration test for filing type routing

**Files:**
- Extend: `services/advisory/sec-edgar-adpt/test/event-publisher.test.ts` (already created in Task 11)

This task is already covered by Task 11 tests. Verify all tests pass:

- [ ] **Step 1: Run all sec-edgar-adpt tests**

Run: `npx nx test sec-edgar-adpt`
Expected: PASS (all tests from Tasks 10 + 11)

- [ ] **Step 2: Commit (if any test adjustments needed)**

```bash
git add services/advisory/sec-edgar-adpt/test/
git commit -m "test(sec-edgar-adpt): verify filing type routing to correct event types

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Chunk 3: fred-adpt + alpha-vantage-adpt

### Task 14: Scaffold fred-adpt project

**Files:**
- Create: `services/advisory/fred-adpt/project.json`
- Create: `services/advisory/fred-adpt/tsconfig.json`
- Create: `services/advisory/fred-adpt/tsconfig.spec.json`
- Create: `services/advisory/fred-adpt/jest.config.js`
- Create: `services/advisory/fred-adpt/src/service-domain/events.ts`
- Create: `services/advisory/fred-adpt/src/service-domain/index.ts`

- [ ] **Step 1: Create project.json**

```json
// services/advisory/fred-adpt/project.json
{
  "name": "fred-adpt",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/advisory/fred-adpt/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/fred-adpt/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/fred-adpt/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/advisory/fred-adpt/jest.config.js" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:advisory", "type:adpt"]
}
```

- [ ] **Step 2: Create tsconfig.json, tsconfig.spec.json, jest.config.js**

Same pattern — `displayName: 'fred-adpt'`.

- [ ] **Step 3: Create service-domain events**

```ts
// services/advisory/fred-adpt/src/service-domain/events.ts
export const FredAdptEventTypes = {
  FRED_INDICATORS_UPDATED: 'FRED_INDICATORS_UPDATED',
} as const;
```

```ts
// services/advisory/fred-adpt/src/service-domain/index.ts
export { FredAdptEventTypes } from './events';
```

- [ ] **Step 4: Commit**

```bash
git add services/advisory/fred-adpt/
git commit -m "chore(fred-adpt): scaffold project structure

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Implement fred-adpt event-publisher handler

**Files:**
- Create: `services/advisory/fred-adpt/src/handlers/event-publisher.ts`
- Test: `services/advisory/fred-adpt/test/event-publisher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/advisory/fred-adpt/test/event-publisher.test.ts
const mockPublishOrUpload = jest.fn().mockResolvedValue(undefined);

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  EventBridgeBus: jest.fn().mockImplementation(() => ({ publish: jest.fn() })),
  publishOrUpload: mockPublishOrUpload,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  envVar: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'fred-adpt',
      KB_BUCKET: 'test-kb-bucket',
      FRED_API_KEY: 'test-api-key',
    };
    return vars[name] ?? '';
  }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { createHandler, TRACKED_SERIES } from '../src/handlers/event-publisher';

const SAMPLE_FRED_RESPONSE = {
  observations: [
    { date: '2026-03-17', value: '5.33' },
    { date: '2026-03-16', value: '5.31' },
  ],
};

describe('fred-adpt event-publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_FRED_RESPONSE),
    });
  });

  it('fetches all tracked series and publishes a single aggregated event', async () => {
    const handler = createHandler();
    await handler();

    // One fetch per series
    expect(mockFetch).toHaveBeenCalledTimes(TRACKED_SERIES.length);

    // One aggregated publish
    expect(mockPublishOrUpload).toHaveBeenCalledTimes(1);
    const call = mockPublishOrUpload.mock.calls[0][0];
    expect(call.eventType).toBe('FRED_INDICATORS_UPDATED');
    expect(call.content.source).toBe('fred');
    expect(call.content.indicators).toBeInstanceOf(Array);
    expect(call.content.indicators.length).toBeGreaterThan(0);
    expect(call.content.indicators[0]).toEqual(
      expect.objectContaining({ seriesId: expect.any(String), date: expect.any(String), value: expect.any(String) }),
    );
  });

  it('includes API key in FRED API requests', async () => {
    const handler = createHandler();
    await handler();

    const firstUrl = mockFetch.mock.calls[0][0] as string;
    expect(firstUrl).toContain('api_key=test-api-key');
  });

  it('continues when a series fetch fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SAMPLE_FRED_RESPONSE),
      });

    const handler = createHandler();
    await handler();

    // Still publishes with remaining series
    expect(mockPublishOrUpload).toHaveBeenCalledTimes(1);
  });

  it('skips publish when all series fail', async () => {
    mockFetch.mockRejectedValue(new Error('All failing'));

    const handler = createHandler();
    await handler();

    expect(mockPublishOrUpload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test fred-adpt -- --testPathPattern=event-publisher`
Expected: FAIL

- [ ] **Step 3: Implement event-publisher handler**

```ts
// services/advisory/fred-adpt/src/handlers/event-publisher.ts
import {
  EventBridgeBus,
  envVar,
  logger,
  publishOrUpload,
} from '@nestfolio/event-processor';
import { FredAdptEventTypes } from '../service-domain/events';

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
const FETCH_TIMEOUT_MS = 10_000;

export const TRACKED_SERIES = [
  { seriesId: 'FEDFUNDS', label: 'Federal Funds Rate' },
  { seriesId: 'CPIAUCSL', label: 'CPI (Inflation)' },
  { seriesId: 'DGS10', label: '10-Year Treasury Yield' },
  { seriesId: 'VIXCLS', label: 'VIX (Volatility)' },
  { seriesId: 'SP500', label: 'S&P 500 Index' },
  { seriesId: 'UNRATE', label: 'Unemployment Rate' },
  { seriesId: 'DGS1', label: '1-Year Treasury' },
  { seriesId: 'DGS2', label: '2-Year Treasury' },
  { seriesId: 'DGS5', label: '5-Year Treasury' },
  { seriesId: 'DGS30', label: '30-Year Treasury' },
  { seriesId: 'BAMLC0A0CM', label: 'Corporate Bond Spread' },
] as const;

function getObservationStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7); // Fetch last 7 days of observations
  return d.toISOString().slice(0, 10);
}

export function createHandler() {
  const busName = envVar('BUS_NAME');
  const serviceName = envVar('SERVICE_NAME');
  const bucket = envVar('KB_BUCKET');
  const apiKey = envVar('FRED_API_KEY');

  const bus = new EventBridgeBus(busName, serviceName);

  return async (): Promise<void> => {
    const startDate = getObservationStartDate();
    logger.info('Starting FRED indicator fetch', { seriesCount: TRACKED_SERIES.length, startDate });

    const indicators: Array<{ seriesId: string; label: string; date: string; value: string }> = [];

    for (const series of TRACKED_SERIES) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const url = `${FRED_BASE_URL}?series_id=${series.seriesId}&api_key=${apiKey}&file_type=json&observation_start=${startDate}&sort_order=desc&limit=1`;
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          logger.warn('FRED fetch failed', { seriesId: series.seriesId, status: response.status });
          continue;
        }

        const data = await response.json() as { observations: Array<{ date: string; value: string }> };
        const latest = data.observations?.[0];

        if (latest && latest.value !== '.') {
          indicators.push({
            seriesId: series.seriesId,
            label: series.label,
            date: latest.date,
            value: latest.value,
          });
        }
      } catch (error) {
        logger.error('Failed to fetch series', { seriesId: series.seriesId, error });
      }
    }

    if (indicators.length === 0) {
      logger.warn('No indicators fetched, skipping publish');
      return;
    }

    await publishOrUpload({
      bus,
      bucket,
      eventType: FredAdptEventTypes.FRED_INDICATORS_UPDATED,
      content: { source: 'fred', indicators },
      serviceName,
    });

    logger.info('Published FRED indicators', { count: indicators.length });
  };
}

export const handler = createHandler();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test fred-adpt -- --testPathPattern=event-publisher`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/advisory/fred-adpt/src/handlers/event-publisher.ts \
       services/advisory/fred-adpt/test/event-publisher.test.ts
git commit -m "feat(fred-adpt): implement FRED API series fetch with aggregated publish

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Implement fred-adpt service.stack.ts and main.ts

**Files:**
- Create: `services/advisory/fred-adpt/src/service.stack.ts`
- Create: `services/advisory/fred-adpt/src/main.ts`

- [ ] **Step 1: Implement service.stack.ts**

```ts
// services/advisory/fred-adpt/src/service.stack.ts
import { join } from 'path';
import { Duration, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  ServiceStack,
  defaultLambdaProps,
  Monitoring,
  ServiceDashboard,
} from '@nestfolio/cdk-constructs';

export class FredAdptStack extends ServiceStack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & {
      prefix: string;
      schedule?: { enabled: boolean; rate: string };
    },
  ) {
    super(scope, id, {
      ...props,
      prefix: props.prefix,
      subsystem: 'advisory',
      service: 'fred-adpt',
      serviceDir: __dirname,
    });

    const scheduleConfig = props.schedule ?? { enabled: false, rate: 'rate(24 hours)' };

    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/event-hub/busArn`,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    const kbBucketName = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/kb-market/bucketName`,
    );
    const kbBucket = Bucket.fromBucketName(this, 'KbBucket', kbBucketName);

    // FRED API key from SSM
    const fredApiKey = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/fred-api-key`,
    );

    const eventPublisher = new NodejsFunction(this, 'EventPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers/event-publisher.ts'),
      handler: 'handler',
      timeout: Duration.seconds(60),
      environment: {
        BUS_NAME: advisoryBus.eventBusName,
        SERVICE_NAME: 'fred-adpt',
        KB_BUCKET: kbBucketName,
        FRED_API_KEY: fredApiKey,
      },
    });

    advisoryBus.grantPutEventsTo(eventPublisher);
    kbBucket.grantReadWrite(eventPublisher);

    const schedulerRole = new Role(this, 'SchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    eventPublisher.grantInvoke(schedulerRole);

    new scheduler.CfnSchedule(this, 'FetchSchedule', {
      name: `${props.prefix}-fred-fetch`,
      scheduleExpression: scheduleConfig.rate,
      state: scheduleConfig.enabled ? 'ENABLED' : 'DISABLED',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: eventPublisher.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', { lambdaFunctions: [eventPublisher] });
      new ServiceDashboard(this, 'Dashboard', { lambdaFunctions: [eventPublisher] });
    }
  }
}
```

- [ ] **Step 2: Implement main.ts**

```ts
// services/advisory/fred-adpt/src/main.ts
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { FredAdptStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'fred-adpt');

const schedule = (config as any).schedule ?? { enabled: false, rate: 'rate(24 hours)' };

new FredAdptStack(app, `${config.prefix}-fred-adpt`, {
  prefix: config.prefix,
  schedule,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/fred-adpt/src/service.stack.ts \
       services/advisory/fred-adpt/src/main.ts
git commit -m "feat(fred-adpt): add CDK stack with FRED API key from SSM

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Scaffold alpha-vantage-adpt project

**Files:**
- Create: `services/advisory/alpha-vantage-adpt/project.json`
- Create: `services/advisory/alpha-vantage-adpt/tsconfig.json`
- Create: `services/advisory/alpha-vantage-adpt/tsconfig.spec.json`
- Create: `services/advisory/alpha-vantage-adpt/jest.config.js`
- Create: `services/advisory/alpha-vantage-adpt/pipeline.json`
- Create: `services/advisory/alpha-vantage-adpt/src/service-domain/events.ts`
- Create: `services/advisory/alpha-vantage-adpt/src/service-domain/index.ts`

- [ ] **Step 1: Create project.json**

```json
// services/advisory/alpha-vantage-adpt/project.json
{
  "name": "alpha-vantage-adpt",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/advisory/alpha-vantage-adpt/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/alpha-vantage-adpt/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/advisory/alpha-vantage-adpt/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/advisory/alpha-vantage-adpt/jest.config.js" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:advisory", "type:adpt"]
}
```

- [ ] **Step 2: Create tsconfig.json, tsconfig.spec.json, jest.config.js**

Same pattern — `displayName: 'alpha-vantage-adpt'`.

- [ ] **Step 3: Create pipeline.json override**

```json
// services/advisory/alpha-vantage-adpt/pipeline.json
{
  "production": {
    "schedule": { "rate": "rate(12 hours)" }
  }
}
```

- [ ] **Step 4: Create service-domain events**

```ts
// services/advisory/alpha-vantage-adpt/src/service-domain/events.ts
export const AlphaVantageAdptEventTypes = {
  ALPHA_VANTAGE_NEWS_UPDATED: 'ALPHA_VANTAGE_NEWS_UPDATED',
} as const;
```

```ts
// services/advisory/alpha-vantage-adpt/src/service-domain/index.ts
export { AlphaVantageAdptEventTypes } from './events';
```

- [ ] **Step 5: Commit**

```bash
git add services/advisory/alpha-vantage-adpt/
git commit -m "chore(alpha-vantage-adpt): scaffold project with pipeline.json rate(12 hours) override

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Implement alpha-vantage-adpt event-publisher handler

**Files:**
- Create: `services/advisory/alpha-vantage-adpt/src/handlers/event-publisher.ts`
- Test: `services/advisory/alpha-vantage-adpt/test/event-publisher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/advisory/alpha-vantage-adpt/test/event-publisher.test.ts
const mockPublishOrUpload = jest.fn().mockResolvedValue(undefined);

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  EventBridgeBus: jest.fn().mockImplementation(() => ({ publish: jest.fn() })),
  publishOrUpload: mockPublishOrUpload,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  envVar: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'alpha-vantage-adpt',
      KB_BUCKET: 'test-kb-bucket',
      ALPHA_VANTAGE_API_KEY: 'test-av-key',
    };
    return vars[name] ?? '';
  }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { createHandler } from '../src/handlers/event-publisher';

const SAMPLE_NEWS_RESPONSE = {
  feed: [
    {
      title: 'VTI gains 2%',
      url: 'https://example.com/vti-gains',
      time_published: '20260317T100000',
      summary: 'Total market ETF surges',
      overall_sentiment_score: 0.85,
      overall_sentiment_label: 'Bullish',
      ticker_sentiment: [{ ticker: 'VTI', relevance_score: '0.95', ticker_sentiment_score: '0.88' }],
    },
  ],
};

const SAMPLE_EARNINGS_RESPONSE = {
  quarterlyEarnings: [
    { fiscalDateEnding: '2026-03-31', reportedEPS: '2.50', estimatedEPS: '2.40', surprise: '0.10' },
  ],
};

const SAMPLE_ECONOMIC_RESPONSE = {
  name: 'Real GDP',
  data: [{ date: '2026-01-01', value: '22000.5' }],
};

describe('alpha-vantage-adpt event-publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_NEWS_RESPONSE),
    });
  });

  it('fetches news sentiment for configured tickers', async () => {
    const handler = createHandler();
    await handler();

    const newsCalls = mockFetch.mock.calls.filter(
      (c: any) => (c[0] as string).includes('NEWS_SENTIMENT'),
    );
    expect(newsCalls.length).toBeGreaterThan(0);

    // At least one publish call
    expect(mockPublishOrUpload).toHaveBeenCalled();
    const newsCall = mockPublishOrUpload.mock.calls.find(
      (c: any) => c[0].content.type === 'news',
    );
    expect(newsCall).toBeDefined();
    expect(newsCall![0].eventType).toBe('ALPHA_VANTAGE_NEWS_UPDATED');
    expect(newsCall![0].content.source).toBe('alpha-vantage');
  });

  it('fetches economic indicators', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_ECONOMIC_RESPONSE),
    });

    const handler = createHandler();
    await handler();

    const econCalls = mockFetch.mock.calls.filter(
      (c: any) => {
        const url = c[0] as string;
        return url.includes('REAL_GDP') || url.includes('CPI') || url.includes('TREASURY_YIELD');
      },
    );
    expect(econCalls.length).toBeGreaterThan(0);
  });

  it('respects 25 request budget', async () => {
    const handler = createHandler();
    await handler();

    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(25);
  });

  it('continues when a request fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Rate limited'))
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SAMPLE_NEWS_RESPONSE),
      });

    const handler = createHandler();
    await handler();

    expect(mockPublishOrUpload).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test alpha-vantage-adpt -- --testPathPattern=event-publisher`
Expected: FAIL

- [ ] **Step 3: Implement event-publisher handler**

```ts
// services/advisory/alpha-vantage-adpt/src/handlers/event-publisher.ts
import {
  EventBridgeBus,
  envVar,
  logger,
  publishOrUpload,
} from '@nestfolio/event-processor';
import { AlphaVantageAdptEventTypes } from '../service-domain/events';

const AV_BASE_URL = 'https://www.alphavantage.co/query';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REQUESTS_PER_CYCLE = 25;

const NEWS_TICKERS = ['VTI', 'BND', 'QQQ', 'SPY'];
const ECONOMIC_FUNCTIONS = ['REAL_GDP', 'CPI', 'TREASURY_YIELD', 'FEDERAL_FUNDS_RATE', 'UNEMPLOYMENT'];

export function createHandler() {
  const busName = envVar('BUS_NAME');
  const serviceName = envVar('SERVICE_NAME');
  const bucket = envVar('KB_BUCKET');
  const apiKey = envVar('ALPHA_VANTAGE_API_KEY');

  const bus = new EventBridgeBus(busName, serviceName);

  async function fetchAV(params: Record<string, string>): Promise<unknown | null> {
    const url = new URL(AV_BASE_URL);
    url.searchParams.set('apikey', apiKey);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) return null;
      return response.json();
    } catch (error) {
      clearTimeout(timeout);
      logger.error('Alpha Vantage fetch failed', { params, error });
      return null;
    }
  }

  return async (): Promise<void> => {
    logger.info('Starting Alpha Vantage data fetch');

    let requestCount = 0;
    const newsData: unknown[] = [];
    const economicData: unknown[] = [];

    // Phase 1: News sentiment for each ticker
    for (const ticker of NEWS_TICKERS) {
      if (requestCount >= MAX_REQUESTS_PER_CYCLE - ECONOMIC_FUNCTIONS.length) break;

      const data = await fetchAV({ function: 'NEWS_SENTIMENT', tickers: ticker });
      requestCount++;

      if (data && (data as any).feed) {
        newsData.push(...(data as any).feed);
      }
    }

    // Phase 2: Economic indicators
    for (const fn of ECONOMIC_FUNCTIONS) {
      if (requestCount >= MAX_REQUESTS_PER_CYCLE) break;

      const data = await fetchAV({ function: fn });
      requestCount++;

      if (data) {
        economicData.push({ function: fn, data });
      }
    }

    logger.info('Alpha Vantage fetch complete', { requestCount, newsItems: newsData.length, econItems: economicData.length });

    // Publish news data
    if (newsData.length > 0) {
      await publishOrUpload({
        bus,
        bucket,
        eventType: AlphaVantageAdptEventTypes.ALPHA_VANTAGE_NEWS_UPDATED,
        content: { source: 'alpha-vantage', type: 'news', data: newsData },
        serviceName,
      });
    }

    // Publish economic data
    if (economicData.length > 0) {
      await publishOrUpload({
        bus,
        bucket,
        eventType: AlphaVantageAdptEventTypes.ALPHA_VANTAGE_NEWS_UPDATED,
        content: { source: 'alpha-vantage', type: 'economic', data: economicData },
        serviceName,
      });
    }
  };
}

export const handler = createHandler();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test alpha-vantage-adpt -- --testPathPattern=event-publisher`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/advisory/alpha-vantage-adpt/src/handlers/event-publisher.ts \
       services/advisory/alpha-vantage-adpt/test/event-publisher.test.ts
git commit -m "feat(alpha-vantage-adpt): implement budget-aware news + economic fetch

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Implement alpha-vantage-adpt service.stack.ts and main.ts

**Files:**
- Create: `services/advisory/alpha-vantage-adpt/src/service.stack.ts`
- Create: `services/advisory/alpha-vantage-adpt/src/main.ts`

- [ ] **Step 1: Implement service.stack.ts**

```ts
// services/advisory/alpha-vantage-adpt/src/service.stack.ts
import { join } from 'path';
import { Duration, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  ServiceStack,
  defaultLambdaProps,
  Monitoring,
  ServiceDashboard,
} from '@nestfolio/cdk-constructs';

export class AlphaVantageAdptStack extends ServiceStack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & {
      prefix: string;
      schedule?: { enabled: boolean; rate: string };
    },
  ) {
    super(scope, id, {
      ...props,
      prefix: props.prefix,
      subsystem: 'advisory',
      service: 'alpha-vantage-adpt',
      serviceDir: __dirname,
    });

    const scheduleConfig = props.schedule ?? { enabled: false, rate: 'rate(24 hours)' };

    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/event-hub/busArn`,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);

    const kbBucketName = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/kb-market/bucketName`,
    );
    const kbBucket = Bucket.fromBucketName(this, 'KbBucket', kbBucketName);

    // Alpha Vantage API key from SSM
    const avApiKey = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-advisory/alpha-vantage-api-key`,
    );

    const eventPublisher = new NodejsFunction(this, 'EventPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers/event-publisher.ts'),
      handler: 'handler',
      timeout: Duration.seconds(90),
      environment: {
        BUS_NAME: advisoryBus.eventBusName,
        SERVICE_NAME: 'alpha-vantage-adpt',
        KB_BUCKET: kbBucketName,
        ALPHA_VANTAGE_API_KEY: avApiKey,
      },
    });

    advisoryBus.grantPutEventsTo(eventPublisher);
    kbBucket.grantReadWrite(eventPublisher);

    const schedulerRole = new Role(this, 'SchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    eventPublisher.grantInvoke(schedulerRole);

    new scheduler.CfnSchedule(this, 'FetchSchedule', {
      name: `${props.prefix}-alpha-vantage-fetch`,
      scheduleExpression: scheduleConfig.rate,
      state: scheduleConfig.enabled ? 'ENABLED' : 'DISABLED',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: eventPublisher.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });

    if (this.observability) {
      new Monitoring(this, 'Monitoring', { lambdaFunctions: [eventPublisher] });
      new ServiceDashboard(this, 'Dashboard', { lambdaFunctions: [eventPublisher] });
    }
  }
}
```

- [ ] **Step 2: Implement main.ts**

```ts
// services/advisory/alpha-vantage-adpt/src/main.ts
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { AlphaVantageAdptStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'alpha-vantage-adpt');

const schedule = (config as any).schedule ?? { enabled: false, rate: 'rate(24 hours)' };

new AlphaVantageAdptStack(app, `${config.prefix}-alpha-vantage-adpt`, {
  prefix: config.prefix,
  schedule,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/alpha-vantage-adpt/src/service.stack.ts \
       services/advisory/alpha-vantage-adpt/src/main.ts
git commit -m "feat(alpha-vantage-adpt): add CDK stack with API key from SSM + rate(12h) production override

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: Update pipeline-defaults.json and add schedule tier defaults

**Files:**
- Edit: `infrastructure/pipeline-defaults.json`

- [ ] **Step 1: Add schedule defaults to pipeline-defaults.json**

Add `schedule` key to each tier:

```json
{
  "$schema": "./pipeline-defaults-schema.json",
  "sandbox": {
    "observability": false,
    "logRetention": 7,
    "protectedResources": false,
    "parallelDeploy": true,
    "alarmActions": [],
    "schedule": { "enabled": false, "rate": "rate(24 hours)" }
  },
  "staging": {
    "observability": true,
    "logRetention": 30,
    "protectedResources": false,
    "parallelDeploy": true,
    "alarmActions": [],
    "schedule": { "enabled": true, "rate": "rate(24 hours)" }
  },
  "production": {
    "observability": true,
    "logRetention": 90,
    "protectedResources": true,
    "parallelDeploy": true,
    "alarmActions": [],
    "schedule": { "enabled": true, "rate": "rate(6 hours)" }
  }
}
```

- [ ] **Step 2: Run all adapter tests to verify nothing breaks**

Run: `npx nx run-many --target=test --projects=yahoo-finance-adpt,marketwatch-adpt,sec-edgar-adpt,fred-adpt,alpha-vantage-adpt,event-processor`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add infrastructure/pipeline-defaults.json
git commit -m "feat(pipeline): add schedule tier defaults for adapter services

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Verification Checklist

After completing all 20 tasks:

- [ ] `npx nx run-many --target=test --all` — all projects pass
- [ ] `npx nx graph` — verify 5 new adapter projects appear under `services/advisory/`
- [ ] Each adapter has: project.json, tsconfig.json, tsconfig.spec.json, jest.config.js, src/, test/
- [ ] Event types exported: YAHOO_FINANCE_UPDATED, MARKETWATCH_UPDATED, SEC_8K_FILED, SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED, FRED_INDICATORS_UPDATED, ALPHA_VANTAGE_NEWS_UPDATED
- [ ] alpha-vantage-adpt has `pipeline.json` with production `rate(12 hours)` override
- [ ] pipeline-defaults.json has `schedule` config for all 3 tiers
- [ ] `publishOrUpload` and `parseRssFeed` exported from `@nestfolio/event-processor`
