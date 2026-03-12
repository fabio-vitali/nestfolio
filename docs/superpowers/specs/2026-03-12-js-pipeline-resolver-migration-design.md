# JS Pipeline Resolver Migration

Migrate 36 of 38 BFF GraphQL operations from Lambda resolvers to AppSync JS pipeline resolvers (APPSYNC_JS runtime). Keep 2 operations as Lambda where JS implementation is impractical.

## Motivation

- **Latency**: JS resolvers eliminate Lambda cold starts (100-400ms savings per cold invocation) and remove Lambda overhead (init, deserialize, re-serialize). BFF read latency matters.
- **Atomicity**: Three currently non-atomic operations (`updateGoal`, `revokeMandate`, `requestWithdrawal`) become truly atomic via `TransactWriteItems`. Operations already using `TransactWriteItems` in Lambda (`setGoal`, `setRiskProfile`, `grantMandate`, `updateMandate`, `selectOperatingMode`) retain their atomicity in the JS resolver equivalent.
- **Error surface**: Fewer Lambdas means no Lambda runtime errors, no OOM, no timeout, no SDK version conflicts.
- **Cost**: No Lambda invocation charges; AppSync resolver execution is included in API price.
- **Reliable event delivery**: Egress stream-based publishing (with retry + DLQ) replaces non-atomic Lambda publish for deposit/withdrawal.

## Architecture

### Pipeline Pattern

Every JS-resolved field follows the same pipeline:

```
Root resolver (inline) → checkAuth.fn.js → businessLogic.fn.js [→ readBack.fn.js]
```

