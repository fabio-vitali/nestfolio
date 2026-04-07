# Integration Test Full Coverage — Plan B: Adapter Mocks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mock-based integration tests for all 5 advisory data-feed adapters, replacing flaky external API calls with deterministic mock Lambdas.

**Architecture:** Each adapter gets a mock handler Lambda (deployed via MockApiFixture) that mimics the external API. SsmOverrideFixture redirects the adapter's base URL to the mock. Tests send events via EventBridgeClient, assert DDB writes via TableAssertions, and verify CDC events via EventBusTrap. Every test is fully isolated — no external API calls, no residual data.

**Tech Stack:** TypeScript, Jest, AWS Lambda (mock handlers), EventBridge, DynamoDB, SQS

**Branch:** `feat/all-services-integration-tests` (continue from Plan A)

**Design Spec:** `docs/superpowers/specs/2026-04-07-integration-test-full-coverage-design.md`

**Gold standard:** `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts` + `test/mocks/mock-alpaca.ts`

**Pre-requisites (Plan A completed):**
- DdbSeedFixture at `libs/integration-testing/src/fixtures/ddb-seed.fixture.ts`
- TableAssertions has `registerCleanup()` with auto-tracking
- 3 adapters (marketwatch, yahoo-finance, sec-edgar) have SSM base URL params deployed
- mock-alpaca migrated to `services/execution/broker-alpaca-adpt/test/mocks/`
- `build-mock` target pattern established in `broker-alpaca-adpt/project.json`

**Important conventions:**
- Mock handlers detect test scenarios via ID prefixes: `integ-ok-*` → success, `integ-error-*` → failure
- All mock handlers use `APIGatewayProxyEventV2` type (Lambda Function URL format)
- `json()` helper for responses: `{ statusCode, body: JSON.stringify(body), headers: { 'Content-Type': ... } }`
- Tests use `TableAssertions.registerCleanup()` for auto DDB cleanup

**Tasks 1-5 are fully independent and can run in parallel.**

---

### Task 1: alpha-vantage-adpt Mock & Tests

**Files:**
- Create: `services/advisory/alpha-vantage-adpt/test/mocks/mock-alpha-vantage.ts`
- Modify: `services/advisory/alpha-vantage-adpt/project.json` — add `build-mock` target
- Rewrite: `services/advisory/alpha-vantage-adpt/test/integration/alpha-vantage-adpt.integration.test.ts`

**Context:** The handler sends GET requests to `https://www.alphavantage.co/query` with `?function=NEWS_SENTIMENT&tickers={ticker}&apikey={key}` (for news) or `?function={fn}&apikey={key}` (for indicators). It expects JSON responses. DDB entities: `AlphaVantageArticle` (pk: `AlphaVantage#SYSTEM`, sk: `Article#{ticker}#{dateStr}#{i}`) and `EconomicIndicator` (pk: `AlphaVantage#SYSTEM`, sk: `Indicator#{fn}`). CDC events: `ALPHA_VANTAGE_NEWS_UPDATED`, `ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED`. SSM parameter: `/nestfolio/{prefix}-advisory/alpha-vantage-api-key`.

The existing SSM parameter holds the API key (not a base URL). The handler constructs its own URL with the hardcoded base `https://www.alphavantage.co/query`. Since Plan A added SSM base URL to the 3 RSS-based adapters but NOT to alpha-vantage-adpt (it already uses API key via env var), we need to also add a base URL SSM parameter to this service. Follow the same ParamsAndSecrets pattern from Plan A Task 3.

**Wait** — re-read the design spec. Alpha Vantage already has an SSM parameter at `/nestfolio/{prefix}-advisory/alpha-vantage-api-key` for the API key. But the base URL `https://www.alphavantage.co/query` is hardcoded. We need to add a base URL SSM parameter.

- [ ] **Step 1: Read current alpha-vantage-adpt stack and handler**

Read:
- `services/advisory/alpha-vantage-adpt/src/service.stack.ts`
- `services/advisory/alpha-vantage-adpt/src/handlers/event-listener.ts`

Identify where the base URL `https://www.alphavantage.co/query` is hardcoded and how the API key is used.

- [ ] **Step 2: Add SSM base URL parameter to CDK stack**

Follow the same ParamsAndSecrets pattern from Plan A Task 3. Add:
- SSM parameter: `/nestfolio/${this.prefix}-alpha-vantage-adpt/alpha-vantage/baseUrl`
- Default value: `https://www.alphavantage.co/query`
- Env var: `ALPHA_VANTAGE_BASE_URL_PARAM`
- ParamsAndSecrets layer on Ingress Lambda
- IAM policy for SSM access

