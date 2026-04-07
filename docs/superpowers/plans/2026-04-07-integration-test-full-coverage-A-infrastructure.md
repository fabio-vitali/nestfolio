# Integration Test Full Coverage — Plan A: Infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build shared infrastructure fixtures and migrate mock patterns so Plans B–D can execute independently.

**Architecture:** New DdbSeedFixture for pre-seeding DDB data, extended TableAssertions with auto-cleanup, SSM base URL parameters on 3 adapters (marketwatch, yahoo-finance, sec-edgar) to enable MockApiFixture redirection, and migrated mock-alpaca pattern from libs to service-local test/mocks/.

**Tech Stack:** TypeScript, AWS SDK v3 (DynamoDB, SSM), CDK (ParamsAndSecrets Lambda Extension), esbuild, Jest

**Branch:** `feat/all-services-integration-tests`

**Design Spec:** `docs/superpowers/specs/2026-04-07-integration-test-full-coverage-design.md`

---

### Task 1: Create DdbSeedFixture

**Files:**
- Create: `libs/integration-testing/src/fixtures/ddb-seed.fixture.ts`
- Modify: `libs/integration-testing/src/index.ts`

- [ ] **Step 1: Write the DdbSeedFixture implementation**

Create `libs/integration-testing/src/fixtures/ddb-seed.fixture.ts`:

```typescript
import { DynamoDBClient, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { IntegrationContext } from '../context';

export class DdbSeedFixture {
  private readonly client: DynamoDBClient;
  private readonly ctx: IntegrationContext;
  private readonly seeded: { tableName: string; pk: string; sk: string }[] = [];

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.client = new DynamoDBClient({ region: ctx.region });
    this.ctx.cleanup.register('DdbSeedFixture', () => this.teardown());
  }

  async seed(params: { table: string; items: Record<string, unknown>[] }): Promise<void> {
    const tableName = await this.ctx.ssm.tableName(params.table);

    for (const item of params.items) {
      const pk = item['pk'] as string;
      const sk = item['sk'] as string;
      if (!pk || !sk) throw new Error('DdbSeedFixture: seeded items must have pk and sk');

      await this.client.send(new PutItemCommand({
        TableName: tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      }));
      this.seeded.push({ tableName, pk, sk });
    }
  }

  private async teardown(): Promise<void> {
    for (const { tableName, pk, sk } of this.seeded) {
      try {
        await this.client.send(new DeleteItemCommand({
          TableName: tableName,
          Key: marshall({ pk, sk }),
        }));
      } catch (err) {
        console.error(`DdbSeedFixture: failed to delete pk=${pk} sk=${sk}`, err);
      }
    }
  }
}
```

- [ ] **Step 2: Export DdbSeedFixture from index**

Add to `libs/integration-testing/src/index.ts` after the `AccountSeedingFixture` export:

```typescript
export { DdbSeedFixture } from './fixtures/ddb-seed.fixture';
```

- [ ] **Step 3: Verify compilation**

Run:
```bash
pnpm nx lint integration-testing
```
Expected: PASS (no errors)

- [ ] **Step 4: Commit**

```bash
git add libs/integration-testing/src/fixtures/ddb-seed.fixture.ts libs/integration-testing/src/index.ts
git commit -m "feat(integration-testing): add DdbSeedFixture for pre-seeding DDB data"
```

---

### Task 2: Extend TableAssertions with Item Tracking & Auto-Cleanup

**Files:**
- Modify: `libs/integration-testing/src/fixtures/table-assertions.ts`

The existing `TableAssertions` has a manual `cleanup(params)` method but no auto-tracking. We need to:
1. Track every item PK/SK observed via `waitForItem()` and `assertItem()`
2. Add a `registerCleanup(ctx)` method that batch-deletes all tracked items
3. Keep it opt-in (caller must call `registerCleanup`) to avoid breaking existing tests

- [ ] **Step 1: Add item tracking and registerCleanup method**

In `libs/integration-testing/src/fixtures/table-assertions.ts`, add tracking state and registration:

```typescript
// Add after the existing class fields (line ~8, after `private readonly ctx`)
private readonly observed: { tableName: string; pk: string; sk: string }[] = [];
private cleanupRegistered = false;
```

