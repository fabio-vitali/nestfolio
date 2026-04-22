# Fund-account feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a user-facing deposit flow: a Dashboard CTA, a federated `/investor/deposit` page with a signal-state form + live status panel, and a GraphQL subscription on `investor-bff` that surfaces `DEPOSIT_DETECTED` in real time.

**Architecture:** Frontend-heavy. Backend pipeline (mutation → CDC → broker-sim → `DEPOSIT_DETECTED` → ledger) is already shipped. We add one backend pipeline: `event-listener.ts` consumes `DEPOSIT_DETECTED` and fires an IAM-signed `publishDepositEvent` mutation on AppSync, which flips the DDB row and triggers `onDepositEvent` subscribers. Frontend: a CTA on `dashboard-mfe` reactive to the existing `initiateDeposit` feature flag, and a new standalone component on `investor-mfe` that drives a six-state signal machine (`form` → `submitting` → `initiated` → `detected`/`failed`/`timeout`).

**Tech Stack:** Angular 19 standalone + signals, PrimeNG, Apollo Client (via `@nestfolio/shell/graphql`), NgRx SignalStore (existing `FeatureFlagsStore`), AWS AppSync JS resolvers (APPSYNC_JS_1_0_0 runtime), Lambda Node 20 with `@smithy/signature-v4` for IAM-signed GraphQL, Jest + jest-preset-angular, `@nestfolio/test-support` + `@nestfolio/integration-testing` for integration tests.

---

## File Structure

**New files (backend):**
- `services/investor/investor-bff/src/graphql/js-function/publish-deposit-event.fn.js` — IAM-only JS resolver.
- `services/investor/investor-bff/test/unit/graphql/publish-deposit-event.test.ts` — resolver unit tests.

**Modified files (backend):**
- `services/investor/investor-bff/src/schema.graphql` — `DepositStatus` enum, `DepositEvent` type, `DepositEventInput`, `publishDepositEvent` mutation, `onDepositEvent` subscription.
- `services/investor/investor-bff/src/handlers/event-listener.ts` — add `PUBLISH_DEPOSIT_EVENT` constant + `DEPOSIT_DETECTED` handler.
- `services/investor/investor-bff/src/service.stack.ts` — add `DEPOSIT_DETECTED` to `Ingress.eventTypes`.
- `services/investor/investor-bff/test/unit/handlers/event-listener.test.ts` — add `DEPOSIT_DETECTED` case + bump handler-count assertion.
- `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts` — add round-trip test.

**New files (frontend, investor-mfe):**
- `apps/investor-mfe/src/app/graphql/investor-bff.mutations.ts`
- `apps/investor-mfe/src/app/graphql/investor-bff.subscriptions.ts`
- `apps/investor-mfe/src/app/services/deposit.service.ts`
- `apps/investor-mfe/src/app/deposit/deposit-page.component.ts`
- `apps/investor-mfe/test/app/deposit/deposit-page.component.spec.ts`
- `apps/investor-mfe/test/app/services/deposit.service.spec.ts`

**Modified files (frontend):**
- `apps/investor-mfe/src/app/app.routes.ts` — register `/deposit` route (used only during standalone dev of investor-mfe).
- `apps/investor-mfe/src/app/remote-routes.ts` — add `deposit` path into the federated route table (authoritative, used by host).
- `apps/dashboard-mfe/src/app/dashboard/kpi-cards.component.ts` — add Deposit CTA inside the cash-balance card, reactive to `FeatureFlagsStore`.
- `apps/dashboard-mfe/test/app/dashboard/kpi-cards.component.spec.ts` — assert CTA presence + disabled-when-flag-off + click navigation.

Responsibility split: the component owns state-machine logic; the service owns Apollo wiring; the schema additions are strictly auxiliary (subscription delivery + row update). The backend event-listener handler is a thin shim between SQS and AppSync — no new Lambda, no new CDK construct.

---

### Task 1: Schema additions on investor-bff

**Files:**
- Modify: `services/investor/investor-bff/src/schema.graphql`

- [ ] **Step 1: Add the enum, type, input, mutation, and subscription**

Append to the bottom of `services/investor/investor-bff/src/schema.graphql` (file currently ends at line 177 with `WithdrawalInput`):

```graphql
# --- Deposit event (real-time confirmation pipeline) ---

enum DepositStatus {
  INITIATED
  DETECTED
  FAILED
}

type DepositEvent @aws_cognito_user_pools @aws_iam {
  depositId: ID!
  tenantId: ID!
  status: DepositStatus!
  amountCents: Int!
  currency: String!
  occurredAt: String!
  reason: String
}

input DepositEventInput {
  depositId: ID!
  tenantId: ID!
  userId: String!
  status: DepositStatus!
  amountCents: Int!
  currency: String!
  occurredAt: String!
  reason: String
}

extend type Mutation {
  publishDepositEvent(input: DepositEventInput!): DepositEvent!
    @aws_iam
}

extend type Subscription {
  onDepositEvent(depositId: ID!): DepositEvent
    @aws_subscribe(mutations: ["publishDepositEvent"])
}
```

Note: `userId` is required in the **input** (used to construct the DDB pk) but NOT exposed on the return type (not needed by subscribers, and the subscriber already owns the subject from their auth context).

- [ ] **Step 2: Commit**

```bash
git add services/investor/investor-bff/src/schema.graphql
git commit -m "feat(investor-bff): add DepositEvent schema and onDepositEvent subscription"
```

---

### Task 2: publish-deposit-event JS resolver (test first)

**Files:**
- Create: `services/investor/investor-bff/test/unit/graphql/publish-deposit-event.test.ts`
- Create: `services/investor/investor-bff/src/graphql/js-function/publish-deposit-event.fn.js`

JS resolvers in this repo use the AppSync APPSYNC_JS_1_0_0 runtime. Unit tests invoke `request`/`response` directly with a hand-crafted `ctx` object — no AppSync evaluator. See `services/investor/investor-bff/src/graphql/js-function/update-feature-flag.fn.js` for the existing shape.

- [ ] **Step 1: Write the failing resolver test**

Create `services/investor/investor-bff/test/unit/graphql/publish-deposit-event.test.ts`:

```typescript
import { request, response } from '../../../src/graphql/js-function/publish-deposit-event.fn.js';

describe('publish-deposit-event resolver', () => {
  const baseInput = {
    depositId: 'dep-123',
    tenantId: 'tenant-1',
    userId: 'user-1',
    status: 'DETECTED',
    amountCents: 500_000,
    currency: 'USD',
    occurredAt: '2026-04-22T10:00:00.000Z',
    reason: null,
  };

  it('request: builds an UpdateItem with attribute_exists(pk) condition and status + timestamp set', () => {
    const ctx = { arguments: { input: baseInput } };
    const op = request(ctx);

    expect(op.operation).toBe('UpdateItem');
    expect(op.key).toEqual({
      pk: { S: 'InvestorProfile#tenant-1#user-1' },
      sk: { S: 'Deposit#dep-123' },
    });
    expect(op.condition.expression).toContain('attribute_exists(pk)');
    expect(op.update.expression).toContain('SET');
    expect(op.update.expression).toContain('#status = :status');
    expect(op.update.expressionValues[':status']).toEqual({ S: 'DETECTED' });
    expect(op.update.expressionValues[':amountCents']).toEqual({ N: '500000' });
    expect(op.update.expressionValues[':occurredAt']).toEqual({ S: '2026-04-22T10:00:00.000Z' });
  });

  it('response: returns the DepositEvent shape', () => {
    const ctx = {
      arguments: { input: baseInput },
      result: {
        depositId: 'dep-123',
        tenantId: 'tenant-1',
        status: 'DETECTED',
        amountCents: 500_000,
        currency: 'USD',
        occurredAt: '2026-04-22T10:00:00.000Z',
        reason: null,
      },
    };
    const out = response(ctx);

    expect(out).toEqual({
      depositId: 'dep-123',
      tenantId: 'tenant-1',
      status: 'DETECTED',
      amountCents: 500_000,
      currency: 'USD',
      occurredAt: '2026-04-22T10:00:00.000Z',
      reason: null,
    });
  });

  it('response: rethrows ConditionalCheckFailedException via util.error', () => {
    const ctx = {
      arguments: { input: baseInput },
      error: { message: 'The conditional request failed', type: 'DynamoDB:ConditionalCheckFailedException' },
    };
    expect(() => response(ctx)).toThrow('The conditional request failed');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test investor-bff -- --testPathPattern='publish-deposit-event'`
Expected: FAIL — `Cannot find module '../../../src/graphql/js-function/publish-deposit-event.fn.js'`.

- [ ] **Step 3: Implement the resolver**

Create `services/investor/investor-bff/src/graphql/js-function/publish-deposit-event.fn.js`:

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const input = ctx.arguments.input;
  const { depositId, tenantId, userId, status, amountCents, currency, occurredAt, reason } = input;

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: `InvestorProfile#${tenantId}#${userId}`,
      sk: `Deposit#${depositId}`,
    }),
    condition: {
      expression: 'attribute_exists(pk)',
    },
    update: {
      expression:
        'SET #status = :status, amountCents = :amountCents, currency = :currency, occurredAt = :occurredAt, #reason = :reason',
      expressionNames: {
        '#status': 'status',
        '#reason': 'reason',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':status': status,
        ':amountCents': amountCents,
        ':currency': currency,
        ':occurredAt': occurredAt,
        ':reason': reason ?? null,
      }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return {
    depositId: ctx.result.depositId,
    tenantId: ctx.result.tenantId,
    status: ctx.result.status,
    amountCents: ctx.result.amountCents,
    currency: ctx.result.currency,
    occurredAt: ctx.result.occurredAt,
    reason: ctx.result.reason ?? null,
  };
}
```

The `@aws-appsync/utils` module is a test-time stub in this repo; to make the unit test run without the real AppSync utils, add a Jest moduleNameMapper shim. Check first: `grep -rn "@aws-appsync/utils" services/investor/investor-bff/jest.config.ts services/investor/investor-bff/test/unit/graphql/ 2>/dev/null`. If no existing mock is present, add one by creating `services/investor/investor-bff/test/unit/graphql/__mocks__/appsync-utils.ts`:

```typescript
export const util = {
  dynamodb: {
    toMapValues: (obj: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(obj).map(([k, v]) =>
        [k, typeof v === 'number' ? { N: String(v) } : v === null ? { NULL: true } : { S: String(v) }],
      )),
  },
  error: (message: string, type?: string) => { const e = new Error(message); (e as Error & { type?: string }).type = type; throw e; },
  time: { nowISO8601: () => '2026-04-22T00:00:00.000Z' },
  autoId: () => 'mock-auto-id',
};
```

and, in `services/investor/investor-bff/jest.config.ts`, add to `moduleNameMapper`:
```javascript
'^@aws-appsync/utils$': '<rootDir>/test/unit/graphql/__mocks__/appsync-utils.ts',
```

If a mock already exists, skip the shim step and delete the expressionValues expectation details that don't match the existing mock's shape.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test investor-bff -- --testPathPattern='publish-deposit-event'`
Expected: PASS — all three assertions green.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/graphql/js-function/publish-deposit-event.fn.js \
        services/investor/investor-bff/test/unit/graphql/publish-deposit-event.test.ts \
        services/investor/investor-bff/test/unit/graphql/__mocks__/appsync-utils.ts \
        services/investor/investor-bff/jest.config.ts