Note: The stack may already have ParamsAndSecrets for the API key. If not, add it. If yes, just add the new env var and SSM parameter.

- [ ] **Step 3: Update handler to read base URL from SSM extension**

Replace the hardcoded base URL with a runtime SSM fetch via the Lambda extension:

```typescript
const AV_BASE_URL_PARAM = process.env['ALPHA_VANTAGE_BASE_URL_PARAM']!;

async function getBaseUrl(): Promise<string> {
  const encoded = encodeURIComponent(AV_BASE_URL_PARAM);
  const res = await fetch(`http://localhost:2773/systemsmanager/parameters/get?name=${encoded}`, {
    headers: { 'X-Aws-Parameters-Secrets-Token': process.env['AWS_SESSION_TOKEN']! },
  });
  const json = await res.json() as { Parameter: { Value: string } };
  return json.Parameter.Value;
}
```

Then use `await getBaseUrl()` instead of the hardcoded string when constructing the API URL.

- [ ] **Step 4: Deploy and verify SSM parameter**

```bash
pnpm nx deploy alpha-vantage-adpt -- --prefix=dev
aws ssm get-parameter --name "/nestfolio/dev-alpha-vantage-adpt/alpha-vantage/baseUrl" --query "Parameter.Value" --output text
```
Expected: `https://www.alphavantage.co/query`

- [ ] **Step 5: Create mock handler**

Create `services/advisory/alpha-vantage-adpt/test/mocks/mock-alpha-vantage.ts`:

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const params = event.queryStringParameters ?? {};
  const fn = params['function'] ?? '';

  // News sentiment endpoint
  if (fn === 'NEWS_SENTIMENT') {
    const tickers = params['tickers'] ?? 'VTI';
    return json(200, {
      items: '3',
      sentiment_score_definition: 'mock',
      feed: [
        {
          title: 'Mock Alpha Vantage Article 1',
          url: 'https://mock.example.com/article-1',
          time_published: '20260407T120000',
          summary: 'Integration test mock article for alpha-vantage-adpt',
          source: 'MockNews',
          ticker_sentiment: [{ ticker: tickers.split(',')[0], relevance_score: '0.95', ticker_sentiment_score: '0.5' }],
        },
        {
          title: 'Mock Alpha Vantage Article 2',
          url: 'https://mock.example.com/article-2',
          time_published: '20260407T110000',
          summary: 'Second mock article',
          source: 'MockNews',
          ticker_sentiment: [{ ticker: tickers.split(',')[0], relevance_score: '0.80', ticker_sentiment_score: '-0.2' }],
        },
      ],
    });
  }

  // Economic indicator endpoints (REAL_GDP, CPI, etc.)
  if (['REAL_GDP', 'CPI', 'TREASURY_YIELD', 'FEDERAL_FUNDS_RATE', 'UNEMPLOYMENT'].includes(fn)) {
    return json(200, {
      name: fn,
      interval: 'annual',
      unit: 'percent',
      data: [
        { date: '2026-01-01', value: '2.5' },
        { date: '2025-01-01', value: '2.3' },
      ],
    });
  }

  return json(400, { 'Error Message': `Unknown function: ${fn}` });
}
```

- [ ] **Step 6: Add build-mock target to project.json**

Add to `services/advisory/alpha-vantage-adpt/project.json` targets:

```json
"build-mock": {
  "executor": "nx:run-commands",
  "options": {
    "commands": [
      "mkdir -p services/advisory/alpha-vantage-adpt/test/mocks/dist",
      "npx esbuild services/advisory/alpha-vantage-adpt/test/mocks/mock-alpha-vantage.ts --bundle --platform=node --target=node20 --outfile=services/advisory/alpha-vantage-adpt/test/mocks/dist/index.mjs --format=esm",
      "cd services/advisory/alpha-vantage-adpt/test/mocks/dist && zip -j ../mock-alpha-vantage.zip index.mjs"
    ],
    "parallel": false
  },
  "outputs": ["services/advisory/alpha-vantage-adpt/test/mocks/mock-alpha-vantage.zip"]
}
```

- [ ] **Step 7: Build mock and verify zip**

```bash
pnpm nx build-mock alpha-vantage-adpt
ls -la services/advisory/alpha-vantage-adpt/test/mocks/mock-alpha-vantage.zip
```
Expected: zip file exists.

- [ ] **Step 8: Rewrite integration test**

Replace `services/advisory/alpha-vantage-adpt/test/integration/alpha-vantage-adpt.integration.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('alpha-vantage-adpt (mocked)', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    // Deploy mock Alpha Vantage Lambda
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-alpha-vantage.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-alpha-vantage',
      handlerAsset: readFileSync(zipPath),
    });

    // Override SSM base URL to point to mock
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-alpha-vantage-adpt/alpha-vantage/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: [
        'ALPHA_VANTAGE_NEWS_UPDATED',
        'ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should fetch news and emit ALPHA_VANTAGE_NEWS_UPDATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'alpha-vantage-adpt',
      detailType: 'FETCH_ALPHA_VANTAGE_REQUESTED',
      detail: {},
    });

    // Verify DDB write
    const item = await table.waitForItem({
      table: 'alpha-vantage-adpt',
      pk: 'AlphaVantage#SYSTEM',
      timeoutMs: 60_000,
    });
    expect(item['__typename']).toBe('AlphaVantageArticle');

    // Verify CDC event
    const event = await trap.waitForEvent({ detailType: 'ALPHA_VANTAGE_NEWS_UPDATED' });
    expect(event.detailType).toBe('ALPHA_VANTAGE_NEWS_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);

  it('should fetch economic indicators and emit ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'alpha-vantage-adpt',
      detailType: 'FETCH_ALPHA_VANTAGE_REQUESTED',
      detail: {},
    });

    // Wait for indicator CDC event (may take longer if news was processed first)
    const event = await trap.waitForEvent({
      detailType: 'ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED',
      timeoutMs: 90_000,
    });
    expect(event.detailType).toBe('ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED');
  }, 120_000);
});
```

- [ ] **Step 9: Run integration test**

```bash
pnpm nx build-mock alpha-vantage-adpt && pnpm nx test-integration alpha-vantage-adpt
```
Expected: 2 tests pass.

- [ ] **Step 10: Commit**

```bash
git add services/advisory/alpha-vantage-adpt/
git commit -m "feat(alpha-vantage-adpt): add mock handler and expand integration tests"
```

---

### Task 2: fred-adpt Mock & Tests

**Files:**
- Create: `services/advisory/fred-adpt/test/mocks/mock-fred.ts`
- Modify: `services/advisory/fred-adpt/project.json` — add `build-mock` target
- Rewrite: `services/advisory/fred-adpt/test/integration/fred-adpt.integration.test.ts`

**Context:** The handler sends GET requests to `https://api.stlouisfed.org/fred/series/observations?series_id={id}&api_key={key}&file_type=json&observation_start={date}&sort_order=desc&limit=1`. DDB entity: `FredIndicator` (pk: `Fred#SYSTEM`, sk: `Indicator#{seriesId}`). CDC: `FRED_INDICATORS_UPDATED`. Tracked series: FEDFUNDS, CPIAUCSL, DGS10, VIXCLS, DCOILWTICO, SP500, UNRATE, DGS1, DGS5, DGS30, BAMLC0A0CM.