Add `registerCleanup` method after the constructor:

```typescript
/**
 * Register auto-cleanup of all items observed via waitForItem/assertItem.
 * Call once in beforeAll after constructing TableAssertions.
 */
registerCleanup(): void {
  if (this.cleanupRegistered) return;
  this.cleanupRegistered = true;
  this.ctx.cleanup.register('TableAssertions', () => this.cleanupAll());
}

private async cleanupAll(): Promise<void> {
  for (const { tableName, pk, sk } of this.observed) {
    try {
      await this.client.send(new DeleteItemCommand({
        TableName: tableName,
        Key: marshall({ pk, sk }),
      }));
    } catch (err) {
      console.error(`TableAssertions cleanup: failed to delete pk=${pk} sk=${sk}`, err);
    }
  }
}
```

- [ ] **Step 2: Track items in waitForItem**

In the `waitForItem` method, add tracking when an item is found. After the `if (result.Item) return unmarshall(result.Item);` line (for GetItem path, ~line 29) and after the `if (result.Items?.length) return unmarshall(result.Items[0]);` line (for Query path, ~line 37), track the found items.

Replace the inner while loop body of `waitForItem` with:

```typescript
while (Date.now() < deadline) {
  if (params.sk) {
    const result = await this.client.send(new GetItemCommand({
      TableName: tableName,
      Key: marshall({ pk: params.pk, sk: params.sk }),
    }));
    if (result.Item) {
      const item = unmarshall(result.Item);
      this.observed.push({ tableName, pk: item['pk'] as string, sk: item['sk'] as string });
      return item;
    }
  } else {
    const result = await this.client.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: marshall({ ':pk': params.pk }),
      Limit: 1,
    }));
    if (result.Items?.length) {
      const item = unmarshall(result.Items[0]);
      this.observed.push({ tableName, pk: item['pk'] as string, sk: item['sk'] as string });
      return item;
    }
  }

  await new Promise(resolve => setTimeout(resolve, pollInterval));
}
```

- [ ] **Step 3: Track items in assertItem**

In the `assertItem` method, after `const item = unmarshall(result.Item);` (~line 65), add:

```typescript
this.observed.push({ tableName, pk: item['pk'] as string, sk: item['sk'] as string });
```

- [ ] **Step 4: Add DeleteItemCommand import**

Ensure the import at the top includes `DeleteItemCommand`:

```typescript
import { DynamoDBClient, GetItemCommand, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
```

- [ ] **Step 5: Verify compilation**

Run:
```bash
pnpm nx lint integration-testing
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add libs/integration-testing/src/fixtures/table-assertions.ts
git commit -m "feat(integration-testing): add auto-cleanup tracking to TableAssertions"
```

---

### Task 3: Add SSM Base URL Parameters to 3 Adapter Services

These 3 adapters currently hardcode their external API base URLs. We need to add SSM-based base URL configuration using the AWS Parameters and Secrets Lambda Extension, matching the `broker-alpaca-adpt` pattern. This enables `MockApiFixture` + `SsmOverrideFixture` to redirect API calls to mock Lambdas during integration tests.

**Files (per service):**
- Modify: `services/advisory/marketwatch-adpt/src/service.stack.ts`
- Modify: `services/advisory/marketwatch-adpt/src/handlers/event-listener.ts`
- Modify: `services/advisory/yahoo-finance-adpt/src/service.stack.ts`
- Modify: `services/advisory/yahoo-finance-adpt/src/handlers/event-listener.ts`
- Modify: `services/advisory/sec-edgar-adpt/src/service.stack.ts`
- Modify: `services/advisory/sec-edgar-adpt/src/handlers/event-listener.ts`
- Modify (if separate): `services/advisory/sec-edgar-adpt/src/clients/edgar-api.ts`

#### 3a: marketwatch-adpt

- [ ] **Step 1: Read current marketwatch-adpt stack and handler**

Read:
- `services/advisory/marketwatch-adpt/src/service.stack.ts`
- `services/advisory/marketwatch-adpt/src/handlers/event-listener.ts`

Understand where the RSS feed URLs are hardcoded (likely `https://feeds.marketwatch.com/marketwatch/topstories` and `https://feeds.marketwatch.com/marketwatch/marketpulse`).

