# JS Pipeline Resolver Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate 36 of 38 BFF GraphQL operations from Lambda resolvers to AppSync JS pipeline resolvers, keeping 2 order-ledger-bff operations as Lambda.

**Architecture:** Each GraphQL field is resolved by a pipeline of JS functions (`checkAuth` → `businessLogic` [→ `readBack`]) running in the APPSYNC_JS runtime against a DynamoDB data source. The Facade CDK construct is refactored to wire JS resolvers and pipeline configs. The Egress construct gains `customEventTypeMap` for intent-based event publishing.

**Tech Stack:** AppSync JS resolvers (FunctionRuntime.JS_1_0_0), `@aws-appsync/utils/dynamodb`, AWS CDK (aws-appsync), `@aws-sdk/client-appsync` (EvaluateCode API for testing), Jest.

**Spec:** `docs/superpowers/specs/2026-03-12-js-pipeline-resolver-migration-design.md`

---

## Chunk 1: Prerequisites — Facade, Egress, Test Infrastructure

### Task 1: Refactor Facade construct — new interfaces and multi-datasource wiring

**Files:**
- Modify: `libs/cdk-constructs/src/facade.ts`
- Modify: `libs/cdk-constructs/test/facade.test.ts`

- [ ] **Step 1: Write failing test — Facade creates DynamoDB data source when table provided**

In `libs/cdk-constructs/test/facade.test.ts`, add a new test block:

```typescript
describe('JS resolver support', () => {
  it('creates DynamoDB data source when table and jsResolvers provided', () => {
    const stack = new Stack();
    const userPool = new UserPool(stack, 'Pool');
    const table = new Table(stack, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    new Facade(stack, 'Facade', {
      schemaPath: join(__dirname, 'fixtures', 'schema.graphql'),
      userPool,
      table,
      jsResolvers: [
        {
          typeName: 'Query',
          fieldName: 'getItems',
          pipeline: [join(__dirname, 'fixtures', 'check-auth.fn.js'), join(__dirname, 'fixtures', 'get-items.fn.js')],
        },
      ],
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::AppSync::DataSource', {
      Type: 'AMAZON_DYNAMODB',
    });
    template.hasResourceProperties('AWS::AppSync::DataSource', {
      Type: 'NONE',
    });
  });
});
```

- [ ] **Step 2: Create test fixture files**

Create `libs/cdk-constructs/test/fixtures/check-auth.fn.js`:
```javascript
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const tenantId = ctx.identity?.claims?.['custom:tenantId'];
  const userId = ctx.identity?.username;
  if (!tenantId || !userId) util.unauthorized();
  ctx.stash.tenantId = tenantId;
  ctx.stash.userId = userId;
  return {};
}
export function response(ctx) { return ctx.prev.result; }
```

Create `libs/cdk-constructs/test/fixtures/get-items.fn.js`:
```javascript
import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';
export function request(ctx) {
  return ddb.query({ query: { pk: { eq: `T#${ctx.stash.tenantId}` } } });
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.items;
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx nx test cdk-constructs -- --testPathPattern=facade`
Expected: FAIL — `FacadeProps` doesn't accept `table` + `jsResolvers` together yet.

- [ ] **Step 4: Replace FacadeProps interface and constructor**

In `libs/cdk-constructs/src/facade.ts`, replace the `FacadeProps` interface (lines 17–34) with:

```typescript
export interface JsResolverConfig {
  typeName: 'Query' | 'Mutation';
  fieldName: string;
  pipeline: string[];
  dataSource?: 'dynamodb' | 'none';
}

export interface LambdaResolverConfig {
  typeName: 'Query' | 'Mutation';
  fieldName: string;
  handler: IFunction;
}

export interface FacadeProps {
  readonly schemaPath?: string;
  readonly userPool?: IUserPool;
  readonly table?: ITable;
  readonly jsResolvers?: JsResolverConfig[];
  readonly lambdaResolvers?: LambdaResolverConfig[];
  readonly ssmPrefix?: string;
  readonly queryDepthLimit?: number;
  readonly enableWaf?: boolean;
  readonly wafRateLimit?: number;
}
```

Replace the resolver wiring section (lines 104–116) with:

```typescript
    // JS pipeline resolvers
    if (props.jsResolvers?.length && props.table) {
      const ddbDs = this.api.addDynamoDbDataSource('DynamoDS', props.table);
      const noneDs = this.api.addNoneDataSource('NoneDS');

      const checkAuthFns = new Map<string, AppsyncFunction>();

      for (const resolver of props.jsResolvers) {
        const pipelineFns: AppsyncFunction[] = [];

        for (let i = 0; i < resolver.pipeline.length; i++) {
          const fnPath = resolver.pipeline[i];
          const fnName = `${resolver.typeName}${resolver.fieldName}Fn${i}`;
          const isCheckAuth = fnPath.includes('check-auth');
          const isNone = resolver.dataSource === 'none' || isCheckAuth;

          // Reuse checkAuth function per unique path
          if (isCheckAuth && checkAuthFns.has(fnPath)) {
            pipelineFns.push(checkAuthFns.get(fnPath)!);
            continue;
          }

          const fn = new AppsyncFunction(this, fnName, {
            name: fnName,
            api: this.api,
            dataSource: isNone ? noneDs : ddbDs,
            code: Code.fromAsset(fnPath),
            runtime: FunctionRuntime.JS_1_0_0,
          });

          if (isCheckAuth) checkAuthFns.set(fnPath, fn);
          pipelineFns.push(fn);
        }

        const tableName = props.table.tableName;
        new Resolver(this, `${resolver.typeName}${resolver.fieldName}Resolver`, {
          api: this.api,
          typeName: resolver.typeName,
          fieldName: resolver.fieldName,
          code: Code.fromInline(`
            export function request(ctx) {
              ctx.stash.tableName = '${tableName}';
              return {};
            }
            export function response(ctx) {
              return ctx.prev.result;
            }
          `),
          runtime: FunctionRuntime.JS_1_0_0,
          pipelineConfig: pipelineFns,
        });
      }
    }

    // Lambda resolvers
    if (props.lambdaResolvers?.length) {
      const lambdaDsMap = new Map<string, BaseDataSource>();
      for (const resolver of props.lambdaResolvers) {
        const fnArn = resolver.handler.functionArn;
        if (!lambdaDsMap.has(fnArn)) {
          lambdaDsMap.set(
            fnArn,
            this.api.addLambdaDataSource(`LambdaDS${lambdaDsMap.size}`, resolver.handler),
          );
        }
        const ds = lambdaDsMap.get(fnArn)!;
        ds.createResolver(`${resolver.typeName}${resolver.fieldName}Resolver`, {
          typeName: resolver.typeName,
          fieldName: resolver.fieldName,
          requestMappingTemplate: MappingTemplate.lambdaRequest(),
          responseMappingTemplate: MappingTemplate.lambdaResult(),
        });
      }
    }