Same as alpha-vantage: the base URL `https://api.stlouisfed.org/fred/series/observations` is hardcoded. Add SSM base URL parameter first.

- [ ] **Step 1: Read current fred-adpt stack and handler**

Read `services/advisory/fred-adpt/src/service.stack.ts` and `services/advisory/fred-adpt/src/handlers/event-listener.ts`.

- [ ] **Step 2: Add SSM base URL parameter to CDK stack**

SSM path: `/nestfolio/${this.prefix}-fred-adpt/fred/baseUrl`
Default: `https://api.stlouisfed.org/fred/series/observations`
Env var: `FRED_BASE_URL_PARAM`

Same ParamsAndSecrets pattern. Add SSM StringParameter, env var, and IAM policy.

- [ ] **Step 3: Update handler to use SSM base URL**

Replace hardcoded URL with `getBaseUrl()` fetched from SSM extension.

- [ ] **Step 4: Deploy and verify**

```bash
pnpm nx deploy fred-adpt -- --prefix=dev
aws ssm get-parameter --name "/nestfolio/dev-fred-adpt/fred/baseUrl" --query "Parameter.Value" --output text
```

- [ ] **Step 5: Create mock handler**

Create `services/advisory/fred-adpt/test/mocks/mock-fred.ts`:

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