- [ ] **Step 2: Update CDK stack to add SSM base URL and ParamsAndSecrets**

In `service.stack.ts`, add the SSM parameter path and Lambda extension. The handler needs `MARKETWATCH_BASE_URL_PARAM` env var pointing to the SSM parameter name. Add ParamsAndSecrets layer to the Ingress construct's lambdaProps.

Import ParamsAndSecrets:
```typescript
import { ParamsAndSecretsLayerVersion, ParamsAndSecretsVersions } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
```

Create the layer and SSM path:
```typescript
const paramsAndSecrets = ParamsAndSecretsLayerVersion.fromVersion(
  ParamsAndSecretsVersions.V1_0_103,
  { parameterStoreTtl: Duration.seconds(5) },
);

const ssmBasePath = `/nestfolio/${this.prefix}-marketwatch-adpt/marketwatch`;
```

Add to Ingress construct's options:
```typescript
environment: {
  MARKETWATCH_BASE_URL_PARAM: `${ssmBasePath}/baseUrl`,
},
lambdaProps: { paramsAndSecrets },
```

Add IAM policy for SSM access:
```typescript
ingress.handler.addToRolePolicy(new PolicyStatement({
  actions: ['ssm:GetParameter'],
  resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${ssmBasePath}/*`],
}));
```

- [ ] **Step 3: Create SSM parameter with default value**

The SSM parameter must exist for the handler to work. Add it as a `StringParameter` in the stack (or we can seed it via CLI). Simplest approach — add to bottom of stack:

```typescript
new StringParameter(this, 'MarketWatchBaseUrl', {
  parameterName: `${ssmBasePath}/baseUrl`,
  stringValue: 'https://feeds.marketwatch.com/marketwatch',
  description: 'MarketWatch RSS feed base URL (overridable for integration tests)',
});
```

Import: `import { StringParameter } from 'aws-cdk-lib/aws-ssm';`

- [ ] **Step 4: Update handler to read base URL from SSM extension**

In `event-listener.ts`, replace the hardcoded feed URLs. The Parameters and Secrets Lambda Extension exposes SSM values at `http://localhost:2773/systemsmanager/parameters/get?name=...`.

Add a helper at the top of the handler file:
```typescript
const MARKETWATCH_BASE_URL_PARAM = process.env['MARKETWATCH_BASE_URL_PARAM']!;

async function getBaseUrl(): Promise<string> {
  const encoded = encodeURIComponent(MARKETWATCH_BASE_URL_PARAM);
  const res = await fetch(`http://localhost:2773/systemsmanager/parameters/get?name=${encoded}`, {
    headers: { 'X-Aws-Parameters-Secrets-Token': process.env['AWS_SESSION_TOKEN']! },
  });
  const json = await res.json() as { Parameter: { Value: string } };
  return json.Parameter.Value;
}
```

Then in the handler, replace the hardcoded URLs:
```typescript
// Before: const topstoriesUrl = 'https://feeds.marketwatch.com/marketwatch/topstories';
// After:
const baseUrl = await getBaseUrl();
const topstoriesUrl = `${baseUrl}/topstories`;
const marketpulseUrl = `${baseUrl}/marketpulse`;
```

- [ ] **Step 5: Run unit tests**

```bash
pnpm nx test marketwatch-adpt
```
Expected: PASS (unit tests may need mock for the SSM extension fetch — check and update if needed)

- [ ] **Step 6: Commit marketwatch-adpt changes**

```bash
git add services/advisory/marketwatch-adpt/src/service.stack.ts services/advisory/marketwatch-adpt/src/handlers/event-listener.ts
git commit -m "feat(marketwatch-adpt): add SSM base URL parameter for test mockability"
```

#### 3b: yahoo-finance-adpt

- [ ] **Step 7: Read current yahoo-finance-adpt stack and handler**

Read:
- `services/advisory/yahoo-finance-adpt/src/service.stack.ts`
- `services/advisory/yahoo-finance-adpt/src/handlers/event-listener.ts`

The base URL is hardcoded as `https://feeds.finance.yahoo.com/rss/2.0/headline` with query param `?s=${ticker}`.