git commit -m "feat(investor-bff): add publish-deposit-event JS resolver"
```

(Skip files that were already present before this task touched them.)

---

### Task 3: Extend event-listener with DEPOSIT_DETECTED handler (test first)

**Files:**
- Modify: `services/investor/investor-bff/test/unit/handlers/event-listener.test.ts`
- Modify: `services/investor/investor-bff/src/handlers/event-listener.ts`

The existing pattern: handlers return `skip()` (they don't materialize via `toUow` because the write is done via AppSync IAM-signed mutation, not via the event-processor pipeline). See `BROKER_CIRCUIT_OPEN` in the same file for the shape.

- [ ] **Step 1: Extend the handler-count assertion and add a failing test**

In `services/investor/investor-bff/test/unit/handlers/event-listener.test.ts`, change line 43:
```typescript
expect(Object.keys(handlers)).toHaveLength(8);
```
to:
```typescript
expect(Object.keys(handlers)).toHaveLength(9);
```

And add the import for the new event type. Since the adapter holds the ingest event type, import from the ingest path used elsewhere in the file. Insert under line 3 (after the `LedgerCrossDomainEventTypes` import):
```typescript
import { InvestorIngestEventTypes } from '@nestfolio/investor-adpt/domain';
```

Add an expectation under line 51 (next to the other `toHaveProperty` lines):
```typescript
expect(handlers).toHaveProperty(InvestorIngestEventTypes.DEPOSIT_DETECTED);
```

Add a new describe block before the `callAppSyncMutation` describe (before line 112):

```typescript
describe('DEPOSIT_DETECTED handler', () => {
  it('fires IAM-signed publishDepositEvent mutation with DETECTED status and returns skip', async () => {
    const handlers = createHandlers();
    const payload = {
      subject: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        depositId: 'dep-42',
        amountCents: 500_000,
        currency: 'USD',
      },
      occurredAt: '2026-04-22T10:00:00.000Z',
    };
    const ctx = { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' };

    const result = await handlers[InvestorIngestEventTypes.DEPOSIT_DETECTED](payload, ctx);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body.query).toContain('publishDepositEvent');
    expect(body.variables).toEqual({
      input: {
        depositId: 'dep-42',
        tenantId: 'tenant-1',
        userId: 'user-1',
        status: 'DETECTED',
        amountCents: 500_000,
        currency: 'USD',
        occurredAt: '2026-04-22T10:00:00.000Z',
        reason: null,
      },
    });
    expect(result).toEqual({ _tag: 'skip' });
  });

  it('falls back to now() when occurredAt is missing on the event', async () => {
    const handlers = createHandlers();
    const payload = {
      subject: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        depositId: 'dep-43',
        amountCents: 100,
        currency: 'USD',
      },
    };
    const ctx = { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' };

    await handlers[InvestorIngestEventTypes.DEPOSIT_DETECTED](payload, ctx);

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body.variables.input.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test investor-bff -- --testPathPattern='event-listener'`
Expected: FAIL — `handlers has 8 keys, expected 9`; `handlers[DEPOSIT_DETECTED] is not a function`.

- [ ] **Step 3: Implement the handler**

In `services/investor/investor-bff/src/handlers/event-listener.ts`:

After line 7 (`import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';`), add:
```typescript
import { InvestorIngestEventTypes } from '@nestfolio/investor-adpt/domain';
```

After the existing `UPDATE_FEATURE_FLAG` constant (after line 71), add:
```typescript
const PUBLISH_DEPOSIT_EVENT = `
  mutation PublishDepositEvent($input: DepositEventInput!) {
    publishDepositEvent(input: $input) {
      depositId
      tenantId
      status
      amountCents
      currency
      occurredAt
      reason
    }
  }
`;
```

Inside the object returned by `createHandlers(...)`, add a new handler entry alongside `BROKER_CIRCUIT_CLOSED`:

```typescript
    [InvestorIngestEventTypes.DEPOSIT_DETECTED]: async (payload: EventPayload, _ctx: EventContext) => {
      const subject = payload.subject as {
        tenantId: string;
        userId: string;
        depositId: string;
        amountCents: number;
        currency: string;
      };
      const occurredAt = (payload as { occurredAt?: string }).occurredAt ?? new Date().toISOString();
      await callAppSyncMutation(PUBLISH_DEPOSIT_EVENT, {
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
      });
      return skip();
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx test investor-bff -- --testPathPattern='event-listener'`
Expected: PASS — the new handler tests pass, plus the pre-existing 9 tests still green.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/handlers/event-listener.ts \
        services/investor/investor-bff/test/unit/handlers/event-listener.test.ts
git commit -m "feat(investor-bff): publish DepositEvent on DEPOSIT_DETECTED"
```

---

### Task 4: Wire DEPOSIT_DETECTED into the Ingress construct

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts`

- [ ] **Step 1: Add DEPOSIT_DETECTED to Ingress.eventTypes**

In `services/investor/investor-bff/src/service.stack.ts`, line 36 (just before `InvestorIngestEventTypes.BROKER_CIRCUIT_CLOSED,`), add:

```typescript
        InvestorIngestEventTypes.DEPOSIT_DETECTED,
```

(Order is not semantic; grouping with the other ingest types near the adapter-sourced events is tidy.)

The investor-adpt adapter already forwards `DEPOSIT_DETECTED` from executionBus → investorBus (see `services/investor/investor-adpt/CLAUDE.md` → "Execution → Investor" list), so no adapter change is required.

- [ ] **Step 2: Run the CDK unit tests for investor-bff**

Run: `pnpm nx test investor-bff -- --testPathPattern='service.stack'`
Expected: PASS (or snapshot update — if there's a stack snapshot test that needs a refresh, accept the diff and recommit the snapshot file).

Run: `pnpm nx build investor-bff`
Expected: PASS — the project should compile.

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-bff/src/service.stack.ts
git commit -m "feat(investor-bff): subscribe ingress to DEPOSIT_DETECTED"
```

---

### Task 5: Integration test — DEPOSIT_DETECTED flips DDB status

**Files:**
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

The integration test emits `DEPOSIT_DETECTED` on `investorBus` via `EventBridgeClient` and asserts the DDB row's status advances from `INITIATED` to `DETECTED`. The AppSync IAM mutation is observed indirectly via the row update (the mutation's sole side-effect is the DDB flip).

- [ ] **Step 1: Add a nested describe block for deposit-event publishing**

Before the final closing `});` of the top-level `describe('investor-bff', ...)` block (before line 911), insert:

```typescript
  describe('deposit event subscription pipeline', () => {
    it('flips DepositIntent status to DETECTED when DEPOSIT_DETECTED is received', async () => {
      // Create the DepositIntent row first — the publish-deposit-event resolver has
      // attribute_exists(pk) and will fail silently (conditional) if no row exists.
      const seedResult = await appsync.mutate<{
        initiateDeposit: {
          depositId: string;
          amountCents: number;
          currency: string;
          status: string;
          initiatedAt: string;
        };
      }>(
        `
        mutation InitiateDeposit($input: DepositInput!) {
          initiateDeposit(input: $input) {
            depositId
            amountCents
            currency
            status
            initiatedAt
          }
        }
      `,
        { input: { amountCents: 250_000, currency: 'USD' } },
      );

      const depositId = seedResult.initiateDeposit.depositId;
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;
      const sk = `Deposit#${depositId}`;

      // Confirm seed row is INITIATED
      const seeded = await table.waitForItem({ table: 'investor-bff', pk, sk });
      expect(seeded['status']).toBe('INITIATED');

      // Act — emit DEPOSIT_DETECTED on investorBus (investor-adpt already routes
      // DEPOSIT_DETECTED from executionBus → investorBus; here we bypass the adapter
      // and emit directly on investorBus, which is what the ingress handler consumes).
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'DEPOSIT_DETECTED',
        detail: {
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          depositId,
          amountCents: 250_000,
          currency: 'USD',
        },
      });

      // Assert — DDB row status advances to DETECTED within 60s
      const deadline = Date.now() + 60_000;
      let updated: Record<string, unknown> | undefined;
      while (Date.now() < deadline) {
        updated = await table.waitForItem({ table: 'investor-bff', pk, sk, timeoutMs: 5_000 });
        if (updated['status'] === 'DETECTED') break;
        await new Promise((r) => setTimeout(r, 2_000));
      }

      expect(updated).toBeDefined();
      expect(updated!['status']).toBe('DETECTED');
      expect(updated!['occurredAt']).toBeDefined();
    }, 120_000);
  });
```

- [ ] **Step 2: Run the integration test locally**

Requires a deployed investor-bff stack in sandbox.

Run:
```bash
pnpm install --frozen-lockfile
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm nx test-integration investor-bff -- --testNamePattern='deposit event subscription pipeline'
```
Expected: PASS. If the handler has not been deployed yet, deploy first: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff`.

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit -m "test(investor-bff): integration test for DEPOSIT_DETECTED → DETECTED flip"
```

---

### Task 6: Apollo operation documents for the deposit feature

**Files:**
- Create: `apps/investor-mfe/src/app/graphql/investor-bff.mutations.ts`
- Create: `apps/investor-mfe/src/app/graphql/investor-bff.subscriptions.ts`

No test for plain string constants — they're consumed by the service and covered in the service spec. Investor-mfe's existing `investor-bff.queries.ts` already exports query/mutation/subscription strings consumed by `GraphqlService.query/mutate/subscribe`. The convention is backtick strings (not `gql` tags) — the service wraps with `gql()` internally.

- [ ] **Step 1: Create the mutations file**

Create `apps/investor-mfe/src/app/graphql/investor-bff.mutations.ts`:

```typescript
export const INITIATE_DEPOSIT = `
  mutation InitiateDeposit($input: DepositInput!) {
    initiateDeposit(input: $input) {
      depositId
      amountCents
      currency
      status
      initiatedAt
    }
  }
`;
```

- [ ] **Step 2: Create the subscriptions file**

Create `apps/investor-mfe/src/app/graphql/investor-bff.subscriptions.ts`:

```typescript
export const ON_DEPOSIT_EVENT = `
  subscription OnDepositEvent($depositId: ID!) {
    onDepositEvent(depositId: $depositId) {
      depositId
      tenantId
      status
      amountCents
      currency
      occurredAt
      reason
    }
  }
`;
```

- [ ] **Step 3: Commit**

```bash
git add apps/investor-mfe/src/app/graphql/investor-bff.mutations.ts \
        apps/investor-mfe/src/app/graphql/investor-bff.subscriptions.ts