// Map of series_id → mock observation value
const MOCK_VALUES: Record<string, string> = {
  FEDFUNDS: '5.33',
  CPIAUCSL: '314.069',
  DGS10: '4.25',
  VIXCLS: '14.5',
  DCOILWTICO: '78.50',
  SP500: '5200.00',
  UNRATE: '3.7',
  DGS1: '5.10',
  DGS5: '4.30',
  DGS30: '4.45',
  BAMLC0A0CM: '1.28',
};

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const params = event.queryStringParameters ?? {};
  const seriesId = params['series_id'] ?? '';

  if (!seriesId) {
    return json(400, { error_message: 'Missing series_id parameter' });
  }

  const value = MOCK_VALUES[seriesId];
  if (!value) {
    return json(200, { observations: [] }); // Unknown series — empty result
  }

  return json(200, {
    realtime_start: '2026-04-01',
    realtime_end: '2026-04-07',
    observation_start: '2026-03-31',
    observation_end: '2026-04-07',
    units: 'lin',
    output_type: 1,
    file_type: 'json',
    order_by: 'observation_date',
    sort_order: 'desc',
    count: 1,
    offset: 0,
    limit: 1,
    observations: [
      { realtime_start: '2026-04-07', realtime_end: '2026-04-07', date: '2026-04-04', value },
    ],
  });
}
```

- [ ] **Step 6: Add build-mock target**

Add to `services/advisory/fred-adpt/project.json`:

```json
"build-mock": {
  "executor": "nx:run-commands",
  "options": {
    "commands": [
      "mkdir -p services/advisory/fred-adpt/test/mocks/dist",
      "npx esbuild services/advisory/fred-adpt/test/mocks/mock-fred.ts --bundle --platform=node --target=node20 --outfile=services/advisory/fred-adpt/test/mocks/dist/index.mjs --format=esm",
      "cd services/advisory/fred-adpt/test/mocks/dist && zip -j ../mock-fred.zip index.mjs"
    ],
    "parallel": false
  },
  "outputs": ["services/advisory/fred-adpt/test/mocks/mock-fred.zip"]
}
```

- [ ] **Step 7: Build mock**

```bash
pnpm nx build-mock fred-adpt
```

- [ ] **Step 8: Rewrite integration test**

Replace `services/advisory/fred-adpt/test/integration/fred-adpt.integration.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('fred-adpt (mocked)', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-fred.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-fred',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-fred-adpt/fred/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: 'FRED_INDICATORS_UPDATED',
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should fetch FRED indicators and write FredIndicator to DDB', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'fred-adpt',
      detailType: 'FETCH_FRED_REQUESTED',
      detail: {},
    });

    // Verify DDB write for at least one series
    const item = await table.waitForItem({
      table: 'fred-adpt',
      pk: 'Fred#SYSTEM',
      timeoutMs: 60_000,
    });
    expect(item['__typename']).toBe('FredIndicator');

    // Verify CDC event
    const event = await trap.waitForEvent({ timeoutMs: 60_000 });
    expect(event.detailType).toBe('FRED_INDICATORS_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);

  it('should handle multiple series in a single invocation', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'fred-adpt',
      detailType: 'FETCH_FRED_REQUESTED',
      detail: {},
    });

    // Query all FredIndicator items — should have multiple series
    const items = await table.queryItems({
      table: 'fred-adpt',
      pk: 'Fred#SYSTEM',
    });

    // Handler fetches 11 series; mock returns values for all 11
    expect(items.length).toBeGreaterThanOrEqual(5);
    const seriesIds = items.map(i => (i['sk'] as string).replace('Indicator#', ''));
    expect(seriesIds).toContain('FEDFUNDS');
    expect(seriesIds).toContain('DGS10');
  }, 120_000);
});
```

- [ ] **Step 9: Run integration test**

```bash
pnpm nx build-mock fred-adpt && pnpm nx test-integration fred-adpt
```
Expected: 2 tests pass.

- [ ] **Step 10: Commit**

```bash
git add services/advisory/fred-adpt/
git commit -m "feat(fred-adpt): add mock handler and expand integration tests"
```

---

### Task 3: marketwatch-adpt Mock & Tests

**Files:**
- Create: `services/advisory/marketwatch-adpt/test/mocks/mock-marketwatch.ts`
- Modify: `services/advisory/marketwatch-adpt/project.json` — add `build-mock` target
- Rewrite: `services/advisory/marketwatch-adpt/test/integration/marketwatch-adpt.integration.test.ts`

**Context:** The handler fetches RSS XML from `{baseUrl}/topstories` and `{baseUrl}/marketpulse`. After Plan A Task 3, the base URL comes from SSM: `/nestfolio/{prefix}-marketwatch-adpt/marketwatch/baseUrl` (default: `https://feeds.marketwatch.com/marketwatch`). The response is parsed by `parseRssFeed()` which extracts `<item>` elements with `title`, `link`, `pubDate`, `description`. DDB: `MarketWatchArticle` (pk: `MarketWatch#SYSTEM`, sk: `Feed#{feedName}`). CDC: `MARKETWATCH_UPDATED`.

- [ ] **Step 1: Create mock handler**