- [ ] **Step 8: Update CDK stack — same pattern as marketwatch-adpt**

SSM path: `/nestfolio/${this.prefix}-yahoo-finance-adpt/yahoo/baseUrl`
Default value: `https://feeds.finance.yahoo.com/rss/2.0/headline`
Env var: `YAHOO_BASE_URL_PARAM`

Apply identical ParamsAndSecrets + IAM policy pattern as Step 2-3.

- [ ] **Step 9: Update handler to read base URL from SSM extension**

Same `getBaseUrl()` pattern. Replace:
```typescript
// Before: const feedUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}`;
// After:
const baseUrl = await getBaseUrl();
const feedUrl = `${baseUrl}?s=${ticker}`;
```

- [ ] **Step 10: Run unit tests**

```bash
pnpm nx test yahoo-finance-adpt
```
Expected: PASS

- [ ] **Step 11: Commit yahoo-finance-adpt changes**

```bash
git add services/advisory/yahoo-finance-adpt/src/service.stack.ts services/advisory/yahoo-finance-adpt/src/handlers/event-listener.ts
git commit -m "feat(yahoo-finance-adpt): add SSM base URL parameter for test mockability"
```

#### 3c: sec-edgar-adpt

- [ ] **Step 12: Read current sec-edgar-adpt stack, handler, and client**

Read:
- `services/advisory/sec-edgar-adpt/src/service.stack.ts`
- `services/advisory/sec-edgar-adpt/src/handlers/event-listener.ts`
- `services/advisory/sec-edgar-adpt/src/clients/edgar-api.ts` (if exists)

The base URL is hardcoded as `https://data.sec.gov`. The client constructs paths like `/submissions/CIK${cik}.json` and `/Archives/edgar/data/...`.

- [ ] **Step 13: Update CDK stack — same pattern**

SSM path: `/nestfolio/${this.prefix}-sec-edgar-adpt/edgar/baseUrl`
Default value: `https://data.sec.gov`
Env var: `EDGAR_BASE_URL_PARAM`

Apply identical ParamsAndSecrets + IAM policy pattern.

- [ ] **Step 14: Update handler/client to read base URL from SSM extension**

The SEC EDGAR adapter may have a separate client class (edgar-api.ts). If so, pass the base URL into the client constructor. If the URL is inline in event-listener.ts, update there.

Same `getBaseUrl()` pattern. Replace:
```typescript
// Before: const baseUrl = 'https://data.sec.gov';
// After:  const baseUrl = await getBaseUrl(); // from SSM extension
```

All paths like `/submissions/CIK${cik}.json` should remain relative — they're appended to `baseUrl`.

- [ ] **Step 15: Run unit tests**

```bash
pnpm nx test sec-edgar-adpt
```
Expected: PASS

- [ ] **Step 16: Commit sec-edgar-adpt changes**

```bash
git add services/advisory/sec-edgar-adpt/src/
git commit -m "feat(sec-edgar-adpt): add SSM base URL parameter for test mockability"
```

---

### Task 4: Migrate mock-alpaca.ts to Service-Local Test Mocks

**Files:**
- Move: `libs/integration-testing/src/mock-handlers/mock-alpaca.ts` → `services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.ts`
- Modify: `libs/integration-testing/project.json` — remove `build:mocks` target
- Modify: `services/execution/broker-alpaca-adpt/project.json` — add `build-mock` target
- Modify: `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts` — update zip path

- [ ] **Step 1: Copy mock-alpaca to service-local directory**

```bash
mkdir -p services/execution/broker-alpaca-adpt/test/mocks
cp libs/integration-testing/src/mock-handlers/mock-alpaca.ts services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.ts
```

- [ ] **Step 2: Add build-mock target to broker-alpaca-adpt project.json**

Add to `services/execution/broker-alpaca-adpt/project.json` targets:

```json
"build-mock": {
  "executor": "nx:run-commands",
  "options": {
    "commands": [
      "mkdir -p services/execution/broker-alpaca-adpt/test/mocks/dist",
      "npx esbuild services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.ts --bundle --platform=node --target=node20 --outfile=services/execution/broker-alpaca-adpt/test/mocks/dist/index.mjs --format=esm",
      "cd services/execution/broker-alpaca-adpt/test/mocks/dist && zip -j ../mock-alpaca.zip index.mjs"
    ],
    "parallel": false
  },
  "outputs": ["services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.zip"]
}
```