- **Root resolver**: `Code.fromInline(...)` — sets `ctx.stash.tableName` from CDK environment, returns `ctx.prev.result`
- **checkAuth.fn.js**: Extracts `tenantId`/`userId` from Cognito `ctx.identity.claims['custom:tenantId']` and `ctx.identity.username`, stashes them. Calls `util.unauthorized()` on failure.
- **Business logic .fn.js**: Performs DynamoDB operation(s) using `@aws-appsync/utils/dynamodb` helpers (`ddb.get`, `ddb.query`, `ddb.put`, `ddb.update`) or raw `TransactWriteItems` / `BatchGetItem` requests. Validates inputs via `util.error()`.
- **readBack .fn.js** (optional): For mutations like `confirmDecision` that need to return the updated item after `TransactWriteItems` (which doesn't return items).

### File Organization

Per-BFF, colocated with the service:

```
services/<domain>/<bff>/src/
  graphql/
    js-function/
      utils/
        check-auth.fn.js
      get-profile.fn.js
      set-goal.fn.js
      ...
  handlers/
    graphql-resolver.ts       # KEPT only in order-ledger-bff (2 Lambda fields)
  schema.graphql
  service.stack.ts
```

Each BFF gets its own copy of `check-auth.fn.js` (~15 lines). Resolver files are named after the GraphQL field in kebab-case with `.fn.js` suffix.

## Facade Construct Refactor

Replace the current single-Lambda wiring with config-driven multi-datasource support.

### Props

```typescript
export interface FacadeProps {
  schemaPath: string;
  userPool: IUserPool;
  table: ITable;
  ssmPrefix?: string;
  queryDepthLimit?: number;
  enableWaf?: boolean;
  wafRateLimit?: number;
  jsResolvers: JsResolverConfig[];
  lambdaResolvers?: LambdaResolverConfig[];
}

interface JsResolverConfig {
  typeName: 'Query' | 'Mutation';
  fieldName: string;
  pipeline: string[];                          // ordered .fn.js file paths
  dataSource?: 'dynamodb' | 'none';            // default: dynamodb
}

interface LambdaResolverConfig {
  typeName: 'Query' | 'Mutation';
  fieldName: string;
  handler: IFunction;
}
```

### Internal Behavior

1. Creates `GraphqlApi` with Cognito auth, WAF, SSM output (same as today).
2. Creates a `DynamoDbDataSource` from `props.table` (grants read/write).
3. Creates a `NoneDataSource` for auth functions and stub fields.
4. Creates one `AppsyncFunction` for `checkAuth` (NoneDataSource), reused across all pipelines.
5. For each `jsResolvers` entry: creates an `AppsyncFunction` per pipeline step + a `Resolver` with `FunctionRuntime.JS_1_0_0` and `pipelineConfig`.
6. For each `lambdaResolvers` entry: creates a `LambdaDataSource` + standard resolver.
7. Root resolver for each pipeline uses `Code.fromInline(...)`:
   ```javascript
   export function request(ctx) {
     ctx.stash.tableName = '${tableName}';
     return {};
   }
   export function response(ctx) {
     return ctx.prev.result;
   }
   ```

### Data Source Assignment

- Pipeline steps that perform DynamoDB operations → `DynamoDbDataSource`
- `checkAuth`, stubs (`recordOnboardingAnswer`, `requestAccountClosure`, `getPerformance`) → `NoneDataSource`
- Lambda-kept fields → `LambdaDataSource`

## Egress Enhancement

### Problem

`initiateDeposit` and `requestWithdrawal` currently publish events (`DEPOSIT_INITIATED`, `WITHDRAWAL_REQUESTED`) explicitly from the Lambda resolver after writing to DynamoDB. This is non-atomic: if the EventBridge publish fails after the DDB write, the event is lost.

With JS resolvers, the Lambda is gone. Events must be published another way.

### Solution

Add `customEventTypeMap` to the Egress construct. The event-publisher Lambda checks this map before falling back to the convention-based `toDetailType`.

**event-publisher.ts change:**

```typescript
const customMap: Record<string, string> = JSON.parse(
  process.env.CUSTOM_EVENT_TYPE_MAP || '{}'
);

function toDetailType(typename: string, eventName: string): string {
  const customKey = `${typename}:${eventName}`;
  if (customMap[customKey]) return customMap[customKey];
  const suffix = OPERATION_SUFFIX[eventName] ?? 'CHANGED';
  return `${toScreamingSnake(typename)}_${suffix}`;
}
```

**EgressProps extension:**

```typescript
export interface EgressProps {
  // ... existing props ...
  customEventTypeMap?: Record<string, string>;
}
```

Passed as `CUSTOM_EVENT_TYPE_MAP` env var (JSON stringified) to the publisher Lambda.

**Only investor-bff needs this** — 2 mappings:

| Key | Value |
|-----|-------|
| `Deposit:INSERT` | `DEPOSIT_INITIATED` |
| `Withdrawal:INSERT` | `WITHDRAWAL_REQUESTED` |

All other BFFs continue using the convention-based mapping unchanged.

## DynamoDB Operation Patterns

### Simple Reads (`ddb.get`, `ddb.query`)

```javascript
import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  return ddb.get({
    key: {
      pk: `InvestorProfile#${tenantId}#${userId}`,
      sk: 'InvestorProfile',
    },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