Create `services/advisory/marketwatch-adpt/test/mocks/mock-marketwatch.ts`:

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function xml(statusCode: number, body: string): APIGatewayProxyResultV2 {
  return { statusCode, body, headers: { 'Content-Type': 'application/xml' } };
}

function rssResponse(feedName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>MarketWatch ${feedName}</title>
    <link>https://www.marketwatch.com</link>
    <description>Mock ${feedName} feed</description>
    <item>
      <title>Mock ${feedName} Article 1</title>
      <link>https://mock.example.com/${feedName}-1</link>
      <pubDate>Mon, 07 Apr 2026 12:00:00 GMT</pubDate>
      <description>Integration test mock article for ${feedName}</description>
    </item>
    <item>
      <title>Mock ${feedName} Article 2</title>
      <link>https://mock.example.com/${feedName}-2</link>
      <pubDate>Mon, 07 Apr 2026 11:00:00 GMT</pubDate>
      <description>Second mock article for ${feedName}</description>
    </item>
  </channel>
</rss>`;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath;

  if (path.endsWith('/topstories')) {
    return xml(200, rssResponse('topstories'));
  }

  if (path.endsWith('/marketpulse')) {
    return xml(200, rssResponse('marketpulse'));
  }

  return xml(404, '<error>Unknown feed</error>');
}
```

- [ ] **Step 2: Add build-mock target**

Add to `services/advisory/marketwatch-adpt/project.json`:

```json
"build-mock": {
  "executor": "nx:run-commands",
  "options": {
    "commands": [
      "mkdir -p services/advisory/marketwatch-adpt/test/mocks/dist",
      "npx esbuild services/advisory/marketwatch-adpt/test/mocks/mock-marketwatch.ts --bundle --platform=node --target=node20 --outfile=services/advisory/marketwatch-adpt/test/mocks/dist/index.mjs --format=esm",
      "cd services/advisory/marketwatch-adpt/test/mocks/dist && zip -j ../mock-marketwatch.zip index.mjs"
    ],
    "parallel": false
  },
  "outputs": ["services/advisory/marketwatch-adpt/test/mocks/mock-marketwatch.zip"]
}
```

- [ ] **Step 3: Build mock**

```bash
pnpm nx build-mock marketwatch-adpt
```

- [ ] **Step 4: Rewrite integration test**

Replace `services/advisory/marketwatch-adpt/test/integration/marketwatch-adpt.integration.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('marketwatch-adpt (mocked)', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-marketwatch.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-marketwatch',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-marketwatch-adpt/marketwatch/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: 'MARKETWATCH_UPDATED',
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should fetch RSS and write MarketWatchArticle to DDB', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'marketwatch-adpt',
      detailType: 'FETCH_MARKETWATCH_REQUESTED',
      detail: {},
    });

    const item = await table.waitForItem({
      table: 'marketwatch-adpt',
      pk: 'MarketWatch#SYSTEM',
      sk: 'Feed#topstories',
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('MarketWatchArticle');
    expect(item['source']).toBe('marketwatch');
    expect(item['feed']).toBe('topstories');
  }, 120_000);

  it('should emit MARKETWATCH_UPDATED CDC event', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'marketwatch-adpt',
      detailType: 'FETCH_MARKETWATCH_REQUESTED',
      detail: {},
    });

    const event = await trap.waitForEvent({ timeoutMs: 60_000 });
    expect(event.detailType).toBe('MARKETWATCH_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);

  it('should write both topstories and marketpulse feeds', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'marketwatch-adpt',
      detailType: 'FETCH_MARKETWATCH_REQUESTED',
      detail: {},
    });

    // Wait for topstories (proves handler ran)
    await table.waitForItem({
      table: 'marketwatch-adpt',
      pk: 'MarketWatch#SYSTEM',
      sk: 'Feed#topstories',
      timeoutMs: 60_000,
    });

    // Then check marketpulse exists too
    const marketpulse = await table.waitForItem({
      table: 'marketwatch-adpt',
      pk: 'MarketWatch#SYSTEM',
      sk: 'Feed#marketpulse',
      timeoutMs: 10_000,
    });

    expect(marketpulse['__typename']).toBe('MarketWatchArticle');
    expect(marketpulse['feed']).toBe('marketpulse');
  }, 120_000);
});
```

- [ ] **Step 5: Run integration test**

```bash
pnpm nx build-mock marketwatch-adpt && pnpm nx test-integration marketwatch-adpt
```
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/marketwatch-adpt/
git commit -m "feat(marketwatch-adpt): add mock handler and expand integration tests"
```

---

### Task 4: sec-edgar-adpt Mock & Tests

**Files:**
- Create: `services/advisory/sec-edgar-adpt/test/mocks/mock-sec-edgar.ts`
- Modify: `services/advisory/sec-edgar-adpt/project.json` — add `build-mock` target
- Rewrite: `services/advisory/sec-edgar-adpt/test/integration/sec-edgar-adpt.integration.test.ts`

**Context:** The handler fetches from two endpoints: (1) `{baseUrl}/submissions/CIK{cik}.json` → JSON with recent filings list, (2) `{baseUrl}/Archives/edgar/data/{accessionStripped}/{primaryDoc}` → filing content text. After Plan A Task 3, base URL from SSM: `/nestfolio/{prefix}-sec-edgar-adpt/edgar/baseUrl` (default: `https://data.sec.gov`). DDB: `SecFiling` (pk: `SecFiling#{cik}`, sk: `Filing#{accessionNumber}`). CDC: `SEC_8K_FILED` (8-K), `SEC_PROSPECTUS_UPDATED` (485BPOS, N-1A), `SEC_10K_UPDATED` (10-K, 10-Q). Tracked CIKs: 0000102909, 0000088053, 0000914208.

- [ ] **Step 1: Create mock handler**

Create `services/advisory/sec-edgar-adpt/test/mocks/mock-sec-edgar.ts`:

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

function text(statusCode: number, body: string): APIGatewayProxyResultV2 {
  return { statusCode, body, headers: { 'Content-Type': 'text/html' } };
}

const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

// Mock submissions for each CIK with different form types
const MOCK_SUBMISSIONS: Record<string, unknown> = {
  '0000102909': {
    cik: '0000102909',
    entityType: 'filer',
    name: 'Vanguard Group Inc',
    recentFilings: {
      filings: [
        { accessionNumber: '0000102909-26-000001', form: '8-K', filingDate: today, primaryDocument: 'filing.htm' },
      ],
    },
  },
  '0000088053': {
    cik: '0000088053',
    entityType: 'filer',
    name: 'Fidelity Management & Research',
    recentFilings: {
      filings: [
        { accessionNumber: '0000088053-26-000001', form: '485BPOS', filingDate: today, primaryDocument: 'prospectus.htm' },
      ],
    },
  },
  '0000914208': {
    cik: '0000914208',
    entityType: 'filer',
    name: 'iShares Trust',
    recentFilings: {
      filings: [
        { accessionNumber: '0000914208-26-000001', form: '10-K', filingDate: today, primaryDocument: 'annual.htm' },
      ],
    },
  },
};

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath;

  // Submissions endpoint: /submissions/CIK{cik}.json
  const submissionMatch = path.match(/\/submissions\/CIK(\d+)\.json/);
  if (submissionMatch) {
    const cik = submissionMatch[1];
    const data = MOCK_SUBMISSIONS[cik];
    if (!data) return json(404, { error: `CIK ${cik} not found` });
    return json(200, data);
  }

  // Filing content: /Archives/edgar/data/{accessionStripped}/{doc}
  if (path.includes('/Archives/edgar/data/')) {
    return text(200, `<html><body><h1>Mock SEC Filing Document</h1><p>Integration test filing content for ${path}</p></body></html>`);
  }

  return json(404, { error: `Unknown path: ${path}` });
}
```

- [ ] **Step 2: Add build-mock target**

Add to `services/advisory/sec-edgar-adpt/project.json`:

```json
"build-mock": {
  "executor": "nx:run-commands",
  "options": {
    "commands": [
      "mkdir -p services/advisory/sec-edgar-adpt/test/mocks/dist",
      "npx esbuild services/advisory/sec-edgar-adpt/test/mocks/mock-sec-edgar.ts --bundle --platform=node --target=node20 --outfile=services/advisory/sec-edgar-adpt/test/mocks/dist/index.mjs --format=esm",
      "cd services/advisory/sec-edgar-adpt/test/mocks/dist && zip -j ../mock-sec-edgar.zip index.mjs"
    ],
    "parallel": false
  },
  "outputs": ["services/advisory/sec-edgar-adpt/test/mocks/mock-sec-edgar.zip"]
}
```

- [ ] **Step 3: Build mock**

```bash
pnpm nx build-mock sec-edgar-adpt
```

- [ ] **Step 4: Rewrite integration test**

Replace `services/advisory/sec-edgar-adpt/test/integration/sec-edgar-adpt.integration.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('sec-edgar-adpt (mocked)', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-sec-edgar.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-sec-edgar',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-sec-edgar-adpt/edgar/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: ['SEC_8K_FILED', 'SEC_PROSPECTUS_UPDATED', 'SEC_10K_UPDATED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should process 8-K filing and emit SEC_8K_FILED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'sec-edgar-adpt',
      detailType: 'FETCH_SEC_EDGAR_REQUESTED',
      detail: {},
    });

    // Verify DDB write for Vanguard 8-K
    const item = await table.waitForItem({
      table: 'sec-edgar-adpt',
      pk: 'SecFiling#0000102909',
      timeoutMs: 90_000,
    });
    expect(item['formType']).toBe('8-K');
    expect(item['issuer']).toBe('Vanguard Group Inc');

    // Verify CDC event
    const event = await trap.waitForEvent({ detailType: 'SEC_8K_FILED', timeoutMs: 30_000 });
    expect(event.detailType).toBe('SEC_8K_FILED');
  }, 120_000);

  it('should process 485BPOS filing and emit SEC_PROSPECTUS_UPDATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'sec-edgar-adpt',
      detailType: 'FETCH_SEC_EDGAR_REQUESTED',
      detail: {},
    });

    // Verify DDB write for Fidelity prospectus
    const item = await table.waitForItem({
      table: 'sec-edgar-adpt',
      pk: 'SecFiling#0000088053',
      timeoutMs: 90_000,
    });
    expect(item['formType']).toBe('485BPOS');

    const event = await trap.waitForEvent({ detailType: 'SEC_PROSPECTUS_UPDATED', timeoutMs: 30_000 });
    expect(event.detailType).toBe('SEC_PROSPECTUS_UPDATED');
  }, 120_000);

  it('should process 10-K filing and emit SEC_10K_UPDATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'sec-edgar-adpt',
      detailType: 'FETCH_SEC_EDGAR_REQUESTED',
      detail: {},
    });

    // Verify DDB write for iShares 10-K
    const item = await table.waitForItem({
      table: 'sec-edgar-adpt',
      pk: 'SecFiling#0000914208',
      timeoutMs: 90_000,
    });
    expect(item['formType']).toBe('10-K');

    const event = await trap.waitForEvent({ detailType: 'SEC_10K_UPDATED', timeoutMs: 30_000 });
    expect(event.detailType).toBe('SEC_10K_UPDATED');
  }, 120_000);
});
```

- [ ] **Step 5: Run integration test**

```bash
pnpm nx build-mock sec-edgar-adpt && pnpm nx test-integration sec-edgar-adpt
```
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/sec-edgar-adpt/
git commit -m "feat(sec-edgar-adpt): add mock handler and expand integration tests"
```