- [ ] **Step 3: Update integration test zip path**

In `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts`, change:

```typescript
// Before:
const zipPath = join(__dirname, '../../../../..', 'libs/integration-testing/assets/mock-alpaca.zip');

// After:
const zipPath = join(__dirname, '..', 'mocks', 'mock-alpaca.zip');
```

- [ ] **Step 4: Build the mock and verify test still works**

```bash
pnpm nx build-mock broker-alpaca-adpt
```
Expected: `services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.zip` created

- [ ] **Step 5: Remove old mock handler and build target**

```bash
rm libs/integration-testing/src/mock-handlers/mock-alpaca.ts
rmdir libs/integration-testing/src/mock-handlers 2>/dev/null || true
rm -f libs/integration-testing/assets/mock-alpaca.zip
rmdir libs/integration-testing/assets 2>/dev/null || true
```

Remove the `build:mocks` target from `libs/integration-testing/project.json` (delete the entire target block, lines 17-23).

- [ ] **Step 6: Commit**

```bash
git add services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.ts \
  services/execution/broker-alpaca-adpt/project.json \
  services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts \
  libs/integration-testing/project.json
git rm libs/integration-testing/src/mock-handlers/mock-alpaca.ts
git commit -m "refactor: migrate mock-alpaca to service-local test/mocks directory"
```

---

### Task 5: Deploy Updated Services

The 3 adapter services with new SSM parameters need deployment before integration tests can run.

- [ ] **Step 1: Deploy marketwatch-adpt**

```bash
pnpm nx deploy marketwatch-adpt -- --prefix=dev
```
Expected: Stack deploys successfully, SSM parameter created.

- [ ] **Step 2: Deploy yahoo-finance-adpt**

```bash
pnpm nx deploy yahoo-finance-adpt -- --prefix=dev
```
Expected: Stack deploys successfully, SSM parameter created.

- [ ] **Step 3: Deploy sec-edgar-adpt**

```bash
pnpm nx deploy sec-edgar-adpt -- --prefix=dev
```
Expected: Stack deploys successfully, SSM parameter created.

- [ ] **Step 4: Verify SSM parameters exist**

```bash
aws ssm get-parameter --name "/nestfolio/dev-marketwatch-adpt/marketwatch/baseUrl" --query "Parameter.Value" --output text
aws ssm get-parameter --name "/nestfolio/dev-yahoo-finance-adpt/yahoo/baseUrl" --query "Parameter.Value" --output text
aws ssm get-parameter --name "/nestfolio/dev-sec-edgar-adpt/edgar/baseUrl" --query "Parameter.Value" --output text
```
Expected: Each returns the default production URL.

- [ ] **Step 5: Run existing broker-alpaca-adpt integration test to verify migration**

```bash
pnpm nx build-mock broker-alpaca-adpt && pnpm nx test-integration broker-alpaca-adpt
```
Expected: All 4 tests pass (order fill, reject, transfer, account snapshot).

- [ ] **Step 6: Commit any remaining changes**

If any adjustments were needed during deployment, commit them.

---

## Handoff to Plan B

After completing all 5 tasks, copy-paste this prompt to start Plan B in a fresh context:

```
Use `superpowers:subagent-driven-development` to execute the plan at `docs/superpowers/plans/2026-04-07-integration-test-full-coverage-B-adapters.md`.

Branch: `feat/all-services-integration-tests` (already exists, continue on it).

Pre-requisites completed (Plan A):
- DdbSeedFixture at libs/integration-testing/src/fixtures/ddb-seed.fixture.ts
- TableAssertions has registerCleanup() with auto-tracking
- 3 adapters (marketwatch, yahoo-finance, sec-edgar) have SSM base URL params deployed
- mock-alpaca migrated to services/execution/broker-alpaca-adpt/test/mocks/
- build-mock target pattern established in broker-alpaca-adpt/project.json

Gold standard reference: services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts + test/mocks/mock-alpaca.ts
```