```

Add the necessary imports at the top of the file:

```typescript
import {
  AppsyncFunction,
  Code,
  FunctionRuntime,
  Resolver,
  BaseDataSource,
} from 'aws-cdk-lib/aws-appsync';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx nx test cdk-constructs -- --testPathPattern=facade`
Expected: PASS

- [ ] **Step 6: Add test — pipeline resolvers are created with correct runtime**

```typescript
it('creates pipeline resolvers with JS_1_0_0 runtime', () => {
  // same stack setup as step 1...
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::AppSync::Resolver', {
    Kind: 'PIPELINE',
    Runtime: { Name: 'APPSYNC_JS', RuntimeVersion: '1.0.0' },
  });
});
```

- [ ] **Step 7: Add test — Lambda resolvers still work via lambdaResolvers prop**

```typescript
it('creates Lambda resolvers when lambdaResolvers provided', () => {
  const stack = new Stack();
  const userPool = new UserPool(stack, 'Pool');
  const fn = new Function(stack, 'Fn', {
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: LambdaCode.fromInline('exports.handler = () => {}'),
  });

  new Facade(stack, 'Facade', {
    schemaPath: join(__dirname, 'fixtures', 'schema.graphql'),
    userPool,
    lambdaResolvers: [
      { typeName: 'Query', fieldName: 'getItems', handler: fn },
    ],
  });

  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::AppSync::DataSource', {
    Type: 'AWS_LAMBDA',
  });
});
```

- [ ] **Step 8: Run all Facade tests**

Run: `npx nx test cdk-constructs -- --testPathPattern=facade`
Expected: ALL PASS

- [ ] **Step 9: Update old tests that use the removed `resolverFunctions` prop**

The existing tests that use `resolverFunctions: { default: fn }` need to be migrated to `lambdaResolvers: [{ typeName: 'Query', fieldName: '...', handler: fn }]`. Update each test case.

- [ ] **Step 10: Run all cdk-constructs tests**

Run: `npx nx test cdk-constructs`
Expected: ALL PASS

- [ ] **Step 11: Commit**

```bash
git add libs/cdk-constructs/
git commit -m "refactor(facade): replace single-Lambda wiring with JS pipeline + Lambda resolver support"
```

---

### Task 2: Add customEventTypeMap to Egress construct and event-publisher

**Files:**
- Modify: `libs/cdk-constructs/src/egress.ts:12-18` (EgressProps)
- Modify: `libs/lambda-utils/src/event-publisher.ts:31-34` (toDetailType)
- Modify: `libs/lambda-utils/test/event-publisher.test.ts`
- Modify: `libs/cdk-constructs/test/egress.test.ts`

- [ ] **Step 1: Write failing test — toDetailType uses custom map**

In `libs/lambda-utils/test/event-publisher.test.ts`, add:

```typescript
describe('toDetailType with customEventTypeMap', () => {
  it('uses custom mapping when key matches', () => {
    process.env.CUSTOM_EVENT_TYPE_MAP = JSON.stringify({
      'Deposit:INSERT': 'DEPOSIT_INITIATED',
      'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED',
    });
    // Re-import to pick up new env
    jest.resetModules();
    const { handler } = require('../src/event-publisher');
    // ... test that Deposit INSERT produces DEPOSIT_INITIATED DetailType
  });

  it('falls back to convention when no custom mapping', () => {
    process.env.CUSTOM_EVENT_TYPE_MAP = '{}';
    jest.resetModules();
    const { handler } = require('../src/event-publisher');
    // ... test that Goal INSERT produces GOAL_CREATED
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test lambda-utils -- --testPathPattern=event-publisher`
Expected: FAIL — custom map not consulted.

- [ ] **Step 3: Implement customEventTypeMap in event-publisher.ts**

In `libs/lambda-utils/src/event-publisher.ts`, modify the `toDetailType` function (lines 31–34):

```typescript
const customMap: Record<string, string> = JSON.parse(
  process.env.CUSTOM_EVENT_TYPE_MAP || '{}',
);

function toDetailType(typename: string, eventName: string): string {
  const customKey = `${typename}:${eventName}`;
  if (customMap[customKey]) return customMap[customKey];
  const suffix = OPERATION_SUFFIX[eventName] ?? 'CHANGED';
  return `${toScreamingSnake(typename)}_${suffix}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test lambda-utils -- --testPathPattern=event-publisher`
Expected: PASS

- [ ] **Step 5: Add customEventTypeMap to EgressProps**

In `libs/cdk-constructs/src/egress.ts`, extend `EgressProps` (line 12–18):

```typescript
export interface EgressProps {
  readonly table: ITable;
  readonly busName: string;
  readonly serviceName: string;
  readonly publishableTypes: string[];
  readonly customEventTypeMap?: Record<string, string>;
}
```

Pass it to the publisher Lambda environment (around line 34–37):

```typescript
environment: {
  BUS_NAME: props.busName,
  SERVICE_NAME: props.serviceName,
  ...(props.customEventTypeMap && {
    CUSTOM_EVENT_TYPE_MAP: JSON.stringify(props.customEventTypeMap),
  }),
},
```

- [ ] **Step 6: Run all tests**

Run: `npx nx test cdk-constructs -- --testPathPattern=egress && npx nx test lambda-utils -- --testPathPattern=event-publisher`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add libs/cdk-constructs/src/egress.ts libs/lambda-utils/src/event-publisher.ts libs/lambda-utils/test/event-publisher.test.ts
git commit -m "feat(egress): add customEventTypeMap for intent-based event publishing"
```

---

### Task 3: Set up EvaluateCode test infrastructure

**Files:**
- Create: `libs/lambda-utils/src/test-utils/evaluate-resolver.ts`
- Create: `libs/lambda-utils/test/evaluate-resolver.test.ts`

- [ ] **Step 1: Create the shared evaluateResolver helper**

Create `libs/lambda-utils/src/test-utils/evaluate-resolver.ts`:

```typescript
import { readFileSync } from 'fs';
import { AppSyncClient, EvaluateCodeCommand } from '@aws-sdk/client-appsync';

const client = new AppSyncClient({ region: process.env.AWS_REGION || 'us-east-1' });

export interface EvalContext {
  arguments?: Record<string, unknown>;
  identity?: {
    claims?: Record<string, string>;
    username?: string;
  };
  stash?: Record<string, unknown>;
  prev?: { result?: unknown };
  result?: unknown;
  error?: { message: string; type: string } | null;
  env?: Record<string, string>;
  info?: { fieldName?: string; parentTypeName?: string; selectionSetGraphQL?: string };
}

export async function evaluateResolver(
  codePath: string,
  fn: 'request' | 'response',
  ctx: EvalContext,
): Promise<unknown> {
  const code = readFileSync(codePath, 'utf-8');
  const result = await client.send(
    new EvaluateCodeCommand({
      runtime: { name: 'APPSYNC_JS', runtimeVersion: '1.0.0' },
      code,
      context: JSON.stringify(ctx),
      function: fn,
    }),
  );
  if (result.error) {
    return { __error: true, message: result.error.message, type: result.error.codeErrors?.[0]?.errorType };
  }
  return JSON.parse(result.evaluationResult!);
}

export function createAuthContext(
  tenantId: string,
  userId: string,
  overrides: Partial<EvalContext> = {},
): EvalContext {
  return {
    arguments: {},
    identity: {
      claims: { 'custom:tenantId': tenantId },
      username: `${userId}@example.com`,
    },
    stash: {},
    prev: { result: null },
    result: null,
    error: null,
    ...overrides,
  };
}
```

- [ ] **Step 2: Export from lambda-utils index**

Add to `libs/lambda-utils/src/index.ts`:

```typescript
export { evaluateResolver, createAuthContext } from './test-utils/evaluate-resolver';
export type { EvalContext } from './test-utils/evaluate-resolver';
```

- [ ] **Step 3: Install @aws-sdk/client-appsync if not present**

Run: `pnpm add -D @aws-sdk/client-appsync --filter lambda-utils`

- [ ] **Step 4: Write a smoke test for the helper**

Create `libs/lambda-utils/test/evaluate-resolver.test.ts`:

```typescript
import { join } from 'path';
import { evaluateResolver, createAuthContext } from '../src/test-utils/evaluate-resolver';

// Skip in CI if no AWS credentials
const describeWithAws = process.env.AWS_ACCESS_KEY_ID ? describe : describe.skip;

describeWithAws('evaluateResolver', () => {
  const fixturePath = join(__dirname, 'fixtures', 'echo.fn.js');

  beforeAll(() => {
    const { writeFileSync, mkdirSync } = require('fs');
    mkdirSync(join(__dirname, 'fixtures'), { recursive: true });
    writeFileSync(fixturePath, `
      export function request(ctx) { return { value: ctx.arguments.input }; }
      export function response(ctx) { return ctx.result; }
    `);
  });

  it('evaluates request function', async () => {
    const ctx = createAuthContext('t1', 'u1', { arguments: { input: 'hello' } });
    const result = await evaluateResolver(fixturePath, 'request', ctx);
    expect(result).toEqual({ value: 'hello' });
  });
});
```

- [ ] **Step 5: Run test**

Run: `npx nx test lambda-utils -- --testPathPattern=evaluate-resolver`
Expected: PASS (or SKIP if no AWS credentials)

- [ ] **Step 6: Commit**

```bash
git add libs/lambda-utils/src/test-utils/ libs/lambda-utils/test/evaluate-resolver.test.ts libs/lambda-utils/src/index.ts
git commit -m "feat(lambda-utils): add EvaluateCode test helper for JS resolver testing"
```

---

## Chunk 2: Wave 1 — dashboard-bff (5 queries, all JS)

### Task 4: Create check-auth.fn.js for dashboard-bff

**Files:**
- Create: `services/investor/dashboard-bff/src/graphql/js-function/utils/check-auth.fn.js`
- Create: `services/investor/dashboard-bff/test/graphql/check-auth.test.ts`

- [ ] **Step 1: Write failing test — checkAuth extracts claims to stash**

Create `services/investor/dashboard-bff/test/graphql/check-auth.test.ts`:

```typescript
import { join } from 'path';
import { evaluateResolver, createAuthContext } from '@nestfolio/lambda-utils';

const CODE_PATH = join(__dirname, '..', '..', 'src', 'graphql', 'js-function', 'utils', 'check-auth.fn.js');

const describeWithAws = process.env.AWS_ACCESS_KEY_ID ? describe : describe.skip;

describeWithAws('check-auth.fn.js', () => {
  it('extracts tenantId and userId to stash', async () => {
    const ctx = createAuthContext('tenant-123', 'user-456');
    const result = await evaluateResolver(CODE_PATH, 'request', ctx);
    expect(result).toEqual({});
    // stash is mutated in-place — check via response
  });

  it('returns unauthorized when tenantId missing', async () => {
    const ctx = createAuthContext('', 'user-456');
    ctx.identity!.claims = {};
    const result = await evaluateResolver(CODE_PATH, 'request', ctx);
    expect(result).toHaveProperty('__error', true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test dashboard-bff -- --testPathPattern=check-auth`
Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Create check-auth.fn.js**

Create `services/investor/dashboard-bff/src/graphql/js-function/utils/check-auth.fn.js`:

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const tenantId = ctx.identity?.claims?.['custom:tenantId'];
  const username = ctx.identity?.username;

  if (!tenantId || !username) {
    util.unauthorized();
  }

  const userId = username.split('@')[0];
  ctx.stash.tenantId = tenantId;
  ctx.stash.userId = userId;
  return {};
}

export function response(ctx) {
  return ctx.prev.result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test dashboard-bff -- --testPathPattern=check-auth`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/investor/dashboard-bff/src/graphql/ services/investor/dashboard-bff/test/graphql/
git commit -m "feat(dashboard-bff): add check-auth JS resolver function"
```

---

### Task 5: Create JS resolver functions for all 5 dashboard-bff queries

**Files:**
- Create: `services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js`
- Create: `services/investor/dashboard-bff/src/graphql/js-function/get-position-snapshots.fn.js`
- Create: `services/investor/dashboard-bff/src/graphql/js-function/get-recent-activity.fn.js`
- Create: `services/investor/dashboard-bff/src/graphql/js-function/get-time-travel-availability.fn.js`
- Create: `services/investor/dashboard-bff/src/graphql/js-function/get-simulation-summary.fn.js`
- Create: `services/investor/dashboard-bff/test/graphql/dashboard-resolvers.test.ts`

- [ ] **Step 1: Write failing tests for all 5 resolvers**

Create `services/investor/dashboard-bff/test/graphql/dashboard-resolvers.test.ts`:

```typescript
import { join } from 'path';
import { evaluateResolver, createAuthContext } from '@nestfolio/lambda-utils';

const JS_DIR = join(__dirname, '..', '..', 'src', 'graphql', 'js-function');
const describeWithAws = process.env.AWS_ACCESS_KEY_ID ? describe : describe.skip;

describeWithAws('dashboard-bff JS resolvers', () => {
  const baseCtx = () => createAuthContext('tenant-1', 'user-1', {
    stash: { tenantId: 'tenant-1', userId: 'user-1', tableName: 'test-table' },
  });

  describe('get-dashboard.fn.js', () => {
    const codePath = join(JS_DIR, 'get-dashboard.fn.js');

    it('request: produces BatchGetItem with 3 keys', async () => {
      const result = await evaluateResolver(codePath, 'request', baseCtx());
      expect(result).toMatchObject({
        operation: 'BatchGetItem',
        tables: {
          'test-table': expect.arrayContaining([
            expect.objectContaining({ pk: expect.any(Object) }),
          ]),
        },
      });
    });

    it('response: maps items by sk to dashboard shape', async () => {
      const ctx = {
        ...baseCtx(),
        result: {
          data: {
            'test-table': [
              { sk: 'PortfolioSummary', totalValueCents: 100 },
              { sk: 'AdvisoryStatus', pendingDecisionsCount: 2 },
              { sk: 'InvestorSnapshot', operatingMode: 'BALANCED' },
            ],
          },
        },
      };
      const result = await evaluateResolver(codePath, 'response', ctx);
      expect(result).toEqual({
        portfolioSummary: expect.objectContaining({ totalValueCents: 100 }),
        advisoryStatus: expect.objectContaining({ pendingDecisionsCount: 2 }),
        investorSnapshot: expect.objectContaining({ operatingMode: 'BALANCED' }),
      });
    });

    it('response: returns nulls for missing items', async () => {
      const ctx = { ...baseCtx(), result: { data: { 'test-table': [] } } };
      const result = await evaluateResolver(codePath, 'response', ctx);
      expect(result).toEqual({
        portfolioSummary: null,
        advisoryStatus: null,
        investorSnapshot: null,
      });
    });
  });

  describe('get-position-snapshots.fn.js', () => {
    const codePath = join(JS_DIR, 'get-position-snapshots.fn.js');

    it('request: produces Query with Position# prefix', async () => {
      const result = await evaluateResolver(codePath, 'request', baseCtx());
      expect(result).toMatchObject({
        operation: 'Query',
        query: expect.objectContaining({
          expression: expect.stringContaining('pk'),
        }),
      });
    });

    it('response: returns items array', async () => {
      const ctx = { ...baseCtx(), result: { items: [{ symbol: 'AAPL' }] } };
      const result = await evaluateResolver(codePath, 'response', ctx);
      expect(result).toEqual([{ symbol: 'AAPL' }]);
    });
  });

  describe('get-recent-activity.fn.js', () => {
    const codePath = join(JS_DIR, 'get-recent-activity.fn.js');

    it('request: uses limit from args with reverse sort', async () => {
      const ctx = { ...baseCtx(), arguments: { limit: 10 } };
      const result = await evaluateResolver(codePath, 'request', ctx);
      expect(result).toMatchObject({
        operation: 'Query',
        scanIndexForward: false,
        limit: 10,
      });
    });

    it('request: defaults limit to 20', async () => {
      const result = await evaluateResolver(codePath, 'request', baseCtx());
      expect(result).toMatchObject({ limit: 20 });
    });

    it('request: rejects limit > 100', async () => {
      const ctx = { ...baseCtx(), arguments: { limit: 200 } };
      const result = await evaluateResolver(codePath, 'request', ctx);
      expect(result).toHaveProperty('__error', true);
    });
  });

  describe('get-time-travel-availability.fn.js', () => {
    const codePath = join(JS_DIR, 'get-time-travel-availability.fn.js');

    it('request: produces GetItem for TimeTravel sk', async () => {
      const result = await evaluateResolver(codePath, 'request', baseCtx());
      expect(result).toMatchObject({ operation: 'GetItem' });
    });

    it('response: returns defaults when item is null', async () => {
      const ctx = { ...baseCtx(), result: null };
      const result = await evaluateResolver(codePath, 'response', ctx);
      expect(result).toEqual({ available: false, oldestDate: null, latestDate: null });
    });
  });

  describe('get-simulation-summary.fn.js', () => {
    const codePath = join(JS_DIR, 'get-simulation-summary.fn.js');

    it('request: produces GetItem for SimulationSummary sk', async () => {
      const result = await evaluateResolver(codePath, 'request', baseCtx());
      expect(result).toMatchObject({ operation: 'GetItem' });
    });

    it('response: returns null when item is null', async () => {
      const ctx = { ...baseCtx(), result: null };
      const result = await evaluateResolver(codePath, 'response', ctx);
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test dashboard-bff -- --testPathPattern=dashboard-resolvers`
Expected: FAIL — files don't exist.

- [ ] **Step 3: Create get-dashboard.fn.js**

Create `services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js`:

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const table = ctx.stash.tableName;
  return {
    operation: 'BatchGetItem',
    tables: {
      [table]: [
        util.dynamodb.toMapValues({ pk: `Dashboard#${tenantId}`, sk: 'PortfolioSummary' }),
        util.dynamodb.toMapValues({ pk: `Dashboard#${tenantId}`, sk: 'AdvisoryStatus' }),
        util.dynamodb.toMapValues({ pk: `Dashboard#${tenantId}`, sk: 'InvestorSnapshot' }),
      ],
    },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.data[ctx.stash.tableName] || [];
  const byType = {};
  for (const item of items) byType[item.sk] = item;
  return {
    portfolioSummary: byType['PortfolioSummary'] || null,
    advisoryStatus: byType['AdvisoryStatus'] || null,
    investorSnapshot: byType['InvestorSnapshot'] || null,
  };
}
```

- [ ] **Step 4: Create get-position-snapshots.fn.js**

Create `services/investor/dashboard-bff/src/graphql/js-function/get-position-snapshots.fn.js`:

```javascript
import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  return ddb.query({
    query: {
      pk: { eq: `Dashboard#${tenantId}` },
      sk: { beginsWith: 'Position#' },
    },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.items || [];
}
```

- [ ] **Step 5: Create get-recent-activity.fn.js**

Create `services/investor/dashboard-bff/src/graphql/js-function/get-recent-activity.fn.js`:

```javascript
import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const limit = ctx.arguments?.limit ?? 20;

  if (limit < 1 || limit > 100) {
    util.error('limit must be between 1 and 100', 'ValidationError');
  }

  return ddb.query({
    query: {
      pk: { eq: `Dashboard#${tenantId}` },
      sk: { beginsWith: 'Activity#' },
    },
    limit,
    scanIndexForward: false,
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.items || [];
}
```

- [ ] **Step 6: Create get-time-travel-availability.fn.js**

Create `services/investor/dashboard-bff/src/graphql/js-function/get-time-travel-availability.fn.js`:

```javascript
import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  return ddb.get({
    key: { pk: `Dashboard#${tenantId}`, sk: 'TimeTravel' },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) {
    return { available: false, oldestDate: null, latestDate: null };
  }
  return ctx.result;
}
```

- [ ] **Step 7: Create get-simulation-summary.fn.js**

Create `services/investor/dashboard-bff/src/graphql/js-function/get-simulation-summary.fn.js`:

```javascript
import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  return ddb.get({
    key: { pk: `Dashboard#${tenantId}`, sk: 'SimulationSummary' },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result || null;
}
```

- [ ] **Step 8: Run all resolver tests**

Run: `npx nx test dashboard-bff -- --testPathPattern=dashboard-resolvers`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add services/investor/dashboard-bff/src/graphql/
git commit -m "feat(dashboard-bff): add JS resolver functions for all 5 queries"
```

---

### Task 6: Wire dashboard-bff service.stack.ts to use JS resolvers

**Files:**
- Modify: `services/investor/dashboard-bff/src/service.stack.ts:80-103`
- Delete: `services/investor/dashboard-bff/src/handlers/graphql-resolver.ts`
- Delete: `services/investor/dashboard-bff/src/resolvers/` (if exists)
- Delete: `services/investor/dashboard-bff/src/validation/schemas.ts` (if exists)

- [ ] **Step 1: Update service.stack.ts — remove resolver Lambda, add JS resolvers**

In `services/investor/dashboard-bff/src/service.stack.ts`:

Remove the GraphQL resolver Lambda creation (lines 80–89). Remove the `resolverFunctions` prop from Facade and replace with `jsResolvers` + `table`:

```typescript
import { join } from 'path';

const JS_FN_PATH = join(__dirname, 'graphql', 'js-function');
const checkAuthPath = join(JS_FN_PATH, 'utils', 'check-auth.fn.js');

// Replace the Facade instantiation (lines 99-103) with:
new Facade(this, 'Facade', {
  schemaPath: join(__dirname, 'schema.graphql'),
  userPool,
  table: state.table,
  jsResolvers: [
    {
      typeName: 'Query',
      fieldName: 'getDashboard',
      pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-dashboard.fn.js')],
    },
    {
      typeName: 'Query',
      fieldName: 'getPositionSnapshots',
      pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-position-snapshots.fn.js')],
    },
    {
      typeName: 'Query',
      fieldName: 'getRecentActivity',
      pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-recent-activity.fn.js')],
    },
    {
      typeName: 'Query',
      fieldName: 'getTimeTravelAvailability',
      pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-time-travel-availability.fn.js')],
    },
    {
      typeName: 'Query',
      fieldName: 'getSimulationSummary',
      pipeline: [checkAuthPath, join(JS_FN_PATH, 'get-simulation-summary.fn.js')],
    },
  ],
});
```

- [ ] **Step 2: Delete the old Lambda resolver handler**

```bash
rm services/investor/dashboard-bff/src/handlers/graphql-resolver.ts
```

Also delete the resolver files, validation schemas, and any unused imports in the repository (keep repository methods used by event-listener pipes).

- [ ] **Step 3: Delete old resolver tests that tested the Lambda handler**

Remove test files that import from `handlers/graphql-resolver.ts` or `resolvers/*.resolver.ts`.

- [ ] **Step 4: Run CDK synth to verify stack compiles**

Run: `npx nx run dashboard-bff:synth` (or `npx cdk synth` from service directory)
Expected: Synthesizes successfully.

- [ ] **Step 5: Run all dashboard-bff tests**

Run: `npx nx test dashboard-bff`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add -A services/investor/dashboard-bff/
git commit -m "feat(dashboard-bff): migrate all 5 queries to JS pipeline resolvers"
```

---

## Chunk 3: Wave 2 — advisory-bff (6 queries + 2 mutations)

### Task 7: Create JS resolver functions for advisory-bff queries

**Files:**
- Create: `services/advisory/advisory-bff/src/graphql/js-function/utils/check-auth.fn.js`
- Create: `services/advisory/advisory-bff/src/graphql/js-function/get-decision.fn.js`
- Create: `services/advisory/advisory-bff/src/graphql/js-function/get-pending-decisions.fn.js`
- Create: `services/advisory/advisory-bff/src/graphql/js-function/get-decision-history.fn.js`
- Create: `services/advisory/advisory-bff/src/graphql/js-function/get-agent-invocations.fn.js`
- Create: `services/advisory/advisory-bff/src/graphql/js-function/get-compliance-checks.fn.js`
- Create: `services/advisory/advisory-bff/src/graphql/js-function/record-explanation-view.fn.js`
- Create: `services/advisory/advisory-bff/test/graphql/advisory-query-resolvers.test.ts`

Follow the same TDD pattern as Task 4–5. Key details per resolver:

- `getDecision`: `ddb.query()` on `pk=Decision#${tenantId}#${decisionId}`, sk beginsWith `DecisionReadModel`. Validate `decisionId` (non-empty string, max 256 chars).
- `getPendingDecisions`: `ddb.query()` on GSI `tenantId-index` with filter for 5 statuses (`PROPOSED`, `COMPLIANCE_REVIEW`, `APPROVED`, `CONFIRMATION_REQUIRED`, `AWAITING_CONFIRMATION`). Pagination with `nextToken` + `limit` (1–100, default 20).
- `getDecisionHistory`: `ddb.query()` on GSI `tenantId-index` with filter `__typename = DecisionReadModel`. Pagination.
- `getAgentInvocations`: `ddb.query()` on `pk=Decision#${tenantId}#${decisionId}`, sk beginsWith `AgentInvocation#`.
- `getComplianceChecks`: `ddb.query()` on `pk=Decision#${tenantId}#${decisionId}`, sk beginsWith `ComplianceCheck#`.
- `recordExplanationView`: `ddb.put()` single UserInteraction item. sk=`UserInteraction#${util.autoId()}`.

- [ ] **Step 1: Write failing tests for all 6 query resolvers + recordExplanationView**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement all .fn.js files**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-bff/src/graphql/ services/advisory/advisory-bff/test/graphql/
git commit -m "feat(advisory-bff): add JS resolver functions for queries and recordExplanationView"
```

---

### Task 8: Create JS resolver functions for advisory-bff mutations (confirmDecision, rejectDecision)

**Files:**
- Create: `services/advisory/advisory-bff/src/graphql/js-function/transact-confirm-decision.fn.js`
- Create: `services/advisory/advisory-bff/src/graphql/js-function/transact-reject-decision.fn.js`
- Create: `services/advisory/advisory-bff/src/graphql/js-function/get-decision-readback.fn.js`
- Create: `services/advisory/advisory-bff/test/graphql/advisory-mutation-resolvers.test.ts`

Key details:

- `confirmDecision` pipeline: `checkAuth` → `transactConfirmDecision` → `getDecisionReadback`
  - TransactWriteItems (2 items): UpdateItem on DecisionReadModel (status→CONFIRMED, confirmedAt, confirmedBy) + PutItem UserConfirmation
  - readBack: `ddb.get()` on `pk=Decision#${tenantId}#${decisionId}`, sk=`DecisionReadModel`
- `rejectDecision` pipeline: `checkAuth` → `transactRejectDecision` → `getDecisionReadback`
  - TransactWriteItems (2 items): UpdateItem on DecisionReadModel (status→REJECTED, rejectedAt, rejectionReason, rejectedBy) + PutItem UserRejection
  - Validate: `decisionId` (1–256 chars), `reason` (1–2000 chars)
- Both share `getDecisionReadback` function.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement transact-confirm-decision.fn.js**
- [ ] **Step 4: Implement transact-reject-decision.fn.js**
- [ ] **Step 5: Implement get-decision-readback.fn.js**
- [ ] **Step 6: Run tests to verify they pass**
- [ ] **Step 7: Commit**

```bash
git add services/advisory/advisory-bff/src/graphql/ services/advisory/advisory-bff/test/graphql/
git commit -m "feat(advisory-bff): add JS resolver functions for confirmDecision and rejectDecision"
```

---

### Task 9: Wire advisory-bff service.stack.ts and clean up

**Files:**
- Modify: `services/advisory/advisory-bff/src/service.stack.ts`
- Delete: `services/advisory/advisory-bff/src/handlers/graphql-resolver.ts`
- Delete: `services/advisory/advisory-bff/src/resolvers/*.resolver.ts`
- Delete: `services/advisory/advisory-bff/src/validation/schemas.ts`

Follow the same pattern as Task 6. Wire all 8 operations in `jsResolvers`. The `confirmDecision` and `rejectDecision` pipelines have 3 functions (checkAuth + transact + readback). Delete old Lambda handler, resolvers, and validation.

- [ ] **Step 1: Update service.stack.ts with jsResolvers config**
- [ ] **Step 2: Delete old Lambda resolver, resolver files, validation schemas**
- [ ] **Step 3: Clean up repository — remove methods only used by old resolvers (keep pipe-used methods)**
- [ ] **Step 4: Run CDK synth**
- [ ] **Step 5: Run all advisory-bff tests**
- [ ] **Step 6: Commit**

```bash
git add -A services/advisory/advisory-bff/
git commit -m "feat(advisory-bff): migrate all 8 operations to JS pipeline resolvers"
```

---

## Chunk 4: Wave 3 — portfolio-bff (4 queries)

### Task 10: Create JS resolver functions for portfolio-bff

**Files:**
- Create: `services/execution/portfolio-bff/src/graphql/js-function/utils/check-auth.fn.js`
- Create: `services/execution/portfolio-bff/src/graphql/js-function/get-portfolio.fn.js`
- Create: `services/execution/portfolio-bff/src/graphql/js-function/create-portfolio.fn.js`
- Create: `services/execution/portfolio-bff/src/graphql/js-function/get-positions.fn.js`
- Create: `services/execution/portfolio-bff/src/graphql/js-function/get-cash-balance.fn.js`
- Create: `services/execution/portfolio-bff/src/graphql/js-function/get-performance.fn.js`
- Create: `services/execution/portfolio-bff/test/graphql/portfolio-resolvers.test.ts`

Key details:

- `getPortfolio`: 3-function pipeline: `checkAuth` → `get-portfolio.fn.js` → `create-portfolio.fn.js`
  - `get-portfolio`: `ddb.get()`, calls `runtime.earlyReturn()` if found
  - `create-portfolio`: `ddb.put()` with condition `{ pk: { attributeExists: false } }`, handles `ConditionalCheckFailedException` as race condition
- `getPositions`: `ddb.query()` on `pk=Portfolio#${tenantId}#${tenantId}`, sk beginsWith `Position#`
- `getCashBalance`: `ddb.get()` on sk=`CashBalance#USD` (default currency). Return `{ currency: 'USD', amount: 0, updatedAt: now }` if null.
- `getPerformance`: NoneDataSource stub — return `{ period: args.period || 'MONTH', returnPercent: 0, returnAbsolute: 0, sharpeRatio: null, maxDrawdown: null }`. Set `dataSource: 'none'` in jsResolvers config.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement all .fn.js files**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

### Task 11: Wire portfolio-bff service.stack.ts and clean up

Follow same pattern as Task 6/9. Wire 4 operations. `getPortfolio` pipeline has 3 functions. `getPerformance` uses `dataSource: 'none'`.

- [ ] **Step 1: Update service.stack.ts**
- [ ] **Step 2: Delete old Lambda resolver, resolvers, validation**
- [ ] **Step 3: Run CDK synth**
- [ ] **Step 4: Run all portfolio-bff tests**
- [ ] **Step 5: Commit**

```bash
git add -A services/execution/portfolio-bff/
git commit -m "feat(portfolio-bff): migrate all 4 queries to JS pipeline resolvers"
```

---

## Chunk 5: Wave 4 — order-ledger-bff (3 JS + 2 Lambda hybrid)

### Task 12: Create JS resolver functions for order-ledger-bff

**Files:**
- Create: `services/execution/order-ledger-bff/src/graphql/js-function/utils/check-auth.fn.js`
- Create: `services/execution/order-ledger-bff/src/graphql/js-function/get-ledger-portfolio-snapshot.fn.js`
- Create: `services/execution/order-ledger-bff/src/graphql/js-function/get-ledger-portfolio-positions.fn.js`
- Create: `services/execution/order-ledger-bff/src/graphql/js-function/get-order-history.fn.js`
- Create: `services/execution/order-ledger-bff/src/graphql/js-function/get-time-travel-earliest.fn.js`
- Create: `services/execution/order-ledger-bff/src/graphql/js-function/get-time-travel-latest.fn.js`
- Create: `services/execution/order-ledger-bff/test/graphql/ledger-resolvers.test.ts`

Key details:

- `getLedgerPortfolio`: 3-function pipeline: `checkAuth` → `get-ledger-portfolio-snapshot` (ddb.get + earlyReturn default if null) → `get-ledger-portfolio-positions` (ddb.query)
  - Validate `streamType` (actual|simulated)
- `getOrderHistory`: `checkAuth` → `get-order-history` (ddb.query with pagination, branch on orderId present)
  - With orderId: query pk=`OrderStream#${tenantId}#${streamType}#${orderId}`, sk beginsWith `Event#`
  - Without orderId: query GSI `tenantId-index`, filter streamType + __typename=LedgerEntry
  - Validate: streamType enum, limit 1–100, optional cursor
- `getTimeTravelAvailability`: 3-function pipeline: `checkAuth` → `get-time-travel-earliest` → `get-time-travel-latest`
  - Earliest: query pk=`Portfolio#${tenantId}#actual`, sk beginsWith `Checkpoint#`, ScanIndexForward=true, Limit=1
  - Latest: query same pk, sk between `Checkpoint#` and `Checkpoint#9999-12-31`, ScanIndexForward=false, Limit=1
  - Response of latest function merges both dates from stash

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement all .fn.js files**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

### Task 13: Wire order-ledger-bff service.stack.ts — hybrid JS + Lambda

**Files:**
- Modify: `services/execution/order-ledger-bff/src/service.stack.ts`
- Modify: `services/execution/order-ledger-bff/src/handlers/graphql-resolver.ts` (keep for 2 Lambda fields, remove JS-migrated cases)

This is the first hybrid BFF. Wire 3 operations via `jsResolvers` and 2 via `lambdaResolvers`.

- [ ] **Step 1: Update service.stack.ts**

```typescript
new Facade(this, 'Facade', {
  schemaPath: join(__dirname, 'schema.graphql'),
  userPool,
  table: state.table,
  jsResolvers: [
    { typeName: 'Query', fieldName: 'getLedgerPortfolio', pipeline: [checkAuthPath, snapshotPath, positionsPath] },
    { typeName: 'Query', fieldName: 'getOrderHistory', pipeline: [checkAuthPath, orderHistoryPath] },
    { typeName: 'Query', fieldName: 'getTimeTravelAvailability', pipeline: [checkAuthPath, earliestPath, latestPath] },
  ],
  lambdaResolvers: [
    { typeName: 'Query', fieldName: 'getPortfolioAt', handler: resolverFn },
    { typeName: 'Query', fieldName: 'getSimulationComparison', handler: resolverFn },
  ],
});
```

- [ ] **Step 2: Trim graphql-resolver.ts — remove migrated cases, keep only getPortfolioAt and getSimulationComparison**
- [ ] **Step 3: Run CDK synth**
- [ ] **Step 4: Run all order-ledger-bff tests**
- [ ] **Step 5: Commit**

```bash
git add -A services/execution/order-ledger-bff/
git commit -m "feat(order-ledger-bff): migrate 3 queries to JS resolvers, keep 2 as Lambda"
```

---

## Chunk 6: Wave 5 — investor-bff (16 operations, Egress enhancement)

### Task 14: Create JS resolver functions for investor-bff queries (4 queries)

**Files:**
- Create: `services/investor/investor-bff/src/graphql/js-function/utils/check-auth.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/get-profile.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/get-goals.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/get-notifications.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/get-unread-count.fn.js`
- Create: `services/investor/investor-bff/test/graphql/investor-query-resolvers.test.ts`

Key details:
- `getProfile`: `ddb.get()` on pk=`InvestorProfile#${tenantId}#${userId}`, sk=`InvestorProfile`
- `getGoals`: `ddb.query()` on pk, sk beginsWith `Goal#`
- `getNotifications`: `ddb.query()` on pk, sk beginsWith `Notification#`, with `nextToken` + `limit` (1–100, default 20), `scanIndexForward: false`. Response: `{ items, nextCursor: nextToken }`.
- `getUnreadCount`: `ddb.query()` on pk, sk beginsWith `Notification#`, filter `status <> READ`, select `COUNT`. Response: `ctx.result.scannedCount` (or the count field).

- [ ] **Step 1–5: TDD cycle — tests, implement, verify, commit**

---

### Task 15: Create JS resolver functions for investor-bff simple mutations (5 mutations)

**Files:**
- Create: `services/investor/investor-bff/src/graphql/js-function/mark-notification-read.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/record-onboarding-answer.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/request-account-closure.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/initiate-deposit.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/request-withdrawal.fn.js`
- Create: `services/investor/investor-bff/test/graphql/investor-simple-mutations.test.ts`

Key details:
- `markNotificationRead`: `ddb.update()` with condition `attributeExists(pk)`, set status=`READ`, readAt=now. Return ALL_NEW.
- `recordOnboardingAnswer`: NoneDataSource stub. `dataSource: 'none'`.
- `requestAccountClosure`: NoneDataSource stub. `dataSource: 'none'`.
- `initiateDeposit`: `ddb.put()` — item must include `__typename: 'Deposit'`, `depositId`, `tenantId`, `userId`, `amountCents`, `currency`, `status: 'INITIATED'`, `initiatedAt`. Validate amountCents > 0, currency 3 chars. Egress handles event publishing.
- `requestWithdrawal`: `TransactWriteItems` (2 items: conditional CashBalance update + Withdrawal put). See spec for exact format. Egress handles event publishing.

- [ ] **Step 1–5: TDD cycle**

---

### Task 16: Create JS resolver functions for investor-bff TransactWriteItems mutations (7 mutations)

**Files:**
- Create: `services/investor/investor-bff/src/graphql/js-function/set-goal.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/update-goal.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/set-risk-profile.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/grant-mandate.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/update-mandate.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/revoke-mandate.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/select-operating-mode.fn.js`
- Create: `services/investor/investor-bff/test/graphql/investor-transact-mutations.test.ts`

Key details per mutation:

- `setGoal`: TransactWriteItems (2: PutItem Goal + PutItem EditEvent). Validate: targetAmountCents > 0, timeHorizonMonths 1–600, targetReturn 0–1.
- `updateGoal`: TransactWriteItems (2: UpdateItem Goal with condition `attributeExists(pk)` + PutItem EditEvent). Now atomic. Validate: at least 1 field provided.
- `setRiskProfile`: TransactWriteItems (2: PutItem RiskProfile + PutItem EditEvent). Validate: score 1–10, equities 0–100, minEquity ≤ maxEquity.
- `grantMandate`: TransactWriteItems (2: PutItem Mandate + PutItem EditEvent). Validate: turnover/trade % 0–100, coolDownDays 0–365.
- `updateMandate`: Same as grantMandate (re-grant pattern).
- `revokeMandate`: TransactWriteItems (2: UpdateItem Mandate set revokedAt + PutItem EditEvent). Now atomic.
- `selectOperatingMode`: TransactWriteItems (3: PutItem OperatingMode + PutItem EditEvent + UpdateItem InvestorProfile set operatingMode). Validate: mode enum (CONSERVATIVE|BALANCED|AGGRESSIVE).

- [ ] **Step 1–5: TDD cycle**

---

### Task 17: Wire investor-bff service.stack.ts with Egress customEventTypeMap

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts`
- Delete: `services/investor/investor-bff/src/handlers/graphql-resolver.ts`
- Delete: `services/investor/investor-bff/src/resolvers/*.resolver.ts`
- Delete: `services/investor/investor-bff/src/validation/schemas.ts`

- [ ] **Step 1: Update Egress with customEventTypeMap**

In service.stack.ts, add to the Egress construct:

```typescript
new Egress(this, 'Egress', {
  table: state.table,
  busName,
  serviceName: naming.serviceName,
  publishableTypes: ['Goal', 'RiskProfile', 'Mandate', 'OperatingModeRecord', 'InvestorProfile', 'Deposit', 'Withdrawal'],
  customEventTypeMap: {
    'Deposit:INSERT': 'DEPOSIT_INITIATED',
    'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED',
  },
});
```

- [ ] **Step 2: Update Facade with all 16 jsResolvers**

Wire all 16 operations. Stubs use `dataSource: 'none'`.

- [ ] **Step 3: Delete old Lambda resolver, resolvers, validation, unused repository methods**
- [ ] **Step 4: Run CDK synth**
- [ ] **Step 5: Run all investor-bff tests**
- [ ] **Step 6: Commit**

```bash
git add -A services/investor/investor-bff/
git commit -m "feat(investor-bff): migrate all 16 operations to JS pipeline resolvers with Egress customEventTypeMap"
```

---

## Chunk 7: Final Verification

### Task 18: Run all projects and verify

- [ ] **Step 1: Run all 31 project tests**

```bash
npx nx run-many --target=test --all
```

Expected: ALL PASS

- [ ] **Step 2: Run CDK synth for all service stacks**

```bash
npx nx run-many --target=synth --projects=investor-bff,advisory-bff,portfolio-bff,dashboard-bff,order-ledger-bff
```

Expected: All synthesize successfully.

- [ ] **Step 3: Verify no orphaned imports**

Search for imports from deleted files:

```bash
grep -r "graphql-resolver" services/*/src/ --include="*.ts" | grep -v node_modules | grep -v ".fn.js"
grep -r "from.*resolvers/" services/*/src/ --include="*.ts" | grep -v node_modules | grep -v graphql
```

Expected: No results (except order-ledger-bff which keeps its graphql-resolver.ts).

- [ ] **Step 4: Commit final verification**

```bash
git commit --allow-empty -m "chore: verify all 31 projects pass after JS resolver migration"
```