---

### Task 5: yahoo-finance-adpt Mock & Tests

**Files:**
- Create: `services/advisory/yahoo-finance-adpt/test/mocks/mock-yahoo-finance.ts`
- Modify: `services/advisory/yahoo-finance-adpt/project.json` — add `build-mock` target
- Rewrite: `services/advisory/yahoo-finance-adpt/test/integration/yahoo-finance-adpt.integration.test.ts`

**Context:** The handler fetches RSS XML from `{baseUrl}?s={ticker}` for each ticker (default: VTI,BND,QQQ,VTIP,SPY). After Plan A Task 3, base URL from SSM: `/nestfolio/{prefix}-yahoo-finance-adpt/yahoo/baseUrl` (default: `https://feeds.finance.yahoo.com/rss/2.0/headline`). DDB: `YahooFinanceArticle` (pk: `YahooFinance#SYSTEM`, sk: `Ticker#{ticker}`). CDC: `YAHOO_FINANCE_UPDATED`.

- [ ] **Step 1: Create mock handler**

Create `services/advisory/yahoo-finance-adpt/test/mocks/mock-yahoo-finance.ts`:

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function xml(statusCode: number, body: string): APIGatewayProxyResultV2 {
  return { statusCode, body, headers: { 'Content-Type': 'application/xml' } };
}