```

### Collection Queries with Pagination

```javascript
export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const { limit = 20, cursor } = ctx.args;
  return ddb.query({
    query: {
      pk: { eq: `InvestorProfile#${tenantId}#${userId}` },
      sk: { beginsWith: 'Notification#' },
    },
    limit,
    nextToken: cursor || undefined,
    scanIndexForward: false,
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const { items = [], nextToken } = ctx.result;
  return { items, nextCursor: nextToken };
}
```

### BatchGetItem (dashboard getDashboard)

```javascript
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

### TransactWriteItems (mutations with EditEvent audit trail)

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const { input } = ctx.args;
  const timestamp = util.time.nowISO8601();
  const goalId = util.autoId();
  const eventId = util.autoId();
  const pk = `InvestorProfile#${tenantId}#${userId}`;

  // Validation (replaces Zod)
  if (input.targetAmountCents <= 0) util.error('targetAmountCents must be positive', 'ValidationError');
  if (input.timeHorizonMonths < 1 || input.timeHorizonMonths > 600)
    util.error('timeHorizonMonths must be 1-600', 'ValidationError');

  const table = ctx.stash.tableName;
  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table,
        operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `Goal#${goalId}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'Goal',
          goalId,
          tenantId,
          userId,
          ...input,
          timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      },
      {
        table,
        operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `EditEvent#${timestamp}#${eventId}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'EditEvent',
          userId,
          action: 'SET_GOAL',
          patches: JSON.stringify([{ op: 'add', path: `/goals/${goalId}`, value: input }]),
          timestamp,
        }),
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Goal already exists', 'ConflictError');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  // TransactWriteItems returns keys, not items — reconstruct from input
  const { tenantId, userId } = ctx.stash;
  const { input } = ctx.args;
  return { goalId: ctx.result.keys[0].goalId, ...input };
}
```

### TransactWriteItems with ConditionCheck (requestWithdrawal)

```javascript
export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const { input } = ctx.args;
  const timestamp = util.time.nowISO8601();
  const withdrawalId = util.autoId();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  const table = ctx.stash.tableName;

  if (input.amountCents <= 0) util.error('amountCents must be positive', 'ValidationError');
  if (!input.currency || input.currency.length !== 3)
    util.error('currency must be 3-letter ISO code', 'ValidationError');

  return {
    operation: 'TransactWriteItems',
    transactItems: [
      {
        table,
        operation: 'UpdateItem',
        key: util.dynamodb.toMapValues({ pk, sk: 'CashBalance' }),
        update: {
          expression: 'ADD balanceCents :negAmount',
          expressionValues: util.dynamodb.toMapValues({ ':negAmount': -input.amountCents }),
        },
        condition: util.transform.toDynamoDBConditionExpression({
          balanceCents: { ge: input.amountCents },
        }),
      },
      {
        table,
        operation: 'PutItem',
        key: util.dynamodb.toMapValues({ pk, sk: `Withdrawal#${withdrawalId}` }),
        attributeValues: util.dynamodb.toMapValues({
          __typename: 'Withdrawal',
          withdrawalId,
          tenantId,
          userId,
          amountCents: input.amountCents,
          currency: input.currency,
          status: 'REQUESTED',
          timestamp,
          createdAt: timestamp,
        }),
      },
    ],
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Insufficient funds', 'InsufficientFundsError');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return { withdrawalId: ctx.result.keys[1].withdrawalId, status: 'REQUESTED' };
}
```

### Get-or-Create with `runtime.earlyReturn()` (portfolio getPortfolio)

**Step 1: get-portfolio.fn.js** (DynamoDbDataSource)
```javascript
import { util, runtime } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  return ddb.get({
    key: { pk: `Portfolio#${tenantId}#${tenantId}`, sk: 'Portfolio' },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (ctx.result) {
    runtime.earlyReturn(ctx.result);
  }
  return null;
}
```

**Step 2: create-portfolio.fn.js** (DynamoDbDataSource)
```javascript
import { util, runtime } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId } = ctx.stash;
  const timestamp = util.time.nowISO8601();
  return ddb.put({
    key: { pk: `Portfolio#${tenantId}#${tenantId}`, sk: 'Portfolio' },
    item: {
      __typename: 'Portfolio',
      tenantId,
      portfolioId: tenantId,
      totalValue: 0,
      cashBalance: 0,
      positionCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    condition: { pk: { attributeExists: false } },
  });
}