git commit -m "feat(investor-mfe): add initiateDeposit + onDepositEvent operation docs"
```

---

### Task 7: DepositService (test first)

**Files:**
- Create: `apps/investor-mfe/test/app/services/deposit.service.spec.ts`
- Create: `apps/investor-mfe/src/app/services/deposit.service.ts`

Mirror `NotificationService` (same directory): thin wrapper around `GraphqlService.mutate()` + `.subscribe()`; unsubscribe helper; no in-service state.

- [ ] **Step 1: Write the failing service test**

Create `apps/investor-mfe/test/app/services/deposit.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { of, throwError, Subject } from 'rxjs';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { createMockGraphqlService } from '@nestfolio/shell/testing';
import { DepositService, type DepositIntent, type DepositEvent } from '../../../src/app/services/deposit.service';

describe('DepositService', () => {
  let graphql: ReturnType<typeof createMockGraphqlService>;
  let service: DepositService;

  beforeEach(() => {
    graphql = createMockGraphqlService();
    TestBed.configureTestingModule({
      providers: [
        DepositService,
        { provide: GraphqlService, useValue: graphql },
      ],
    });
    service = TestBed.inject(DepositService);
  });

  it('initiateDeposit: calls the InitiateDeposit mutation with amountCents + currency and returns the intent', async () => {
    const intent: DepositIntent = {
      depositId: 'dep-1',
      amountCents: 10_000,
      currency: 'USD',
      status: 'INITIATED',
      initiatedAt: '2026-04-22T00:00:00.000Z',
    };
    graphql.mutate.mockResolvedValue({ initiateDeposit: intent });

    const out = await service.initiateDeposit({ amountCents: 10_000, currency: 'USD' });

    expect(graphql.mutate).toHaveBeenCalledWith(
      expect.stringContaining('initiateDeposit'),
      { input: { amountCents: 10_000, currency: 'USD' } },
    );
    expect(out).toEqual(intent);
  });

  it('initiateDeposit: propagates mutation errors (e.g. feature-flag disabled)', async () => {
    graphql.mutate.mockRejectedValue(new Error('This action is temporarily paused'));
    await expect(service.initiateDeposit({ amountCents: 1_000, currency: 'USD' }))
      .rejects.toThrow('This action is temporarily paused');
  });

  it('subscribeToDepositEvent: forwards subscription payloads to the callback', () => {
    const subject = new Subject<{ onDepositEvent: DepositEvent }>();
    graphql.subscribe.mockReturnValue(subject.asObservable());

    const received: DepositEvent[] = [];
    service.subscribeToDepositEvent('dep-1', (e) => received.push(e));

    expect(graphql.subscribe).toHaveBeenCalledWith(
      expect.stringContaining('onDepositEvent'),
      { depositId: 'dep-1' },
    );

    const payload: DepositEvent = {
      depositId: 'dep-1',
      tenantId: 't-1',
      status: 'DETECTED',
      amountCents: 10_000,
      currency: 'USD',
      occurredAt: '2026-04-22T00:00:00.000Z',
      reason: null,
    };
    subject.next({ onDepositEvent: payload });
    expect(received).toEqual([payload]);
  });

  it('unsubscribeFromDepositEvent: unsubscribes and ignores further payloads', () => {
    const subject = new Subject<{ onDepositEvent: DepositEvent }>();
    graphql.subscribe.mockReturnValue(subject.asObservable());

    const received: DepositEvent[] = [];
    service.subscribeToDepositEvent('dep-1', (e) => received.push(e));
    service.unsubscribeFromDepositEvent();

    subject.next({
      onDepositEvent: {
        depositId: 'dep-1', tenantId: 't-1', status: 'DETECTED',
        amountCents: 1, currency: 'USD', occurredAt: '', reason: null,
      },
    });
    expect(received).toEqual([]);
  });

  it('subscribeToDepositEvent: on subscription error, still records error via console but does not throw', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    graphql.subscribe.mockReturnValue(throwError(() => new Error('WS closed')));

    expect(() => service.subscribeToDepositEvent('dep-1', () => undefined)).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test investor-mfe -- --testPathPattern='deposit.service'`
Expected: FAIL — `Cannot find module '../../../src/app/services/deposit.service'`.

- [ ] **Step 3: Implement the service**

Create `apps/investor-mfe/src/app/services/deposit.service.ts`:

```typescript
import { Injectable, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { INITIATE_DEPOSIT } from '../graphql/investor-bff.mutations';
import { ON_DEPOSIT_EVENT } from '../graphql/investor-bff.subscriptions';

export interface DepositIntent {
  depositId: string;
  amountCents: number;
  currency: string;
  status: string;
  initiatedAt: string;
}

export interface DepositEvent {
  depositId: string;
  tenantId: string;
  status: 'INITIATED' | 'DETECTED' | 'FAILED';
  amountCents: number;
  currency: string;
  occurredAt: string;
  reason: string | null;
}

export interface DepositInput {
  amountCents: number;
  currency: string;
}

@Injectable()
export class DepositService {
  private readonly graphql = inject(GraphqlService);
  private subscription: Subscription | null = null;

  async initiateDeposit(input: DepositInput): Promise<DepositIntent> {
    const data = await this.graphql.mutate<{ initiateDeposit: DepositIntent }>(
      INITIATE_DEPOSIT,
      { input },
    );
    return data.initiateDeposit;
  }

  subscribeToDepositEvent(depositId: string, onEvent: (e: DepositEvent) => void): void {
    this.unsubscribeFromDepositEvent();
    const obs = this.graphql.subscribe<{ onDepositEvent: DepositEvent }>(
      ON_DEPOSIT_EVENT,
      { depositId },
    );
    this.subscription = obs.subscribe({
      next: (data) => {
        if (data.onDepositEvent) onEvent(data.onDepositEvent);
      },
      error: (err) => {
        // eslint-disable-next-line no-console
        console.error('Deposit subscription error', err);
      },
    });
  }

  unsubscribeFromDepositEvent(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx test investor-mfe -- --testPathPattern='deposit.service'`
Expected: PASS — all five assertions green.

- [ ] **Step 5: Commit**

```bash
git add apps/investor-mfe/src/app/services/deposit.service.ts \
        apps/investor-mfe/test/app/services/deposit.service.spec.ts
git commit -m "feat(investor-mfe): add DepositService wrapping Apollo mutation + subscription"
```

---

### Task 8: DepositPageComponent — signal state machine (test first)

**Files:**
- Create: `apps/investor-mfe/test/app/deposit/deposit-page.component.spec.ts`
- Create: `apps/investor-mfe/src/app/deposit/deposit-page.component.ts`

The component owns the six-state machine: `form` → `submitting` → `initiated` → `detected`/`failed`/`timeout`. The timeout is a 30s-armed `setTimeout` that only fires while in `initiated`.

- [ ] **Step 1: Write the component test**

Create `apps/investor-mfe/test/app/deposit/deposit-page.component.spec.ts`:

```typescript
import { ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { DepositPageComponent } from '../../../src/app/deposit/deposit-page.component';
import { DepositService, type DepositIntent, type DepositEvent } from '../../../src/app/services/deposit.service';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
import { I18nService } from '@nestfolio/shell/i18n';
import { setupComponentTest, createMockI18nService, createMockRouter } from '@nestfolio/shell/testing';

describe('DepositPageComponent', () => {
  let component: DepositPageComponent;
  let fixture: ComponentFixture<DepositPageComponent>;
  let deposit: jest.Mocked<Pick<DepositService, 'initiateDeposit' | 'subscribeToDepositEvent' | 'unsubscribeFromDepositEvent'>>;
  let router: ReturnType<typeof createMockRouter>;
  let flagsStore: { isEnabled: jest.Mock; flags: jest.Mock };

  const intent: DepositIntent = {
    depositId: 'dep-1',
    amountCents: 10_000,
    currency: 'USD',
    status: 'INITIATED',
    initiatedAt: '2026-04-22T00:00:00.000Z',
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    deposit = {
      initiateDeposit: jest.fn().mockResolvedValue(intent),
      subscribeToDepositEvent: jest.fn(),
      unsubscribeFromDepositEvent: jest.fn(),
    };
    router = createMockRouter();
    flagsStore = {
      isEnabled: jest.fn().mockReturnValue(true),
      flags: jest.fn().mockReturnValue({}),
    };
    fixture = await setupComponentTest(DepositPageComponent, {
      providers: [
        { provide: DepositService, useValue: deposit },
        { provide: Router, useValue: router },
        { provide: FeatureFlagsStore, useValue: flagsStore },
        { provide: I18nService, useValue: createMockI18nService() },
      ],
    });
    component = fixture.componentInstance;
  });

  afterEach(() => { jest.useRealTimers(); });

  it('initializes in the form state', () => {
    expect(component.state()).toBe('form');
  });

  it('confirm is disabled when amount is empty, zero, or negative', () => {
    component.amount.set(null);
    expect(component.confirmDisabled()).toBe(true);
    component.amount.set(0);
    expect(component.confirmDisabled()).toBe(true);
    component.amount.set(-5);
    expect(component.confirmDisabled()).toBe(true);
    component.amount.set(100);
    expect(component.confirmDisabled()).toBe(false);
  });

  it('confirm is disabled when the initiateDeposit feature flag is off', () => {
    flagsStore.isEnabled.mockImplementation((name: string) => name !== 'initiateDeposit');
    component.amount.set(100);
    expect(component.confirmDisabled()).toBe(true);
  });

  it('submit: transitions form → submitting → initiated and opens the subscription', async () => {
    component.amount.set(100);
    const submitPromise = component.submit();
    expect(component.state()).toBe('submitting');
    await submitPromise;

    expect(deposit.initiateDeposit).toHaveBeenCalledWith({ amountCents: 10_000, currency: 'USD' });
    expect(component.state()).toBe('initiated');
    expect(component.depositIntent()).toEqual(intent);
    expect(deposit.subscribeToDepositEvent).toHaveBeenCalledWith('dep-1', expect.any(Function));
  });

  it('subscription DETECTED payload: transitions initiated → detected and sets depositEvent', async () => {
    component.amount.set(100);
    await component.submit();
    const onEvent = deposit.subscribeToDepositEvent.mock.calls[0][1];

    const detectedEvent: DepositEvent = {
      depositId: 'dep-1', tenantId: 't-1', status: 'DETECTED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:01:00.000Z', reason: null,
    };
    onEvent(detectedEvent);

    expect(component.state()).toBe('detected');
    expect(component.depositEvent()).toEqual(detectedEvent);
  });

  it('subscription FAILED payload: transitions initiated → failed with reason', async () => {
    component.amount.set(100);
    await component.submit();
    const onEvent = deposit.subscribeToDepositEvent.mock.calls[0][1];

    onEvent({
      depositId: 'dep-1', tenantId: 't-1', status: 'FAILED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:01:00.000Z', reason: 'Broker unavailable',
    });

    expect(component.state()).toBe('failed');
    expect(component.failureReason()).toBe('Broker unavailable');
  });

  it('30s without subscription update transitions initiated → timeout (subscription stays open)', async () => {
    component.amount.set(100);
    await component.submit();
    jest.advanceTimersByTime(30_000);

    expect(component.state()).toBe('timeout');
    expect(deposit.unsubscribeFromDepositEvent).not.toHaveBeenCalled();
  });

  it('late DETECTED after timeout still transitions to detected', async () => {
    component.amount.set(100);
    await component.submit();
    jest.advanceTimersByTime(30_000);
    expect(component.state()).toBe('timeout');

    const onEvent = deposit.subscribeToDepositEvent.mock.calls[0][1];
    onEvent({
      depositId: 'dep-1', tenantId: 't-1', status: 'DETECTED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:02:00.000Z', reason: null,
    });
    expect(component.state()).toBe('detected');
  });

  it('submit failure (feature-flag disabled from server): transitions submitting → failed', async () => {
    deposit.initiateDeposit.mockRejectedValueOnce(new Error('This action is temporarily paused'));
    component.amount.set(100);
    await component.submit();

    expect(component.state()).toBe('failed');
    expect(component.failureReason()).toBe('This action is temporarily paused');
  });

  it('cancel: navigates to /dashboard', () => {
    component.cancel();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('tryAgain from failed: resets to form, clears the previous intent', async () => {
    deposit.initiateDeposit.mockRejectedValueOnce(new Error('Oops'));
    component.amount.set(100);
    await component.submit();
    expect(component.state()).toBe('failed');

    component.tryAgain();
    expect(component.state()).toBe('form');
    expect(component.depositIntent()).toBeNull();
    expect(component.failureReason()).toBeNull();
  });

  it('viewDashboard: navigates back to /dashboard from detected state', async () => {
    component.amount.set(100);
    await component.submit();
    const onEvent = deposit.subscribeToDepositEvent.mock.calls[0][1];
    onEvent({
      depositId: 'dep-1', tenantId: 't-1', status: 'DETECTED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '', reason: null,
    });

    component.viewDashboard();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('ngOnDestroy unsubscribes from the deposit event stream', () => {
    component.ngOnDestroy();
    expect(deposit.unsubscribeFromDepositEvent).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test investor-mfe -- --testPathPattern='deposit-page'`
Expected: FAIL — `Cannot find module '../../../src/app/deposit/deposit-page.component'`.

- [ ] **Step 3: Implement the component**

Create `apps/investor-mfe/src/app/deposit/deposit-page.component.ts`:

```typescript
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { I18nService } from '@nestfolio/shell/i18n';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
import {
  DepositService,
  type DepositEvent,
  type DepositIntent,
} from '../services/deposit.service';

export type DepositPageState =
  | 'form'
  | 'submitting'
  | 'initiated'
  | 'detected'
  | 'failed'
  | 'timeout';

const TIMEOUT_MS = 30_000;
const FEATURE_FLAG = 'initiateDeposit';

@Component({
  selector: 'app-deposit-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    InputNumberModule,
    MessageModule,
    TagModule,
  ],
  template: `
    <div class="deposit-page">
      <h1 class="page-title">Fund account</h1>

      @if (state() === 'form' || state() === 'submitting') {
        <p-card data-testid="deposit-form">
          @if (!flagEnabled()) {
            <p-message severity="warn"
              [text]="flagReason() || 'Deposits paused — the brokerage circuit is open.'"
              styleClass="w-full" />
          }
          <div class="field">
            <label for="amount">Amount</label>
            <p-inputNumber
              inputId="amount"
              data-testid="deposit-amount"
              [ngModel]="amount()"
              (ngModelChange)="amount.set($event)"
              mode="currency"
              currency="USD"
              locale="en-US"
              [min]="1"
              [max]="10000000"
              [disabled]="state() === 'submitting'" />
          </div>
          <div class="field">
            <label>Currency</label>
            <span data-testid="deposit-currency">USD</span>
          </div>
          <div class="actions">
            <p-button
              label="Cancel"
              severity="secondary"
              [outlined]="true"
              data-testid="deposit-cancel"
              [disabled]="state() === 'submitting'"
              (onClick)="cancel()" />
            <p-button
              label="Confirm"
              data-testid="deposit-confirm"
              [disabled]="confirmDisabled()"
              [loading]="state() === 'submitting'"
              (onClick)="submit()" />
          </div>
          @if (state() === 'submitting') {
            <div data-testid="deposit-submitting" class="spinner">Submitting…</div>
          }
        </p-card>
      }

      @if (state() === 'initiated') {
        <p-card data-testid="deposit-panel-initiated">
          <p-tag severity="info" value="INITIATED" />
          <p>Deposit ID: <code>{{ depositIntent()?.depositId }}</code></p>
          <p>Amount: {{ (depositIntent()?.amountCents ?? 0) / 100 | currency:'USD' }}</p>
          <p>We'll update this page the moment your deposit is confirmed.</p>
        </p-card>
      }

      @if (state() === 'timeout') {
        <p-card data-testid="deposit-panel-timeout">
          <p-tag severity="info" value="INITIATED" />
          <p-message severity="warn" text="Still processing… this can take up to a minute."
            styleClass="w-full" />
          <p>Deposit ID: <code>{{ depositIntent()?.depositId }}</code></p>
        </p-card>
      }

      @if (state() === 'detected') {
        <p-card data-testid="deposit-panel-detected">
          <p-tag severity="success" value="DETECTED" />
          <p>Deposit ID: <code>{{ depositIntent()?.depositId }}</code></p>
          <p>Amount: {{ (depositEvent()?.amountCents ?? 0) / 100 | currency:'USD' }}</p>
          <p>Confirmed at: {{ depositEvent()?.occurredAt }}</p>
          <p-button
            label="View on dashboard"
            data-testid="deposit-back"
            (onClick)="viewDashboard()" />
        </p-card>
      }

      @if (state() === 'failed') {
        <p-card data-testid="deposit-panel-failed">
          <p-tag severity="danger" value="FAILED" />
          <p-message severity="error" [text]="failureReason() ?? 'Deposit failed'"
            styleClass="w-full" />
          <p-button label="Try again" (onClick)="tryAgain()" />
        </p-card>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .deposit-page { max-width: 28rem; margin: 2rem auto; padding: 0 1rem; }
    .page-title { margin: 0 0 1rem; font-size: 1.25rem; font-weight: 700; }
    .field { margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.25rem; }
    .field label { font-size: 0.75rem; color: var(--nf-text-secondary, #6c757d);
      text-transform: uppercase; letter-spacing: 0.04em; }
    .actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
    .spinner { margin-top: 0.5rem; color: var(--nf-text-secondary, #6c757d); }
    .w-full { width: 100%; }
  `],
})
export class DepositPageComponent implements OnDestroy {
  readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly deposit = inject(DepositService);
  private readonly flagsStore = inject(FeatureFlagsStore);

  readonly state = signal<DepositPageState>('form');
  readonly amount = signal<number | null>(null);
  readonly depositIntent = signal<DepositIntent | null>(null);
  readonly depositEvent = signal<DepositEvent | null>(null);
  readonly failureReason = signal<string | null>(null);

  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  readonly flagEnabled = computed(() => this.flagsStore.isEnabled(FEATURE_FLAG));
  readonly flagReason = computed(() => this.flagsStore.flags()[FEATURE_FLAG]?.reason ?? null);

  readonly confirmDisabled = computed(() => {
    const a = this.amount();
    if (a == null || a <= 0) return true;
    if (!this.flagEnabled()) return true;
    return this.state() === 'submitting';
  });

  async submit(): Promise<void> {
    if (this.confirmDisabled()) return;
    this.state.set('submitting');
    this.failureReason.set(null);
    try {
      const intent = await this.deposit.initiateDeposit({
        amountCents: Math.round((this.amount() ?? 0) * 100),
        currency: 'USD',
      });
      this.depositIntent.set(intent);
      this.state.set('initiated');
      this.armTimeout();
      this.deposit.subscribeToDepositEvent(intent.depositId, (event) => this.onEvent(event));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Deposit failed';
      this.failureReason.set(message);
      this.state.set('failed');
    }
  }

  private onEvent(event: DepositEvent): void {
    this.depositEvent.set(event);
    this.clearTimeout();
    if (event.status === 'DETECTED') {
      this.state.set('detected');
    } else if (event.status === 'FAILED') {
      this.failureReason.set(event.reason ?? 'Deposit failed');
      this.state.set('failed');
    }
  }

  private armTimeout(): void {
    this.clearTimeout();
    this.timeoutHandle = setTimeout(() => {
      if (this.state() === 'initiated') this.state.set('timeout');
    }, TIMEOUT_MS);
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  cancel(): void {
    this.router.navigate(['/dashboard']);
  }

  tryAgain(): void {
    this.clearTimeout();
    this.deposit.unsubscribeFromDepositEvent();
    this.depositIntent.set(null);
    this.depositEvent.set(null);
    this.failureReason.set(null);
    this.state.set('form');
  }

  viewDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  ngOnDestroy(): void {
    this.clearTimeout();
    this.deposit.unsubscribeFromDepositEvent();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test investor-mfe -- --testPathPattern='deposit-page'`
Expected: PASS — all state-machine assertions green.

- [ ] **Step 5: Commit**

```bash
git add apps/investor-mfe/src/app/deposit/deposit-page.component.ts \
        apps/investor-mfe/test/app/deposit/deposit-page.component.spec.ts
git commit -m "feat(investor-mfe): add DepositPageComponent with signal state machine"
```

---

### Task 9: Wire the `/deposit` route into investor-mfe

**Files:**
- Modify: `apps/investor-mfe/src/app/app.routes.ts`
- Modify: `apps/investor-mfe/src/app/remote-routes.ts`

Host uses the MFE's `remote-routes.ts` (via Native Federation) — that's the authoritative table. `app.routes.ts` is only used during standalone dev of investor-mfe.

- [ ] **Step 1: Update investor-mfe app.routes.ts**

Replace the contents of `apps/investor-mfe/src/app/app.routes.ts` with:

```typescript
import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: 'deposit',
    loadComponent: () =>
      import('./deposit/deposit-page.component').then((m) => m.DepositPageComponent),
  },
];
```

- [ ] **Step 2: Update investor-mfe remote-routes.ts**

Modify `apps/investor-mfe/src/app/remote-routes.ts` to add the deposit entry inside the existing children array. The existing file is:

```typescript
import { Routes } from '@angular/router';
import { NotificationService } from './services/notification.service';
import { NotificationStore } from './stores/notification.store';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [NotificationService, NotificationStore],
    children: [
      {
        path: 'notifications',
        loadComponent: () =>
          import('./notifications/notification-list.component').then(
            (m) => m.NotificationListComponent,
          ),
      },
      {
        path: 'settings/go-live',
        loadComponent: () =>
          import('./settings/go-live/go-live-wizard.component').then(
            (m) => m.GoLiveWizardComponent,
          ),
      },
      { path: '', redirectTo: 'notifications', pathMatch: 'full' },
    ],
  },
];
```

Replace it with:

```typescript
import { Routes } from '@angular/router';
import { NotificationService } from './services/notification.service';
import { NotificationStore } from './stores/notification.store';
import { DepositService } from './services/deposit.service';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [NotificationService, NotificationStore, DepositService],
    children: [
      {
        path: 'notifications',
        loadComponent: () =>
          import('./notifications/notification-list.component').then(
            (m) => m.NotificationListComponent,
          ),
      },
      {
        path: 'settings/go-live',
        loadComponent: () =>
          import('./settings/go-live/go-live-wizard.component').then(
            (m) => m.GoLiveWizardComponent,
          ),
      },
      {
        path: 'deposit',
        loadComponent: () =>
          import('./deposit/deposit-page.component').then(
            (m) => m.DepositPageComponent,
          ),
      },
      { path: '', redirectTo: 'notifications', pathMatch: 'full' },
    ],
  },
];
```

The host's `app.routes.ts` already federates `/investor/**` to investor-mfe's `./routes`, so `/investor/deposit` will resolve without any host change. Confirm this by grep:

```bash
grep -n "investor" apps/nestfolio-host/src/app/app.routes.ts
```
Expected: a route entry with `path: 'investor'` and `loadChildren: loadMfe('investor-mfe', './routes')`. If confirmed, no host change is needed.

- [ ] **Step 3: Build investor-mfe to verify the route compiles**

Run: `pnpm nx build investor-mfe`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/investor-mfe/src/app/app.routes.ts \
        apps/investor-mfe/src/app/remote-routes.ts
git commit -m "feat(investor-mfe): register /deposit route in remote federation table"
```

---

### Task 10: Dashboard CTA — test first

**Files:**
- Modify: `apps/dashboard-mfe/test/app/dashboard/kpi-cards.component.spec.ts`
- Modify: `apps/dashboard-mfe/src/app/dashboard/kpi-cards.component.ts`

- [ ] **Step 1: Update the KPI cards component test**

Replace the contents of `apps/dashboard-mfe/test/app/dashboard/kpi-cards.component.spec.ts` with:

```typescript
import { ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { KpiCardsComponent } from '../../../src/app/dashboard/kpi-cards.component';
import { I18nService } from '@nestfolio/shell/i18n';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
import { setupComponentTest, createMockI18nService, createMockRouter } from '@nestfolio/shell/testing';

describe('KpiCardsComponent', () => {
  let component: KpiCardsComponent;
  let fixture: ComponentFixture<KpiCardsComponent>;
  let router: ReturnType<typeof createMockRouter>;
  let flagsStore: { isEnabled: jest.Mock; flags: jest.Mock };

  beforeEach(async () => {
    router = createMockRouter();
    flagsStore = {
      isEnabled: jest.fn().mockReturnValue(true),
      flags: jest.fn().mockReturnValue({}),
    };
    fixture = await setupComponentTest(KpiCardsComponent, {
      providers: [
        { provide: I18nService, useValue: createMockI18nService() },
        { provide: Router, useValue: router },
        { provide: FeatureFlagsStore, useValue: flagsStore },
      ],
    });
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have null defaults', () => {
    expect(component.portfolioSummary).toBeNull();
    expect(component.totalPnl).toBe(0);
    expect(component.advisoryStatus).toBeNull();
  });

  it('should accept portfolio summary input', () => {
    component.portfolioSummary = {
      totalValueCents: 500000,
      cashBalanceCents: 100000,
      positionCount: 3,
      driftPercent: 1.5,
      updatedAt: '2026-03-01T00:00:00Z',
    };
    expect(component.portfolioSummary.totalValueCents).toBe(500000);
  });

  it('depositDisabled is false when the initiateDeposit flag is enabled', () => {
    flagsStore.isEnabled.mockReturnValue(true);
    expect(component.depositDisabled()).toBe(false);
  });

  it('depositDisabled is true when the initiateDeposit flag is disabled', () => {
    flagsStore.isEnabled.mockImplementation((name: string) => name !== 'initiateDeposit');
    expect(component.depositDisabled()).toBe(true);
  });

  it('goDeposit navigates to /investor/deposit', () => {
    component.goDeposit();
    expect(router.navigate).toHaveBeenCalledWith(['/investor/deposit']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test dashboard-mfe -- --testPathPattern='kpi-cards'`
Expected: FAIL — `component.depositDisabled is not a function`; `component.goDeposit is not a function`.

- [ ] **Step 3: Implement the CTA on the KPI card**

Modify `apps/dashboard-mfe/src/app/dashboard/kpi-cards.component.ts`. Replace the existing file with:

```typescript
import { Component, Input, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TooltipModule } from 'primeng/tooltip';
import { I18nService } from '@nestfolio/shell/i18n';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
import { CurrencyFormatPipe, PercentFormatPipe } from '@nestfolio/ui';
import type { PortfolioSummary, AdvisoryStatus } from '../stores/dashboard.store';

const DEPOSIT_FLAG = 'initiateDeposit';

@Component({
  selector: 'app-kpi-cards',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule, TooltipModule, CurrencyFormatPipe, PercentFormatPipe],
  template: `
    <div class="kpi-cards">
      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.totalValue') }}</div>
        <div class="kpi-value" [attr.aria-label]="i18n.t('dashboard.overview.totalValue') + ': ' + ((portfolioSummary?.totalValueCents ?? 0) | currencyFormat)">{{ (portfolioSummary?.totalValueCents ?? 0) | currencyFormat }}</div>
      </p-card>

      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.cashBalance') }}</div>
        <div class="kpi-value" [attr.aria-label]="i18n.t('dashboard.overview.cashBalance') + ': ' + ((portfolioSummary?.cashBalanceCents ?? 0) | currencyFormat)">{{ (portfolioSummary?.cashBalanceCents ?? 0) | currencyFormat }}</div>
        <p-button
          label="Deposit"
          size="small"
          [outlined]="true"
          data-testid="cta-deposit"
          [disabled]="depositDisabled()"
          [pTooltip]="depositDisabled() ? (depositReason() || 'Deposits paused — the brokerage circuit is open.') : null"
          (onClick)="goDeposit()" />
      </p-card>

      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.unrealizedPnl') }}</div>
        <div class="kpi-value" [class.positive]="totalPnl > 0" [class.negative]="totalPnl < 0" [attr.aria-label]="i18n.t('dashboard.overview.unrealizedPnl') + ': ' + (totalPnl | currencyFormat)">
          {{ totalPnl | currencyFormat }}
        </div>
      </p-card>

      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.drift') }}</div>
        <div class="kpi-value" [attr.aria-label]="i18n.t('dashboard.overview.drift') + ': ' + ((portfolioSummary?.driftPercent ?? 0) | percentFormat)">{{ (portfolioSummary?.driftPercent ?? 0) | percentFormat }}</div>
      </p-card>

      <p-card styleClass="kpi-card">
        <div class="kpi-label">{{ i18n.t('dashboard.overview.pendingDecisions') }}</div>
        <div class="kpi-value" [class.alert]="(advisoryStatus?.pendingDecisionsCount ?? 0) > 0" [attr.aria-label]="i18n.t('dashboard.overview.pendingDecisions') + ': ' + (advisoryStatus?.pendingDecisionsCount ?? 0)">
          {{ advisoryStatus?.pendingDecisionsCount ?? 0 }}
        </div>
      </p-card>
    </div>
  `,
  styles: [`
    .kpi-cards {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 0.75rem;
    }

    :host ::ng-deep .kpi-card { text-align: center; }
    :host ::ng-deep .kpi-card .p-card-body { padding: 0.75rem; }

    .kpi-label {
      font-size: 0.75rem;
      color: var(--nf-text-secondary, #6c757d);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }

    .kpi-value {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--nf-text-primary, #212529);
    }

    .kpi-value.positive { color: var(--green-500, #22c55e); }
    .kpi-value.negative { color: var(--red-500, #ef4444); }
    .kpi-value.alert { color: var(--orange-500, #f97316); }

    @media (max-width: 768px) {
      .kpi-cards { grid-template-columns: repeat(2, 1fr); }
    }
  `],
})
export class KpiCardsComponent {
  readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly flagsStore = inject(FeatureFlagsStore);

  @Input() portfolioSummary: PortfolioSummary | null = null;
  @Input() totalPnl = 0;
  @Input() advisoryStatus: AdvisoryStatus | null = null;

  readonly depositDisabled = computed(() => !this.flagsStore.isEnabled(DEPOSIT_FLAG));
  readonly depositReason = computed(() => this.flagsStore.flags()[DEPOSIT_FLAG]?.reason ?? null);

  goDeposit(): void {
    this.router.navigate(['/investor/deposit']);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test dashboard-mfe -- --testPathPattern='kpi-cards'`
Expected: PASS — all six assertions green.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/src/app/dashboard/kpi-cards.component.ts \
        apps/dashboard-mfe/test/app/dashboard/kpi-cards.component.spec.ts
git commit -m "feat(dashboard-mfe): add Deposit CTA on cash-balance KPI"
```

---

### Task 11: Full verification sweep

Ensure nothing regressed across affected projects.

- [ ] **Step 1: Run affected unit tests**

Run: `pnpm nx run-many -t test -p investor-bff,investor-mfe,dashboard-mfe`
Expected: PASS — all test suites green.

- [ ] **Step 2: Run affected builds**

Run: `pnpm nx run-many -t build -p investor-bff,investor-mfe,dashboard-mfe,nestfolio-host`
Expected: PASS — all builds succeed.

- [ ] **Step 3: Lint**

Run: `pnpm nx run-many -t lint -p investor-bff,investor-mfe,dashboard-mfe`
Expected: PASS.

- [ ] **Step 4: Deploy to sandbox and run the integration test**

Run:
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff
```
Expected: deploy completes without errors. The schema change + new JS resolver + new ingress subscription are all picked up.

Then:
```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm nx test-integration investor-bff
```
Expected: all existing investor-bff integration tests + the new deposit-event test PASS.

- [ ] **Step 5: Smoke-check the UI in the running host**

Start the host: `pnpm nx serve nestfolio-host` (plus the MFEs per the usual dev flow). In a browser, as an onboarded user:
1. Navigate to `/dashboard` → `[data-testid="cta-deposit"]` is visible and enabled.
2. Click it → URL becomes `/investor/deposit` → `[data-testid="deposit-form"]` renders.
3. Enter `10.00` in the amount field → click Confirm.
4. `[data-testid="deposit-panel-initiated"]` appears within ~1s.
5. Within ~2–8s, `[data-testid="deposit-panel-detected"]` replaces it (broker-sim is fast in sandbox).
6. Click "View on dashboard" → URL returns to `/dashboard`; activity feed shows the deposit.

If step 5 times out beyond 30s, verify (a) the event-listener Lambda has been redeployed, (b) `DEPOSIT_DETECTED` is listed in the subscription on the adapter — `grep -n DEPOSIT_DETECTED services/investor/investor-adpt/src/service.stack.ts`.

- [ ] **Step 6: Commit anything lingering**

```bash
git status
```
Expected: clean, or only snapshot/lockfile bumps. Commit if present:
```bash
git add -p
git commit -m "chore: post-deposit-feature cleanup"
```

---

## Acceptance mapping

Spec checklist item → task it satisfies:

- `kpi-cards.component.ts` renders a `cta-deposit` button, disabled when flag off → **Task 10**.
- `/investor/deposit` renders via investor-mfe's remote-routes table → **Task 9**.
- Form submits via `InitiateDeposit` mutation and transitions deterministically → **Tasks 7, 8**.
- Subscription `onDepositEvent` delivers DETECTED payload to client → **Tasks 1, 2, 3, 7**.
- Existing DepositIntent row updated (no orphans) → **Task 2** (`attribute_exists(pk)` condition).
- Feature-flag-disabled state (CTA disabled, form banner, mutation error → failed) → **Tasks 7, 8, 10**.
- 30s client-side timeout shows "Still processing…" without closing subscription → **Task 8**.
- Unit tests pass for component, KPI card, event-listener extension → **Tasks 3, 8, 10**.
- Integration test asserts DEPOSIT_DETECTED → DDB status flip + mutation call → **Task 5**.
- Playwright journey step 7 exercises full flow and is green — **out of scope** for this plan (parent Playwright spec owns it); this plan only supplies the `data-testid` anchors it consumes.

## Open-question resolutions

Plan-level decisions called out as open in the spec:

- **DepositIntent idempotency**: resolved in Task 2 via `attribute_exists(pk)` on the row. If `DEPOSIT_DETECTED` is re-delivered, the UpdateItem is idempotent (overwrites to the same `DETECTED` state). A strict INITIATED→DETECTED monotonic transition would require a second condition (`status = :expected`), which was deliberately omitted since re-delivery into a `DETECTED` state is safe and observable.
- **Host route resolution for `/investor/deposit`**: confirmed in Task 9 Step 2 — host already federates `/investor/**` to investor-mfe's `./routes`, so adding the child path in `remote-routes.ts` is sufficient.
- **Currency pipe locale**: hardcoded to `en-US` in Task 8's `<p-inputNumber>` and `currency:'USD'` pipe. Follow-up work can respect `InvestorProfile.locale`.
- **Amount ceiling**: `AMOUNT_MAX = 10_000_000` (i.e. $10M) in Task 8. Changeable in one constant.
- **Subscription reconnection vs. timeout**: Apollo's WebSocket link reconnects silently; the 30s timer is not reset on reconnect. The `timeout` state is informational (subscription stays open), so a late DETECTED still transitions to `detected` (asserted in Task 8's "late DETECTED after timeout" test).
- **FAILED emission path**: out of scope; `FAILED` status is defined in the schema and handled by the client UI for a future broker-rejection event. The state machine in Task 8 handles a hypothetical `{ status: 'FAILED' }` payload (asserted in test), so when the event is introduced later, no frontend change is needed.