function rssResponse(ticker: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Yahoo Finance ${ticker} Headlines</title>
    <link>https://finance.yahoo.com</link>
    <description>Mock headlines for ${ticker}</description>
    <item>
      <title>${ticker} rises on strong earnings</title>
      <link>https://mock.example.com/${ticker.toLowerCase()}-1</link>
      <pubDate>Mon, 07 Apr 2026 12:00:00 GMT</pubDate>
      <description>Mock article about ${ticker} performance</description>
    </item>
    <item>
      <title>${ticker} analyst upgrades</title>
      <link>https://mock.example.com/${ticker.toLowerCase()}-2</link>
      <pubDate>Mon, 07 Apr 2026 11:00:00 GMT</pubDate>
      <description>Mock analyst coverage for ${ticker}</description>
    </item>
  </channel>
</rss>`;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const params = event.queryStringParameters ?? {};
  const ticker = params['s'] ?? '';

  if (!ticker) {
    return xml(400, '<error>Missing ticker parameter</error>');
  }

  return xml(200, rssResponse(ticker));
}
```

- [ ] **Step 2: Add build-mock target**

Add to `services/advisory/yahoo-finance-adpt/project.json`:

```json
"build-mock": {
  "executor": "nx:run-commands",
  "options": {
    "commands": [
      "mkdir -p services/advisory/yahoo-finance-adpt/test/mocks/dist",
      "npx esbuild services/advisory/yahoo-finance-adpt/test/mocks/mock-yahoo-finance.ts --bundle --platform=node --target=node20 --outfile=services/advisory/yahoo-finance-adpt/test/mocks/dist/index.mjs --format=esm",
      "cd services/advisory/yahoo-finance-adpt/test/mocks/dist && zip -j ../mock-yahoo-finance.zip index.mjs"
    ],
    "parallel": false
  },
  "outputs": ["services/advisory/yahoo-finance-adpt/test/mocks/mock-yahoo-finance.zip"]
}
```

- [ ] **Step 3: Build mock**

```bash
pnpm nx build-mock yahoo-finance-adpt
```

- [ ] **Step 4: Rewrite integration test**

Replace `services/advisory/yahoo-finance-adpt/test/integration/yahoo-finance-adpt.integration.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('yahoo-finance-adpt (mocked)', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-yahoo-finance.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-yahoo-finance',
      handlerAsset: readFileSync(zipPath),
    });

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-yahoo-finance-adpt/yahoo/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: 'YAHOO_FINANCE_UPDATED',
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should fetch Yahoo Finance RSS and write YahooFinanceArticle to DDB', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'yahoo-finance-adpt',
      detailType: 'FETCH_YAHOO_FINANCE_REQUESTED',
      detail: {},
    });

    const item = await table.waitForItem({
      table: 'yahoo-finance-adpt',
      pk: 'YahooFinance#SYSTEM',
      sk: 'Ticker#VTI',
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('YahooFinanceArticle');
    expect(item['source']).toBe('yahoo-finance');
    expect(item['ticker']).toBe('VTI');
  }, 120_000);

  it('should write articles for multiple tickers', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'yahoo-finance-adpt',
      detailType: 'FETCH_YAHOO_FINANCE_REQUESTED',
      detail: {},
    });

    // Wait for first ticker to be written
    await table.waitForItem({
      table: 'yahoo-finance-adpt',
      pk: 'YahooFinance#SYSTEM',
      sk: 'Ticker#VTI',
      timeoutMs: 60_000,
    });

    // Check BND ticker also written
    const bnd = await table.waitForItem({
      table: 'yahoo-finance-adpt',
      pk: 'YahooFinance#SYSTEM',
      sk: 'Ticker#BND',
      timeoutMs: 10_000,
    });
    expect(bnd['ticker']).toBe('BND');
  }, 120_000);

  it('should emit YAHOO_FINANCE_UPDATED CDC event', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'yahoo-finance-adpt',
      detailType: 'FETCH_YAHOO_FINANCE_REQUESTED',
      detail: {},
    });

    const event = await trap.waitForEvent({ timeoutMs: 60_000 });
    expect(event.detailType).toBe('YAHOO_FINANCE_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);
});
```

- [ ] **Step 5: Run integration test**

```bash
pnpm nx build-mock yahoo-finance-adpt && pnpm nx test-integration yahoo-finance-adpt
```
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/yahoo-finance-adpt/
git commit -m "feat(yahoo-finance-adpt): add mock handler and expand integration tests"
```

---

## Handoff to Plan C

After completing all 5 tasks, copy-paste this prompt to start Plan C in a fresh context:

```
Use `superpowers:subagent-driven-development` to execute the plan at `docs/superpowers/plans/2026-04-07-integration-test-full-coverage-C-controllers.md`.

Branch: `feat/all-services-integration-tests` (continue on it).

Pre-requisites completed (Plan A + B):
- DdbSeedFixture, TableAssertions auto-cleanup, SSM base URLs — all deployed
- All 5 adapter mocks built and integration tests passing
- Mock handler pattern established: test/mocks/mock-{name}.ts → build-mock target → zip → MockApiFixture deploy
- All adapters have SSM base URL params for SsmOverrideFixture redirection

Gold standard: services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts
Existing fixtures: EventBridgeClient, EventBusTrap, TableAssertions (with registerCleanup), MockApiFixture, SsmOverrideFixture, DdbSeedFixture, CognitoFixture, AppSyncClient, AccountSeedingFixture
```