export function response(ctx) {
  if (ctx.error && ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
    return ctx.prev.result; // race condition: another request created it
  }
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
```

### Confirm/Reject with Read-Back Pipeline

**Step 1: transact-confirm.fn.js** (DynamoDbDataSource)
```javascript
// TransactWriteItems: UpdateItem (decision status) + PutItem (UserConfirmation)
```

**Step 2: get-decision-readback.fn.js** (DynamoDbDataSource)
```javascript
// ddb.get() to fetch the updated decision after transaction
```

Pipeline: `checkAuth` → `transactConfirm` → `getDecisionReadback`

## Validation

All current Zod schemas are simple range/enum checks. They translate directly to `util.error()` calls in JS resolvers:

| Zod Pattern | JS Equivalent |
|-------------|---------------|
| `z.number().int().positive().max(100)` | `if (val < 1 \|\| val > 100) util.error('...',  'ValidationError')` |
| `z.enum([...])` | `if (![...].includes(val)) util.error('...', 'ValidationError')` |
| `z.string().min(1).max(256)` | `if (!val \|\| val.length > 256) util.error('...', 'ValidationError')` |
| `.refine(d => d.min <= d.max)` | `if (input.min > input.max) util.error('...', 'ValidationError')` |

No complex Zod features (transforms, discriminated unions, preprocess) are used anywhere.

## Testing

### Approach: `EvaluateCode` API

Each BFF gets Jest test files that call the AppSync `EvaluateCode` API to run `.fn.js` files against the real APPSYNC_JS runtime. No deployed infrastructure needed.

```typescript
import { AppSyncClient, EvaluateCodeCommand } from '@aws-sdk/client-appsync';

const client = new AppSyncClient({ region: 'us-east-1' });

async function evaluateResolver(codePath: string, fn: 'request' | 'response', ctx: object) {
  const code = readFileSync(codePath, 'utf-8');
  const result = await client.send(new EvaluateCodeCommand({
    runtime: { name: 'APPSYNC_JS', runtimeVersion: '1.0.0' },
    code,
    context: JSON.stringify(ctx),
    function: fn,
  }));
  return JSON.parse(result.evaluationResult!);
}
```

### What Tests Validate

- **`request()` tests**: Correct DynamoDB operation name, key construction, condition expressions, TransactWriteItems item shape, validation error on bad input
- **`response()` tests**: Error mapping (`ConditionalCheckFailedException` → user-friendly), null handling, result shaping
- **`checkAuth` tests**: `util.unauthorized()` when claims missing, correct stash values when present

### Test Infrastructure

- Shared `createMockContext()` helper per BFF with realistic Cognito claims
- Runs in CI alongside existing Jest tests (requires AWS credentials for `EvaluateCode` API)

## Subscriptions

GraphQL subscriptions (`onNotification`, `onDecisionUpdate`, `onDashboardUpdate`, `onPortfolioUpdate`, `onPositionUpdate`) use `@aws_subscribe` directives pointing at mutations. Since subscriptions are triggered by the mutation's response (not the Lambda itself), they continue to work with JS resolvers. No changes needed.

## Query Depth Protection

The current Lambda resolvers call `validateQueryDepth()` as a security measure. The Facade construct already configures `queryDepthLimit` on the `GraphqlApi` (CDK-level enforcement). This is more robust than the Lambda-level check — it rejects deep queries before any resolver executes. The Lambda-level `validateQueryDepth` is redundant and will be removed with the Lambda resolver.

## Egress Item Shape Contract

When `initiateDeposit` moves to a JS resolver, the `ddb.put()` must write an item that includes all fields downstream consumers expect in the `DEPOSIT_INITIATED` event payload. The Egress publisher forwards the full DDB `NewImage` as `subject`. Required fields: `depositId`, `tenantId`, `userId`, `amountCents`, `currency`, `status`, `initiatedAt`, `__typename: 'Deposit'`. Same applies to `requestWithdrawal` (`withdrawalId`, `amountCents`, `currency`, `status`, `__typename: 'Withdrawal'`).

## Operations Kept as Lambda

| BFF | Operation | Reason |
|-----|-----------|--------|
| order-ledger-bff | `getSimulationComparison` | 6 parallel DynamoDB reads via `Promise.all()`. Sequential JS pipeline would be 5-6x slower. Latency-critical. |
| order-ledger-bff | `getPortfolioAt` | Event sourcing replay using `portfolioReducer` from `command-core` lib. Cannot import npm modules in APPSYNC_JS runtime. |

These remain in `handlers/graphql-resolver.ts` and are wired via `lambdaResolvers` in the Facade construct.

## Migration Order

| Wave | BFF | Operations | Why This Order |
|------|-----|-----------|----------------|
| 1 | dashboard-bff | 5 queries (all JS) | Zero mutations, zero Lambda-kept. Cleanest validation of the Facade refactor. |
| 2 | advisory-bff | 6 JS queries + 2 JS mutations | Validates TransactWriteItems + read-back pipeline pattern. |
| 3 | portfolio-bff | 4 JS operations | Validates get-or-create with `runtime.earlyReturn()`. |
| 4 | order-ledger-bff | 3 JS + 2 Lambda | Validates hybrid Facade (JS + Lambda data sources coexisting). |
| 5 | investor-bff | 16 JS operations | Most complex: TransactWriteItems, conditional writes, Egress enhancement. Benefits from all patterns proven in waves 1-4. |

### Prerequisites (before Wave 1)

- Refactor `Facade` construct (new props, multi-datasource, pipeline wiring)
- Add `customEventTypeMap` to `Egress` construct and `event-publisher.ts`
- Set up `EvaluateCode` test infrastructure (shared helper, CI credentials)
- Facade construct tests updated for new behavior

## What Changes Per BFF (Wave Checklist)

For each BFF migration:

1. Create `src/graphql/js-function/utils/check-auth.fn.js`
2. Create `.fn.js` file for each operation
3. Write `EvaluateCode` tests for each `.fn.js`
4. Update `service.stack.ts`: replace `Facade` props (remove `resolverFunctions`, add `jsResolvers` + `table`)
5. Delete `handlers/graphql-resolver.ts` (unless BFF has Lambda-kept fields)
6. Delete `resolvers/*.resolver.ts` files
7. Delete `validation/schemas.ts` (validation moves inline to `.fn.js`)
8. Update `repositories/*.repository.ts` — remove methods that are now handled by JS resolvers (keep only methods used by event-listener pipes)
9. Run all tests, verify CDK synth

## What Is Lost

| Capability | Current | After Migration | Severity |
|------------|---------|-----------------|----------|
| `withErrorPublishing` (EventBridge) | Errors published as domain events | Errors only in AppSync CloudWatch logs | Low — add CloudWatch alarm on AppSync 4xx/5xx |
| `withTiming` (custom metric) | Custom latency metric per resolver | AppSync built-in per-field resolver metrics | None — AppSync metrics are better |
| `traceEvent()` (X-Ray annotations) | tenantId/eventType as X-Ray annotations | AppSync has own tracing, no custom annotations | Medium |
| Zod error messages with paths | Structured error paths | Simple `util.error()` messages | Low |
| Jest unit tests with mocked deps | Fast, no AWS dependency | `EvaluateCode` API calls (requires credentials) | Medium — CI needs AWS access |

## What Is Gained

| Benefit | Impact |
|---------|--------|
| Zero cold starts | 100-400ms savings per cold invocation on reads AND writes |
| Lower per-call latency | No Lambda overhead (init, deserialize, re-serialize) |
| Atomicity fixes | `updateGoal`, `revokeMandate`, `requestWithdrawal` become truly atomic |
| Smaller error surface | No Lambda runtime errors, OOM, timeout, SDK conflicts |
| Cost reduction | No Lambda invocation charges |
| Reliable event delivery | Stream-based Egress (retry + DLQ) replaces non-atomic Lambda publish |
| Simpler deployment | `.fn.js` files bundled with CDK, no esbuild step |

## Full Operation Map

### dashboard-bff (5 JS / 0 Lambda)

| Operation | Type | Pipeline Pattern |
|-----------|------|-----------------|
| `getDashboard` | Query | `checkAuth` → `BatchGetItem` (3 items) |
| `getPositionSnapshots` | Query | `checkAuth` → `ddb.query()` |
| `getRecentActivity` | Query | `checkAuth` → `ddb.query()` + limit |
| `getTimeTravelAvailability` | Query | `checkAuth` → `ddb.get()` |
| `getSimulationSummary` | Query | `checkAuth` → `ddb.get()` |

### advisory-bff (8 JS / 0 Lambda)

| Operation | Type | Pipeline Pattern |
|-----------|------|-----------------|
| `getDecision` | Query | `checkAuth` → `ddb.query()` |
| `getPendingDecisions` | Query | `checkAuth` → `ddb.query()` GSI + status filter |
| `getDecisionHistory` | Query | `checkAuth` → `ddb.query()` GSI |
| `getAgentInvocations` | Query | `checkAuth` → `ddb.query()` |
| `getComplianceChecks` | Query | `checkAuth` → `ddb.query()` |
| `recordExplanationView` | Mutation | `checkAuth` → `ddb.put()` |
| `confirmDecision` | Mutation | `checkAuth` → `TransactWriteItems` (2) → `ddb.get()` readBack |
| `rejectDecision` | Mutation | `checkAuth` → `TransactWriteItems` (2) → `ddb.get()` readBack |

### portfolio-bff (4 JS / 0 Lambda)

| Operation | Type | Pipeline Pattern |
|-----------|------|-----------------|
| `getPortfolio` | Query | `checkAuth` → `ddb.get()` → conditional `ddb.put()` with `runtime.earlyReturn()` |
| `getPositions` | Query | `checkAuth` → `ddb.query()` |
| `getCashBalance` | Query | `checkAuth` → `ddb.get()` + null coalesce |
| `getPerformance` | Query | `checkAuth` → NoneDataSource (stub) |

### order-ledger-bff (3 JS / 2 Lambda)

| Operation | Type | Pipeline Pattern |
|-----------|------|-----------------|
| `getLedgerPortfolio` | Query | `checkAuth` → `ddb.get()` snapshot (earlyReturn default if null) → `ddb.query()` positions |
| `getOrderHistory` | Query | `checkAuth` → `ddb.query()` + pagination |
| `getTimeTravelAvailability` | Query | `checkAuth` → `ddb.query()` earliest → `ddb.query()` latest |
| `getPortfolioAt` | Query | **Lambda** — event sourcing replay |
| `getSimulationComparison` | Query | **Lambda** — 6 parallel reads |

### investor-bff (16 JS / 0 Lambda)

| Operation | Type | Pipeline Pattern |
|-----------|------|-----------------|
| `getProfile` | Query | `checkAuth` → `ddb.get()` |
| `getGoals` | Query | `checkAuth` → `ddb.query()` |
| `getNotifications` | Query | `checkAuth` → `ddb.query()` + nextToken |
| `getUnreadCount` | Query | `checkAuth` → `ddb.query()` + filter COUNT |
| `markNotificationRead` | Mutation | `checkAuth` → `ddb.update()` + condition |
| `setGoal` | Mutation | `checkAuth` → `TransactWriteItems` (2: Goal + EditEvent) |
| `updateGoal` | Mutation | `checkAuth` → `TransactWriteItems` (2) — now atomic |
| `setRiskProfile` | Mutation | `checkAuth` → `TransactWriteItems` (2) |
| `grantMandate` | Mutation | `checkAuth` → `TransactWriteItems` (2) + inline validation |
| `updateMandate` | Mutation | `checkAuth` → `TransactWriteItems` (2) |
| `revokeMandate` | Mutation | `checkAuth` → `TransactWriteItems` (2) — now atomic |
| `selectOperatingMode` | Mutation | `checkAuth` → `TransactWriteItems` (3) |
| `initiateDeposit` | Mutation | `checkAuth` → `ddb.put()` — Egress publishes `DEPOSIT_INITIATED` |
| `requestWithdrawal` | Mutation | `checkAuth` → `TransactWriteItems` (conditional + put) — now atomic |
| `recordOnboardingAnswer` | Mutation | `checkAuth` → NoneDataSource (stub) |
| `requestAccountClosure` | Mutation | `checkAuth` → NoneDataSource (stub) |
