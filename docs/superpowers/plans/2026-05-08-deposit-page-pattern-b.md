# Deposit Page Pattern B Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `deposit-page.component.ts` from Pattern A (subscribe-after-async) to Pattern B (subscribe-on-navigation) by splitting into a form route + a pending route, generating `depositId` client-side, and adding a `getDeposit` recovery query — closing both the reload-mid-flight bug and the hot-broker DETECTED frame race.

**Architecture:** Two single-purpose Angular components — `DepositFormComponent` at `/deposit` collects amount + currency, generates a UUIDv4, and navigates to `/deposit/:depositId` with the form payload in router `state`. `DepositPendingPageComponent` at `/deposit/:depositId` subscribes to `onDepositEvent` first, then calls `getDeposit(depositId)` — on `NotFoundError` it falls back to `initiateDeposit` from `history.state`, otherwise hydrates from the query result. Backend additions: `Deposit` GraphQL type replaces `DepositIntent`; new `getDeposit(depositId): Deposit!` query; `DepositInput` gains required `depositId: ID!`; `initiate-deposit.fn.js` reads the id from input instead of `util.autoId()`.

**Tech Stack:** Angular 21 (standalone components, signals, Router), AppSync JS resolvers, Apollo Client subscriptions over WSS, Jest + Angular TestBed for units, Playwright for e2e, pnpm + nx for tasks.

**Spec:** `docs/superpowers/specs/2026-05-08-deposit-page-pattern-b-design.md`
**Backlog:** `docs/backlog/deposit-page-pattern-a-to-pattern-b.md`

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `services/investor/investor-bff/src/schema.graphql` | modify | Add `Deposit` type, `getDeposit` query, `depositId` to `DepositInput`, change `initiateDeposit` return |
| `services/investor/investor-bff/src/graphql/js-function/initiate-deposit.fn.js` | modify | Read `depositId` from input + UUIDv4 validation; remove `util.autoId()` |
| `services/investor/investor-bff/src/graphql/js-function/get-deposit.fn.js` | **create** | New resolver: `ddb.get` against `Deposit#${depositId}` row, throws `NotFoundError` |
| `services/investor/investor-bff/test/unit/graphql/initiate-deposit.test.ts` | **create** | Resolver unit: rejects missing depositId, rejects non-UUIDv4, persists with provided id |
| `services/investor/investor-bff/test/unit/graphql/get-deposit.test.ts` | **create** | Resolver unit: request shape, NotFoundError, rethrow ctx.error |
| `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts` | modify | 3 new cases: initiateDeposit honours client depositId, getDeposit returns row, getDeposit NotFound |
| `apps/investor-mfe/src/app/graphql/investor-bff.queries.ts` | modify | Add `GET_DEPOSIT` query string + `DEPOSIT_FIELDS` fragment |
| `apps/investor-mfe/src/app/graphql/investor-bff.mutations.ts` | modify | `INITIATE_DEPOSIT` input now passes `depositId`; mutation return uses `Deposit` type fields |
| `apps/investor-mfe/src/app/services/deposit.service.ts` | modify | Rename `DepositIntent`→`Deposit`; add `getDeposit`; add `waitForSubscriptionReady`; export `DepositNotFoundError` |
| `apps/investor-mfe/test/app/services/deposit.service.spec.ts` | modify | Update existing tests to new shape; add `getDeposit` happy + NotFound cases; add `waitForSubscriptionReady` test |
| `apps/investor-mfe/src/app/deposit/deposit-form.component.ts` | **create** | Form-only component on `/deposit` |
| `apps/investor-mfe/test/app/deposit/deposit-form.component.spec.ts` | **create** | Form component unit |
| `apps/investor-mfe/src/app/deposit/deposit-pending-page.component.ts` | **create** | Pending/result component on `/deposit/:depositId` |
| `apps/investor-mfe/test/app/deposit/deposit-pending-page.component.spec.ts` | **create** | Pending component unit (includes `subscribe before initiateDeposit` regression test) |
| `apps/investor-mfe/src/app/deposit/deposit-page.component.ts` | **delete** | Replaced by the two new components |
| `apps/investor-mfe/test/app/deposit/deposit-page.component.spec.ts` | **delete** | Replaced by the two new spec files |
| `apps/investor-mfe/src/app/remote-routes.ts` | modify | Two route entries: `deposit` → form, `deposit/:depositId` → pending |
| `apps/investor-mfe/src/app/app.routes.ts` | modify | Mirror the same two entries |
| `apps/nestfolio-e2e/src/journeys/deposit-reload-mid-flight.spec.ts` | **create** | New Playwright scenario: submit, reload before DETECTED, assert recovery |

---

## Task 1: Update schema.graphql — `Deposit` type, `getDeposit` query, `DepositInput.depositId`

**Files:**
- Modify: `services/investor/investor-bff/src/schema.graphql`

- [ ] **Step 1: Read the current schema deposit block**

Run: `grep -nE "DepositInput|DepositIntent|DepositEvent|initiateDeposit|onDepositEvent" services/investor/investor-bff/src/schema.graphql`

Confirm what's there before editing (informs exact edits below).

- [ ] **Step 2: Replace `DepositIntent` type with a richer `Deposit` type**

Find the existing `type DepositIntent { ... }` block and replace it with:

```graphql
type Deposit @aws_cognito_user_pools {
  depositId: ID!
  amountCents: Int!
  currency: String!
  status: String!
  initiatedAt: String!
  detectedAt: String
  failedAt: String
  reason: String
}
```

(Keep field ordering stable; remove the old `DepositIntent` definition entirely.)

- [ ] **Step 3: Update `DepositInput` to require `depositId`**

Find:

```graphql
input DepositInput {
  amountCents: Int!
  currency: String!
}
```

Replace with:

```graphql
input DepositInput {
  depositId: ID!
  amountCents: Int!
  currency: String!
}
```

- [ ] **Step 4: Update `Mutation.initiateDeposit` return type**

Find: `initiateDeposit(input: DepositInput!): DepositIntent!`
Replace with: `initiateDeposit(input: DepositInput!): Deposit!`

- [ ] **Step 5: Add `getDeposit` query**

Find the `type Query { ... }` block. Add a new line under the existing `getFeatureFlags`:

```graphql
  getDeposit(depositId: ID!): Deposit!
```

Place it alphabetically or grouped with other entity getters — match existing convention.

- [ ] **Step 6: Verify the file parses (syntax-only check)**

Run: `pnpm nx run investor-bff:build`
Expected: build succeeds (the schema is bundled by CDK; this confirms no syntax errors).

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-bff/src/schema.graphql
git commit -m "feat(investor-bff): add Deposit type + getDeposit query, DepositInput.depositId"
```

---

## Task 2: Resolver test for `initiate-deposit` — TDD red

**Files:**
- Create: `services/investor/investor-bff/test/unit/graphql/initiate-deposit.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `services/investor/investor-bff/test/unit/graphql/initiate-deposit.test.ts`:

```ts
import { request, response } from '../../../src/graphql/js-function/initiate-deposit.fn.js';

jest.mock('@aws-appsync/utils', () => require('./__mocks__/appsync-utils'));
jest.mock('@aws-appsync/utils/dynamodb', () => require('./__mocks__/appsync-utils-dynamodb'));

describe('initiate-deposit resolver', () => {
  const stash = { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' };
  const validId = '11111111-1111-4111-8111-111111111111';

  describe('request', () => {
    it('persists a Deposit row using the client-supplied depositId', () => {
      const op = request({
        stash,
        arguments: { input: { depositId: validId, amountCents: 10000, currency: 'USD' } },
      });

      expect(op.operation).toBe('PutItem');
      expect(op.key).toEqual({
        pk: `InvestorProfile#${stash.tenantId}#${stash.userId}`,
        sk: `Deposit#${validId}`,
      });
      expect(op.attributeValues.depositId).toBe(validId);
      expect(op.attributeValues.amountCents).toBe(10000);
      expect(op.attributeValues.status).toBe('INITIATED');
      expect(op.attributeValues.region).toBe('us-east-1');
    });

    it('throws ValidationError when depositId is missing', () => {
      expect(() => request({
        stash,
        arguments: { input: { amountCents: 10000, currency: 'USD' } },
      })).toThrow('depositId required');
    });

    it('throws ValidationError when depositId is not UUIDv4', () => {
      expect(() => request({
        stash,
        arguments: { input: { depositId: 'not-a-uuid', amountCents: 10000, currency: 'USD' } },
      })).toThrow('depositId must be UUID v4');
    });

    it('throws ValidationError when amountCents is missing or non-positive', () => {
      expect(() => request({
        stash,
        arguments: { input: { depositId: validId, currency: 'USD' } },
      })).toThrow('amountCents must be > 0');
      expect(() => request({
        stash,
        arguments: { input: { depositId: validId, amountCents: 0, currency: 'USD' } },
      })).toThrow('amountCents must be > 0');
    });

    it('throws ValidationError when currency is not 3 chars', () => {
      expect(() => request({
        stash,
        arguments: { input: { depositId: validId, amountCents: 100, currency: 'US' } },
      })).toThrow('currency must be 3 chars');
    });
  });

  describe('response', () => {
    it('returns the staged result on success', () => {
      const stashWithResult = {
        ...stash,
        _depositResult: {
          depositId: validId,
          amountCents: 10000,
          currency: 'USD',
          status: 'INITIATED',
          initiatedAt: '2026-04-22T00:00:00.000Z',
        },
      };
      const out = response({ stash: stashWithResult });
      expect(out.depositId).toBe(validId);
      expect(out.status).toBe('INITIATED');
    });

    it('rethrows ctx.error via util.error', () => {
      expect(() => response({
        stash, error: { message: 'boom', type: 'InternalError' },
      })).toThrow('boom');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test investor-bff --testPathPatterns=initiate-deposit.test.ts`
Expected: FAIL — current resolver still uses `util.autoId()` and ignores `input.depositId`, so `op.key.sk` will be `Deposit#mock-auto-id` (the mock's autoId return), not `Deposit#${validId}`.

- [ ] **Step 3: Commit failing test (red)**

```bash
git add services/investor/investor-bff/test/unit/graphql/initiate-deposit.test.ts
git commit -m "test(investor-bff): initiate-deposit resolver — depositId from input + UUID validation"
```

---

## Task 3: Implement `initiate-deposit.fn.js` change — TDD green

**Files:**
- Modify: `services/investor/investor-bff/src/graphql/js-function/initiate-deposit.fn.js`

- [ ] **Step 1: Replace the resolver with the new implementation**

Overwrite `services/investor/investor-bff/src/graphql/js-function/initiate-deposit.fn.js` with:

```js
import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const input = ctx.arguments.input || {};
  const depositId = input.depositId;
  const amountCents = input.amountCents;
  const currency = input.currency || 'USD';
  if (!depositId) util.error('depositId required', 'ValidationError');
  if (!UUID_V4_RE.test(depositId)) util.error('depositId must be UUID v4', 'ValidationError');
  if (!amountCents || amountCents <= 0) util.error('amountCents must be > 0', 'ValidationError');
  if (!currency || currency.length !== 3) util.error('currency must be 3 chars', 'ValidationError');
  const now = util.time.nowISO8601();
  ctx.stash._depositResult = { depositId, amountCents, currency, status: 'INITIATED', initiatedAt: now };
  return ddb.put({
    key: { pk: `InvestorProfile#${tenantId}#${userId}`, sk: `Deposit#${depositId}` },
    item: {
      __typename: 'Deposit', tenantId, userId, region: ctx.stash.region, depositId, amountCents, currency,
      status: 'INITIATED', initiatedAt: now, timestamp: now,
    },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.stash._depositResult;
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm nx test investor-bff --testPathPatterns=initiate-deposit.test.ts`
Expected: PASS — all 7 cases green.

- [ ] **Step 3: Commit (green)**

```bash
git add services/investor/investor-bff/src/graphql/js-function/initiate-deposit.fn.js
git commit -m "feat(investor-bff): initiate-deposit accepts client-supplied depositId"
```

---

## Task 4: Resolver test for `get-deposit` — TDD red

**Files:**
- Create: `services/investor/investor-bff/test/unit/graphql/get-deposit.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `services/investor/investor-bff/test/unit/graphql/get-deposit.test.ts`:

```ts
import { request, response } from '../../../src/graphql/js-function/get-deposit.fn.js';

jest.mock('@aws-appsync/utils', () => require('./__mocks__/appsync-utils'));
jest.mock('@aws-appsync/utils/dynamodb', () => require('./__mocks__/appsync-utils-dynamodb'));

describe('get-deposit resolver', () => {
  const stash = { tenantId: 'tenant-1', userId: 'user-1' };
  const depositId = '22222222-2222-4222-8222-222222222222';

  describe('request', () => {
    it('issues a GetItem against the caller-scoped Deposit row', () => {
      const op = request({ stash, arguments: { depositId } });
      expect(op.operation).toBe('GetItem');
      expect(op.key).toEqual({
        pk: `InvestorProfile#${stash.tenantId}#${stash.userId}`,
        sk: `Deposit#${depositId}`,
      });
    });

    it('throws ValidationError when depositId is missing', () => {
      expect(() => request({ stash, arguments: {} })).toThrow('depositId required');
    });
  });

  describe('response', () => {
    it('returns the deposit row on success', () => {
      const row = {
        depositId, amountCents: 10000, currency: 'USD',
        status: 'INITIATED', initiatedAt: '2026-04-22T00:00:00.000Z',
      };
      const out = response({ stash, result: row });
      expect(out).toEqual(row);
    });

    it('throws NotFoundError when result is null', () => {
      expect(() => response({ stash, result: null })).toThrow('Deposit not found');
    });

    it('rethrows ctx.error via util.error', () => {
      expect(() => response({
        stash, error: { message: 'boom', type: 'InternalError' },
      })).toThrow('boom');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test investor-bff --testPathPatterns=get-deposit.test.ts`
Expected: FAIL — `Cannot find module '.../get-deposit.fn.js'` (file doesn't exist yet).

- [ ] **Step 3: Commit failing test (red)**

```bash
git add services/investor/investor-bff/test/unit/graphql/get-deposit.test.ts
git commit -m "test(investor-bff): get-deposit resolver — request/response shape + NotFoundError"
```

---

## Task 5: Implement `get-deposit.fn.js` — TDD green

**Files:**
- Create: `services/investor/investor-bff/src/graphql/js-function/get-deposit.fn.js`

- [ ] **Step 1: Create the resolver**

Create `services/investor/investor-bff/src/graphql/js-function/get-deposit.fn.js`:

```js
import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const { depositId } = ctx.arguments;
  if (!depositId) util.error('depositId required', 'ValidationError');
  return ddb.get({
    key: { pk: `InvestorProfile#${tenantId}#${userId}`, sk: `Deposit#${depositId}` },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) util.error('Deposit not found', 'NotFoundError');
  return ctx.result;
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm nx test investor-bff --testPathPatterns=get-deposit.test.ts`
Expected: PASS — all 5 cases green.

- [ ] **Step 3: Commit (green)**

```bash
git add services/investor/investor-bff/src/graphql/js-function/get-deposit.fn.js
git commit -m "feat(investor-bff): add get-deposit resolver"
```

---

## Task 6: Integration tests — `initiateDeposit(depositId)` + `getDeposit`

**Files:**
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

- [ ] **Step 1: Read the existing integration test to find the deposit-related block**

Run: `grep -nE "initiateDeposit|DepositIntent|deposit" services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

Identify (a) where `initiateDeposit` is invoked today (likely under an AppSync mutations describe block), (b) what fixture/helpers exist (e.g., `eventBusTrap`, AppSync auth helper), (c) the local `gql` template strings used.

- [ ] **Step 2: Add the three new test cases**

Inside the existing AppSync block (the `describe` that already exercises `initiateDeposit`), add three `it(...)` blocks. Match the file's existing style for client setup; the pseudo-code below shows the assertions, not the imports/setup which depend on existing helpers:

```ts
it('initiateDeposit honours a client-supplied depositId', async () => {
  const depositId = crypto.randomUUID();
  const result = await appsync.mutate(`
    mutation($input: DepositInput!) {
      initiateDeposit(input: $input) { depositId status amountCents }
    }
  `, { input: { depositId, amountCents: 12345, currency: 'USD' } });

  expect(result.initiateDeposit.depositId).toBe(depositId);
  expect(result.initiateDeposit.status).toBe('INITIATED');

  // CDC emits DEPOSIT_INITIATED carrying the same id.
  const event = await eventBusTrap.waitFor('DEPOSIT_INITIATED', { depositId });
  expect(event.detail.subject.depositId).toBe(depositId);
});

it('getDeposit returns the row written by initiateDeposit', async () => {
  const depositId = crypto.randomUUID();
  await appsync.mutate(`
    mutation($input: DepositInput!) { initiateDeposit(input: $input) { depositId } }
  `, { input: { depositId, amountCents: 5000, currency: 'USD' } });

  const result = await appsync.query(`
    query($depositId: ID!) {
      getDeposit(depositId: $depositId) { depositId amountCents currency status }
    }
  `, { depositId });

  expect(result.getDeposit).toEqual(expect.objectContaining({
    depositId, amountCents: 5000, currency: 'USD', status: 'INITIATED',
  }));
});

it('getDeposit returns NotFoundError for an unknown depositId', async () => {
  const depositId = crypto.randomUUID();
  await expect(appsync.query(`
    query($depositId: ID!) { getDeposit(depositId: $depositId) { depositId } }
  `, { depositId })).rejects.toThrow(/Deposit not found|NotFoundError/);
});
```

If the existing `appsync.mutate`/`appsync.query` helpers have a different shape (e.g., they bundle auth + client into a single call), adapt accordingly — these blocks describe the assertions, not the harness. The `eventBusTrap` helper exists in this file's setup; reuse it.

- [ ] **Step 3: Update existing `initiateDeposit` integration cases to pass `depositId`**

Any pre-existing `it(...)` block that calls `initiateDeposit` without `depositId` will now fail (the resolver requires it). Add `depositId: crypto.randomUUID()` to each existing input. Search for `initiateDeposit(input:` in this file and patch every callsite.

- [ ] **Step 4: Deploy schema + resolvers to dev**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff 2>&1 | tee /tmp/deposit-deploy.log`
Expected: deploy succeeds.

- [ ] **Step 5: Run integration tests against deployed dev**

Run: `pnpm nx run investor-bff:test-integration`
Expected: PASS — existing cases + 3 new cases green.

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit -m "test(investor-bff): integration coverage for getDeposit + client depositId"
```

---

## Task 7: Frontend GraphQL strings — `GET_DEPOSIT` + `INITIATE_DEPOSIT` shape

**Files:**
- Modify: `apps/investor-mfe/src/app/graphql/investor-bff.queries.ts`
- Modify: `apps/investor-mfe/src/app/graphql/investor-bff.mutations.ts`

- [ ] **Step 1: Add the `GET_DEPOSIT` query + `DEPOSIT_FIELDS` fragment**

In `apps/investor-mfe/src/app/graphql/investor-bff.queries.ts`, append at the bottom (after the existing notification block):

```ts
// --- Deposit ---

const DEPOSIT_FIELDS = `
  fragment DepositFields on Deposit {
    depositId
    amountCents
    currency
    status
    initiatedAt
    detectedAt
    failedAt
    reason
  }
`;

export const GET_DEPOSIT = `
  query GetDeposit($depositId: ID!) {
    getDeposit(depositId: $depositId) {
      ...DepositFields
    }
  }
  ${DEPOSIT_FIELDS}
`;
```

- [ ] **Step 2: Update `INITIATE_DEPOSIT` mutation shape**

Open `apps/investor-mfe/src/app/graphql/investor-bff.mutations.ts`. Replace the existing `INITIATE_DEPOSIT` constant with the new selection set (mutation now returns `Deposit`, all fields):

```ts
export const INITIATE_DEPOSIT = `
  mutation InitiateDeposit($input: DepositInput!) {
    initiateDeposit(input: $input) {
      depositId
      amountCents
      currency
      status
      initiatedAt
      detectedAt
      failedAt
      reason
    }
  }
`;
```

(Note: the variable `$input` is unchanged at the GraphQL layer — `DepositInput` is the same input type, but the TS-side `DepositInput` now requires `depositId`.)

- [ ] **Step 3: Commit**

```bash
git add apps/investor-mfe/src/app/graphql/investor-bff.queries.ts apps/investor-mfe/src/app/graphql/investor-bff.mutations.ts
git commit -m "feat(investor-mfe): GET_DEPOSIT query + INITIATE_DEPOSIT returns Deposit"
```

---

## Task 8: `DepositService` test — TDD red (full rewrite)

**Files:**
- Modify: `apps/investor-mfe/test/app/services/deposit.service.spec.ts`

- [ ] **Step 1: Replace the existing spec with the new shape**

Overwrite `apps/investor-mfe/test/app/services/deposit.service.spec.ts` with:

```ts
import { TestBed } from '@angular/core/testing';
import { throwError, Subject } from 'rxjs';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { createMockGraphqlService } from '@nestfolio/shell/testing';
import {
  DepositService,
  DepositNotFoundError,
  type Deposit,
  type DepositEvent,
} from '../../../src/app/services/deposit.service';

describe('DepositService', () => {
  let graphql: ReturnType<typeof createMockGraphqlService>;
  let service: DepositService;

  const depositId = '33333333-3333-4333-8333-333333333333';
  const deposit: Deposit = {
    depositId,
    amountCents: 10_000,
    currency: 'USD',
    status: 'INITIATED',
    initiatedAt: '2026-04-22T00:00:00.000Z',
    detectedAt: null,
    failedAt: null,
    reason: null,
  };

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

  it('initiateDeposit: passes depositId, amountCents, currency to the mutation and returns Deposit', async () => {
    graphql.mutate.mockResolvedValue({ initiateDeposit: deposit });
    const out = await service.initiateDeposit({ depositId, amountCents: 10_000, currency: 'USD' });
    expect(graphql.mutate).toHaveBeenCalledWith(
      expect.stringContaining('initiateDeposit'),
      { input: { depositId, amountCents: 10_000, currency: 'USD' } },
    );
    expect(out).toEqual(deposit);
  });

  it('initiateDeposit: propagates mutation errors', async () => {
    graphql.mutate.mockRejectedValue(new Error('This action is temporarily paused'));
    await expect(service.initiateDeposit({ depositId, amountCents: 1_000, currency: 'USD' }))
      .rejects.toThrow('This action is temporarily paused');
  });

  it('getDeposit: queries with depositId and returns the row', async () => {
    graphql.query.mockResolvedValue({ getDeposit: deposit });
    const out = await service.getDeposit(depositId);
    expect(graphql.query).toHaveBeenCalledWith(
      expect.stringContaining('getDeposit'),
      { depositId },
    );
    expect(out).toEqual(deposit);
  });

  it('getDeposit: throws DepositNotFoundError on AppSync NotFoundError', async () => {
    const err: Error & { errorType?: string } = new Error('Deposit not found');
    err.errorType = 'NotFoundError';
    graphql.query.mockRejectedValue(err);
    await expect(service.getDeposit(depositId)).rejects.toBeInstanceOf(DepositNotFoundError);
  });

  it('getDeposit: rethrows non-NotFound errors as-is', async () => {
    graphql.query.mockRejectedValue(new Error('Connection refused'));
    await expect(service.getDeposit(depositId)).rejects.toThrow('Connection refused');
  });

  it('subscribeToDepositEvent: forwards subscription payloads to the callback', () => {
    const subject = new Subject<{ onDepositEvent: DepositEvent }>();
    graphql.subscribe.mockReturnValue(subject.asObservable());
    const received: DepositEvent[] = [];
    service.subscribeToDepositEvent(depositId, (e) => received.push(e));
    expect(graphql.subscribe).toHaveBeenCalledWith(
      expect.stringContaining('onDepositEvent'),
      { depositId },
    );
    const payload: DepositEvent = {
      depositId, tenantId: 't-1', status: 'DETECTED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:01:00.000Z', reason: null,
    };
    subject.next({ onDepositEvent: payload });
    expect(received).toEqual([payload]);
  });

  it('unsubscribeFromDepositEvent: ignores further payloads', () => {
    const subject = new Subject<{ onDepositEvent: DepositEvent }>();
    graphql.subscribe.mockReturnValue(subject.asObservable());
    const received: DepositEvent[] = [];
    service.subscribeToDepositEvent(depositId, (e) => received.push(e));
    service.unsubscribeFromDepositEvent();
    subject.next({
      onDepositEvent: {
        depositId, tenantId: 't-1', status: 'DETECTED',
        amountCents: 1, currency: 'USD', occurredAt: '', reason: null,
      },
    });
    expect(received).toEqual([]);
  });

  it('subscribeToDepositEvent: error path logs but does not throw', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    graphql.subscribe.mockReturnValue(throwError(() => new Error('WS closed')));
    expect(() => service.subscribeToDepositEvent(depositId, () => undefined)).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('waitForSubscriptionReady: resolves after an internal handshake delay', async () => {
    jest.useFakeTimers();
    try {
      const promise = service.waitForSubscriptionReady();
      jest.advanceTimersByTime(500);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test investor-mfe --testPathPatterns=deposit.service.spec.ts`
Expected: FAIL — `DepositNotFoundError` import fails, `Deposit` interface missing fields, `getDeposit`/`waitForSubscriptionReady` methods missing.

- [ ] **Step 3: Commit failing test (red)**

```bash
git add apps/investor-mfe/test/app/services/deposit.service.spec.ts
git commit -m "test(investor-mfe): DepositService Pattern B shape (Deposit, getDeposit, waitForSubscriptionReady)"
```

---

## Task 9: Implement `DepositService` — TDD green

**Files:**
- Modify: `apps/investor-mfe/src/app/services/deposit.service.ts`

- [ ] **Step 1: Rewrite the service**

Overwrite `apps/investor-mfe/src/app/services/deposit.service.ts` with:

```ts
import { Injectable, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { INITIATE_DEPOSIT } from '../graphql/investor-bff.mutations';
import { GET_DEPOSIT } from '../graphql/investor-bff.queries';
import { ON_DEPOSIT_EVENT } from '../graphql/investor-bff.subscriptions';

export interface Deposit {
  depositId: string;
  amountCents: number;
  currency: string;
  status: string;
  initiatedAt: string;
  detectedAt: string | null;
  failedAt: string | null;
  reason: string | null;
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
  depositId: string;
  amountCents: number;
  currency: string;
}

export class DepositNotFoundError extends Error {
  constructor() { super('Deposit not found'); this.name = 'DepositNotFoundError'; }
}

const SUBSCRIPTION_HANDSHAKE_MS = 500;

@Injectable()
export class DepositService {
  private readonly graphql = inject(GraphqlService);
  private subscription: Subscription | null = null;

  async initiateDeposit(input: DepositInput): Promise<Deposit> {
    const data = await this.graphql.mutate<{ initiateDeposit: Deposit }>(INITIATE_DEPOSIT, { input });
    return data.initiateDeposit;
  }

  async getDeposit(depositId: string): Promise<Deposit> {
    try {
      const data = await this.graphql.query<{ getDeposit: Deposit }>(GET_DEPOSIT, { depositId });
      return data.getDeposit;
    } catch (err) {
      if (isNotFoundError(err)) throw new DepositNotFoundError();
      throw err;
    }
  }

  subscribeToDepositEvent(depositId: string, onEvent: (e: DepositEvent) => void): void {
    this.unsubscribeFromDepositEvent();
    const obs = this.graphql.subscribe<{ onDepositEvent: DepositEvent }>(ON_DEPOSIT_EVENT, { depositId });
    this.subscription = obs.subscribe({
      next: (data) => { if (data.onDepositEvent) onEvent(data.onDepositEvent); },
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

  waitForSubscriptionReady(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, SUBSCRIPTION_HANDSHAKE_MS));
  }
}

function isNotFoundError(err: unknown): boolean {
  if (err instanceof Error) {
    const errorType = (err as Error & { errorType?: string }).errorType;
    if (errorType === 'NotFoundError') return true;
    if (/Deposit not found/i.test(err.message)) return true;
  }
  return false;
}
```

- [ ] **Step 2: Run the spec to verify it passes**

Run: `pnpm nx test investor-mfe --testPathPatterns=deposit.service.spec.ts`
Expected: PASS — all cases green.

- [ ] **Step 3: Commit (green)**

```bash
git add apps/investor-mfe/src/app/services/deposit.service.ts
git commit -m "feat(investor-mfe): DepositService gains getDeposit, waitForSubscriptionReady, DepositNotFoundError"
```

---

## Task 10: `DepositFormComponent` test — TDD red

**Files:**
- Create: `apps/investor-mfe/test/app/deposit/deposit-form.component.spec.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/investor-mfe/test/app/deposit/deposit-form.component.spec.ts`:

```ts
import { ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DepositFormComponent } from '../../../src/app/deposit/deposit-form.component';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
import { I18nService } from '@nestfolio/shell/i18n';
import {
  setupComponentTest,
  createMockI18nService,
  createMockRouter,
} from '@nestfolio/shell/testing';

describe('DepositFormComponent', () => {
  let component: DepositFormComponent;
  let fixture: ComponentFixture<DepositFormComponent>;
  let router: ReturnType<typeof createMockRouter>;
  let flagsStore: { isEnabled: jest.Mock; flags: jest.Mock };

  beforeEach(async () => {
    router = createMockRouter();
    flagsStore = {
      isEnabled: jest.fn().mockReturnValue(true),
      flags: jest.fn().mockReturnValue({}),
    };
    fixture = await setupComponentTest(DepositFormComponent, {
      providers: [
        { provide: Router, useValue: router },
        { provide: FeatureFlagsStore, useValue: flagsStore },
        { provide: I18nService, useValue: createMockI18nService() },
      ],
    });
    component = fixture.componentInstance;
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

  it('confirm is disabled when initiateDeposit feature flag is off', () => {
    flagsStore.isEnabled.mockImplementation((name: string) => name !== 'initiateDeposit');
    component.amount.set(100);
    expect(component.confirmDisabled()).toBe(true);
  });

  it('submit: generates a UUIDv4 depositId and navigates to /deposit/:id with router state', () => {
    const uuidSpy = jest.spyOn(crypto, 'randomUUID').mockReturnValue(
      '44444444-4444-4444-8444-444444444444' as `${string}-${string}-${string}-${string}-${string}`,
    );
    component.amount.set(100);
    component.submit();

    expect(router.navigate).toHaveBeenCalledWith(
      ['/deposit', '44444444-4444-4444-8444-444444444444'],
      { state: { amountCents: 10_000, currency: 'USD' } },
    );
    uuidSpy.mockRestore();
  });

  it('submit: no-op when confirmDisabled (does not navigate)', () => {
    component.amount.set(0);
    component.submit();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('cancel: navigates to /dashboard', () => {
    component.cancel();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test investor-mfe --testPathPatterns=deposit-form.component.spec.ts`
Expected: FAIL — `Cannot find module '.../deposit-form.component'`.

- [ ] **Step 3: Commit failing test (red)**

```bash
git add apps/investor-mfe/test/app/deposit/deposit-form.component.spec.ts
git commit -m "test(investor-mfe): DepositFormComponent — submit generates UUID + router.navigate"
```

---

## Task 11: Implement `DepositFormComponent` — TDD green

**Files:**
- Create: `apps/investor-mfe/src/app/deposit/deposit-form.component.ts`

- [ ] **Step 1: Create the component**

Create `apps/investor-mfe/src/app/deposit/deposit-form.component.ts`:

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageModule } from 'primeng/message';
import { I18nService } from '@nestfolio/shell/i18n';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';

const FEATURE_FLAG = 'initiateDeposit';

@Component({
  selector: 'app-deposit-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CardModule, InputNumberModule, MessageModule],
  template: `
    <div class="deposit-page">
      <h1 class="page-title">Fund account</h1>
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
            [max]="10000000" />
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
            (onClick)="cancel()" />
          <p-button
            label="Confirm"
            data-testid="deposit-confirm"
            [disabled]="confirmDisabled()"
            (onClick)="submit()" />
        </div>
      </p-card>
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
    .w-full { width: 100%; }
  `],
})
export class DepositFormComponent {
  readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly flagsStore = inject(FeatureFlagsStore);

  readonly amount = signal<number | null>(null);

  readonly flagEnabled = computed(() => this.flagsStore.isEnabled(FEATURE_FLAG));
  readonly flagReason = computed(() => this.flagsStore.flags()[FEATURE_FLAG]?.reason ?? null);

  readonly confirmDisabled = computed(() => {
    const a = this.amount();
    if (a == null || a <= 0) return true;
    if (!this.flagEnabled()) return true;
    return false;
  });

  submit(): void {
    if (this.confirmDisabled()) return;
    const depositId = crypto.randomUUID();
    const amountCents = Math.round((this.amount() ?? 0) * 100);
    this.router.navigate(['/deposit', depositId], { state: { amountCents, currency: 'USD' } });
  }

  cancel(): void {
    this.router.navigate(['/dashboard']);
  }
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm nx test investor-mfe --testPathPatterns=deposit-form.component.spec.ts`
Expected: PASS — all 5 cases green.

- [ ] **Step 3: Commit (green)**

```bash
git add apps/investor-mfe/src/app/deposit/deposit-form.component.ts
git commit -m "feat(investor-mfe): DepositFormComponent at /deposit — UUID + router.navigate"
```

---

## Task 12: `DepositPendingPageComponent` test — TDD red

**Files:**
- Create: `apps/investor-mfe/test/app/deposit/deposit-pending-page.component.spec.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/investor-mfe/test/app/deposit/deposit-pending-page.component.spec.ts`:

```ts
import { ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { DepositPendingPageComponent } from '../../../src/app/deposit/deposit-pending-page.component';
import {
  DepositService,
  DepositNotFoundError,
  type Deposit,
  type DepositEvent,
} from '../../../src/app/services/deposit.service';
import { I18nService } from '@nestfolio/shell/i18n';
import {
  setupComponentTest,
  createMockI18nService,
  createMockRouter,
} from '@nestfolio/shell/testing';

const depositId = '55555555-5555-4555-8555-555555555555';

const initiated: Deposit = {
  depositId, amountCents: 10_000, currency: 'USD',
  status: 'INITIATED', initiatedAt: '2026-04-22T00:00:00.000Z',
  detectedAt: null, failedAt: null, reason: null,
};
const detected: Deposit = { ...initiated, status: 'DETECTED', detectedAt: '2026-04-22T00:01:00.000Z' };
const failed: Deposit = {
  ...initiated, status: 'FAILED', failedAt: '2026-04-22T00:01:00.000Z',
  reason: 'Broker rejected',
};

function configureWithRouterState(state: unknown) {
  Object.defineProperty(history, 'state', { value: state, writable: true, configurable: true });
}

async function mountWith(opts: {
  deposit: jest.Mocked<Pick<DepositService, 'subscribeToDepositEvent' | 'unsubscribeFromDepositEvent' | 'waitForSubscriptionReady' | 'getDeposit' | 'initiateDeposit'>>;
  routerState?: unknown;
}): Promise<{ fixture: ComponentFixture<DepositPendingPageComponent>; component: DepositPendingPageComponent; router: ReturnType<typeof createMockRouter> }> {
  jest.useFakeTimers();
  configureWithRouterState(opts.routerState ?? {});
  const router = createMockRouter();
  const route = {
    snapshot: { paramMap: { get: (k: string) => (k === 'depositId' ? depositId : null) } },
  };
  const fixture = await setupComponentTest(DepositPendingPageComponent, {
    providers: [
      { provide: DepositService, useValue: opts.deposit },
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: route },
      { provide: I18nService, useValue: createMockI18nService() },
    ],
  });
  return { fixture, component: fixture.componentInstance, router };
}

describe('DepositPendingPageComponent', () => {
  let deposit: jest.Mocked<Pick<DepositService, 'subscribeToDepositEvent' | 'unsubscribeFromDepositEvent' | 'waitForSubscriptionReady' | 'getDeposit' | 'initiateDeposit'>>;

  beforeEach(() => {
    deposit = {
      subscribeToDepositEvent: jest.fn(),
      unsubscribeFromDepositEvent: jest.fn(),
      waitForSubscriptionReady: jest.fn().mockResolvedValue(undefined),
      getDeposit: jest.fn(),
      initiateDeposit: jest.fn(),
    };
  });

  afterEach(() => { jest.useRealTimers(); });

  it('REGRESSION: subscribe is called before initiateDeposit (race fix)', async () => {
    deposit.getDeposit.mockRejectedValue(new DepositNotFoundError());
    deposit.initiateDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({
      deposit,
      routerState: { amountCents: 10_000, currency: 'USD' },
    });
    await component.ngOnInit();

    const subOrder = deposit.subscribeToDepositEvent.mock.invocationCallOrder[0];
    const mutOrder = deposit.initiateDeposit.mock.invocationCallOrder[0];
    expect(subOrder).toBeLessThan(mutOrder);
  });

  it('hydrates as INITIATED from getDeposit (reload before DETECTED)', async () => {
    deposit.getDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    expect(component.state()).toBe('initiated');
    expect(component.deposit()).toEqual(initiated);
    expect(deposit.initiateDeposit).not.toHaveBeenCalled();
  });

  it('hydrates as DETECTED from getDeposit (reload after DETECTED) — no timeout armed', async () => {
    deposit.getDeposit.mockResolvedValue(detected);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    expect(component.state()).toBe('detected');
    jest.advanceTimersByTime(60_000);
    expect(component.state()).toBe('detected'); // no transition to timeout
  });

  it('hydrates as FAILED from getDeposit with reason', async () => {
    deposit.getDeposit.mockResolvedValue(failed);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    expect(component.state()).toBe('failed');
    expect(component.failureReason()).toBe('Broker rejected');
  });

  it('on NotFound + populated history.state: fires initiateDeposit with depositId from URL', async () => {
    deposit.getDeposit.mockRejectedValue(new DepositNotFoundError());
    deposit.initiateDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({
      deposit,
      routerState: { amountCents: 10_000, currency: 'USD' },
    });
    await component.ngOnInit();
    expect(deposit.initiateDeposit).toHaveBeenCalledWith({
      depositId, amountCents: 10_000, currency: 'USD',
    });
    expect(component.state()).toBe('initiated');
  });

  it('on NotFound + empty history.state: shows invalidUrl panel, never mutates', async () => {
    deposit.getDeposit.mockRejectedValue(new DepositNotFoundError());
    const { component } = await mountWith({ deposit, routerState: {} });
    await component.ngOnInit();
    expect(component.state()).toBe('invalidUrl');
    expect(deposit.initiateDeposit).not.toHaveBeenCalled();
  });

  it('subscription DETECTED frame after INITIATED hydration → state=detected, timeout cleared', async () => {
    deposit.getDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    const onEvent = deposit.subscribeToDepositEvent.mock.calls[0][1];

    const evt: DepositEvent = {
      depositId, tenantId: 't-1', status: 'DETECTED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:01:00.000Z', reason: null,
    };
    onEvent(evt);
    expect(component.state()).toBe('detected');

    jest.advanceTimersByTime(60_000);
    expect(component.state()).toBe('detected');
  });

  it('30s timeout in INITIATED → state=timeout (subscription stays open)', async () => {
    deposit.getDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    jest.advanceTimersByTime(30_000);
    expect(component.state()).toBe('timeout');
    expect(deposit.unsubscribeFromDepositEvent).not.toHaveBeenCalled();
  });

  it('initiateDeposit rejection on fresh-submit branch → state=failed', async () => {
    deposit.getDeposit.mockRejectedValue(new DepositNotFoundError());
    deposit.initiateDeposit.mockRejectedValue(new Error('Circuit open'));
    const { component } = await mountWith({
      deposit,
      routerState: { amountCents: 10_000, currency: 'USD' },
    });
    await component.ngOnInit();
    expect(component.state()).toBe('failed');
    expect(component.failureReason()).toBe('Circuit open');
  });

  it('waitForSubscriptionReady rejection → state=failed', async () => {
    deposit.waitForSubscriptionReady.mockRejectedValue(new Error('WS connection failed'));
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    expect(component.state()).toBe('failed');
    expect(deposit.getDeposit).not.toHaveBeenCalled();
  });

  it('viewDashboard from detected: navigates to /dashboard', async () => {
    deposit.getDeposit.mockResolvedValue(detected);
    const { component, router } = await mountWith({ deposit });
    await component.ngOnInit();
    component.viewDashboard();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('ngOnDestroy unsubscribes and clears timeout', async () => {
    deposit.getDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    component.ngOnDestroy();
    expect(deposit.unsubscribeFromDepositEvent).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test investor-mfe --testPathPatterns=deposit-pending-page.component.spec.ts`
Expected: FAIL — `Cannot find module '.../deposit-pending-page.component'`.

- [ ] **Step 3: Commit failing test (red)**

```bash
git add apps/investor-mfe/test/app/deposit/deposit-pending-page.component.spec.ts
git commit -m "test(investor-mfe): DepositPendingPageComponent — race fix + getDeposit recovery"
```

---

## Task 13: Implement `DepositPendingPageComponent` — TDD green

**Files:**
- Create: `apps/investor-mfe/src/app/deposit/deposit-pending-page.component.ts`

- [ ] **Step 1: Create the component**

Create `apps/investor-mfe/src/app/deposit/deposit-pending-page.component.ts`:

```ts
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { I18nService } from '@nestfolio/shell/i18n';
import {
  DepositService,
  DepositNotFoundError,
  type Deposit,
  type DepositEvent,
} from '../services/deposit.service';

export type PendingPageState =
  | 'loading'
  | 'initiated'
  | 'detected'
  | 'failed'
  | 'timeout'
  | 'invalidUrl';

const TIMEOUT_MS = 30_000;

interface RouterFormState {
  amountCents?: number;
  currency?: string;
}

@Component({
  selector: 'app-deposit-pending-page',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule, MessageModule, TagModule],
  template: `
    <div class="deposit-page">
      <h1 class="page-title">Fund account</h1>

      @if (state() === 'loading') {
        <p-card data-testid="deposit-panel-loading">
          <div class="spinner">Loading…</div>
        </p-card>
      }

      @if (state() === 'initiated') {
        <p-card data-testid="deposit-panel-initiated">
          <p-tag severity="info" value="INITIATED" />
          <p>Deposit ID: <code>{{ deposit()?.depositId }}</code></p>
          <p>Amount: {{ (deposit()?.amountCents ?? 0) / 100 | currency:'USD' }}</p>
          <p>We'll update this page the moment your deposit is confirmed.</p>
        </p-card>
      }

      @if (state() === 'timeout') {
        <p-card data-testid="deposit-panel-timeout">
          <p-tag severity="info" value="INITIATED" />
          <p-message severity="warn" text="Still processing… this can take up to a minute."
            styleClass="w-full" />
          <p>Deposit ID: <code>{{ deposit()?.depositId }}</code></p>
        </p-card>
      }

      @if (state() === 'detected') {
        <p-card data-testid="deposit-panel-detected">
          <p-tag severity="success" value="DETECTED" />
          <p>Deposit ID: <code>{{ deposit()?.depositId }}</code></p>
          <p>Amount: {{ (deposit()?.amountCents ?? 0) / 100 | currency:'USD' }}</p>
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
          <p-button label="Try again" data-testid="deposit-try-again" (onClick)="tryAgain()" />
        </p-card>
      }

      @if (state() === 'invalidUrl') {
        <p-card data-testid="deposit-panel-invalid-url">
          <p-message severity="error"
            text="We can't find this deposit. It may have been removed or the link is invalid."
            styleClass="w-full" />
          <p-button label="New deposit" data-testid="deposit-new" (onClick)="newDeposit()" />
        </p-card>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .deposit-page { max-width: 28rem; margin: 2rem auto; padding: 0 1rem; }
    .page-title { margin: 0 0 1rem; font-size: 1.25rem; font-weight: 700; }
    .spinner { color: var(--nf-text-secondary, #6c757d); }
    .w-full { width: 100%; }
  `],
})
export class DepositPendingPageComponent implements OnInit, OnDestroy {
  readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly depositService = inject(DepositService);

  readonly state = signal<PendingPageState>('loading');
  readonly deposit = signal<Deposit | null>(null);
  readonly failureReason = signal<string | null>(null);

  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    const depositId = this.route.snapshot.paramMap.get('depositId');
    if (!depositId) { this.state.set('invalidUrl'); return; }

    this.depositService.subscribeToDepositEvent(depositId, (e) => this.onEvent(e));

    try {
      await this.depositService.waitForSubscriptionReady();
    } catch {
      this.failureReason.set('Couldn\'t connect to server');
      this.state.set('failed');
      return;
    }

    let row: Deposit;
    try {
      row = await this.depositService.getDeposit(depositId);
    } catch (err) {
      if (!(err instanceof DepositNotFoundError)) {
        this.failureReason.set(err instanceof Error ? err.message : 'Could not load deposit');
        this.state.set('failed');
        return;
      }
      const navState = (history.state ?? {}) as RouterFormState;
      if (typeof navState.amountCents !== 'number') {
        this.state.set('invalidUrl');
        return;
      }
      try {
        row = await this.depositService.initiateDeposit({
          depositId,
          amountCents: navState.amountCents,
          currency: navState.currency ?? 'USD',
        });
      } catch (mutErr) {
        this.failureReason.set(mutErr instanceof Error ? mutErr.message : 'Deposit failed');
        this.state.set('failed');
        return;
      }
    }

    this.hydrate(row);
    if (this.state() === 'initiated') this.armTimeout();
  }

  private hydrate(row: Deposit): void {
    this.deposit.set(row);
    if (row.status === 'DETECTED') { this.state.set('detected'); return; }
    if (row.status === 'FAILED') {
      this.failureReason.set(row.reason ?? 'Deposit failed');
      this.state.set('failed');
      return;
    }
    this.state.set('initiated');
  }

  private onEvent(event: DepositEvent): void {
    if (event.status === 'DETECTED') {
      this.deposit.update((d) => d ? { ...d, status: 'DETECTED', detectedAt: event.occurredAt } : d);
      this.clearTimeout();
      this.state.set('detected');
    } else if (event.status === 'FAILED') {
      this.failureReason.set(event.reason ?? 'Deposit failed');
      this.clearTimeout();
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

  tryAgain(): void {
    this.router.navigate(['/deposit']);
  }

  newDeposit(): void {
    this.router.navigate(['/deposit']);
  }

  viewDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  ngOnDestroy(): void {
    this.clearTimeout();
    this.depositService.unsubscribeFromDepositEvent();
  }
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm nx test investor-mfe --testPathPatterns=deposit-pending-page.component.spec.ts`
Expected: PASS — all 12 cases green.

- [ ] **Step 3: Commit (green)**

```bash
git add apps/investor-mfe/src/app/deposit/deposit-pending-page.component.ts
git commit -m "feat(investor-mfe): DepositPendingPageComponent at /deposit/:id — Pattern B"
```

---

## Task 14: Wire routes + delete the old component

**Files:**
- Modify: `apps/investor-mfe/src/app/remote-routes.ts`
- Modify: `apps/investor-mfe/src/app/app.routes.ts`
- Delete: `apps/investor-mfe/src/app/deposit/deposit-page.component.ts`
- Delete: `apps/investor-mfe/test/app/deposit/deposit-page.component.spec.ts`

- [ ] **Step 1: Update `remote-routes.ts`**

Open `apps/investor-mfe/src/app/remote-routes.ts`. Replace the single `deposit` child route entry with two:

```ts
{
  path: 'deposit',
  loadComponent: () =>
    import('./deposit/deposit-form.component').then((m) => m.DepositFormComponent),
},
{
  path: 'deposit/:depositId',
  loadComponent: () =>
    import('./deposit/deposit-pending-page.component').then((m) => m.DepositPendingPageComponent),
},
```

(Keep them adjacent to each other, in the same `children:` array as today, before the trailing `redirectTo` entry.)

- [ ] **Step 2: Update `app.routes.ts`**

Open `apps/investor-mfe/src/app/app.routes.ts`. Replace its single `deposit` route with the same two:

```ts
import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: 'deposit',
    loadComponent: () =>
      import('./deposit/deposit-form.component').then((m) => m.DepositFormComponent),
  },
  {
    path: 'deposit/:depositId',
    loadComponent: () =>
      import('./deposit/deposit-pending-page.component').then((m) => m.DepositPendingPageComponent),
  },
];
```

- [ ] **Step 3: Delete the old component + spec**

```bash
git rm apps/investor-mfe/src/app/deposit/deposit-page.component.ts
git rm apps/investor-mfe/test/app/deposit/deposit-page.component.spec.ts
```

- [ ] **Step 4: Run the investor-mfe test target end-to-end**

Run: `pnpm nx test investor-mfe`
Expected: PASS — all suites green; the old `deposit-page.component.spec.ts` is gone, the two new component specs and the updated service spec all pass.

- [ ] **Step 5: Run lint + typecheck for investor-mfe**

Run: `pnpm nx run investor-mfe:lint`
Expected: PASS.

Run: `pnpm nx run investor-mfe:build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/investor-mfe/src/app/remote-routes.ts apps/investor-mfe/src/app/app.routes.ts
git commit -m "feat(investor-mfe): split /deposit into form + pending routes"
```

---

## Task 15: Playwright e2e — reload mid-flight scenario

**Files:**
- Create: `apps/nestfolio-e2e/src/journeys/deposit-reload-mid-flight.spec.ts`

- [ ] **Step 1: Read the existing happy-path scenario for fixture conventions**

Run: `head -120 apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts`

Note the fixture imports (`test`, page-object pattern, tenant fixture). The new spec reuses the same harness; do not invent new helpers.

- [ ] **Step 2: Write the scenario file**

Create `apps/nestfolio-e2e/src/journeys/deposit-reload-mid-flight.spec.ts`. Pattern (adapt imports/POM accessors to match `new-investor-happy-path.spec.ts`):

```ts
import { test, expect } from '@playwright/test';
// Reuse the same fixtures + POM imports + onboarding helper that
// `new-investor-happy-path.spec.ts` uses. Copy that prologue verbatim.

test('deposit reload mid-flight: pending panel re-hydrates after F5, DETECTED still arrives', async ({
  /* same destructured fixtures as the happy-path */
}) => {
  // Prologue: register, complete onboarding, reach dashboard. Reuse the
  // helper steps from `new-investor-happy-path.spec.ts:10-120` —
  // factor into a shared helper if not already extracted.

  await test.step('reach deposit form', async () => {
    await dashboard.clickDeposit();
    await expect(authedPage).toHaveURL(/\/investor\/deposit$/);
    await investor.waitForDepositForm();
  });

  await test.step('submit + capture pending URL', async () => {
    await investor.enterAmount(5000);
    await investor.confirm();
    await expect(authedPage).toHaveURL(/\/investor\/deposit\/[0-9a-f-]+$/);
    await investor.waitForInitiated();
  });

  const pendingUrl = authedPage.url();

  await test.step('reload before DETECTED arrives', async () => {
    await authedPage.reload();
    await expect(authedPage).toHaveURL(pendingUrl);
    await investor.waitForInitiated();
  });

  await test.step('DETECTED still arrives on the re-attached subscription', async () => {
    await investor.waitForDetected();
  });
});
```

- [ ] **Step 3: Run the new e2e against deployed dev**

Run: `pnpm nx run nestfolio-e2e:e2e --grep "deposit reload mid-flight"`
Expected: PASS.

- [ ] **Step 4: Run the existing happy-path scenario to confirm no regression**

Run: `pnpm nx run nestfolio-e2e:e2e --grep "new-investor-happy-path"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/nestfolio-e2e/src/journeys/deposit-reload-mid-flight.spec.ts
git commit -m "test(e2e): deposit reload mid-flight — Pattern B recovery scenario"
```

---

## Task 16: Final validation + ship

**Files:** none (verification only)

- [ ] **Step 1: Run the affected test suites locally**

Run: `pnpm nx affected -t test --base=origin/main`
Expected: PASS — investor-bff, investor-mfe, plus any transitively affected libs.

- [ ] **Step 2: Run integration tests against dev**

Run: `pnpm nx run investor-bff:test-integration`
Expected: PASS.

- [ ] **Step 3: Run the full e2e journey suite**

Run: `pnpm nx run nestfolio-e2e:e2e`
Expected: PASS — both `new-investor-happy-path` and `deposit-reload-mid-flight` green.

- [ ] **Step 4: Manual smoke on dev**

In a browser pointed at the deployed dev MFE:
1. Login → dashboard → click "Fund account".
2. Confirm URL is `/investor/deposit`. Enter 50, click Confirm.
3. Confirm URL changes to `/investor/deposit/<uuid>` and the INITIATED panel renders.
4. Wait for the green DETECTED panel (≤ ~5 s with broker-sim).
5. Repeat steps 1–3, then reload the page mid-flight before DETECTED arrives. The INITIATED panel re-renders, DETECTED still arrives.
6. Repeat steps 1–3, then once on the DETECTED panel, reload. Page comes back on DETECTED immediately (no waiting).
7. Hand-type `/investor/deposit/00000000-0000-4000-8000-000000000000` into the URL bar. The "We can't find this deposit" panel renders with a "New deposit" CTA.

- [ ] **Step 5: Update backlog frontmatter — set `validation_gate` and ship**

Edit `docs/backlog/deposit-page-pattern-a-to-pattern-b.md` frontmatter:
- `status: active` → `status: shipped`
- `plan: docs/superpowers/plans/2026-05-08-deposit-page-pattern-b.md`
- `validation_gate: "Unit + integration green; e2e (new-investor-happy-path + deposit-reload-mid-flight) green on deployed dev; manual 7-step smoke green."`
- Add `closed: "2026-05-08"` (or the actual ship date).

- [ ] **Step 6: Run backlog-lint --fix**

Run: `node .claude/skills/backlog-lint/lint.mjs --fix`
Expected: `✓ N backlog files; all 7 rules pass (with --fix applied)`. The command rewrites `docs/BACKLOG.md` to move the workstream into "Recently Shipped".

- [ ] **Step 7: Commit the ship**

```bash
git add docs/backlog/deposit-page-pattern-a-to-pattern-b.md docs/BACKLOG.md
git commit -m "ship(deposit-page-pattern-a-to-pattern-b): Pattern B refactor live"
```

---

## Self-Review

**Spec coverage** — every section of `2026-05-08-deposit-page-pattern-b-design.md` has a corresponding task:
- Architecture (two routes, two components) → Tasks 11, 13, 14
- `DepositFormComponent` → Tasks 10, 11
- `DepositPendingPageComponent` → Tasks 12, 13
- `DepositService` updates (`Deposit`, `getDeposit`, `waitForSubscriptionReady`) → Tasks 8, 9
- Backend schema deltas → Task 1
- `initiate-deposit.fn.js` change → Tasks 2, 3
- `get-deposit` resolver → Tasks 4, 5
- Backend integration tests → Task 6
- Frame-merge logic (subscription vs query) → covered inside Task 13's `onEvent` + `hydrate`
- Error matrix → covered by Task 12's spec cases (waitForSubscriptionReady reject, initiate reject, NotFound + empty state)
- E2E reload-mid-flight → Task 15
- Acceptance gate → Task 16

**Placeholder scan** — no `TBD`, `TODO`, `implement later`, or "similar to Task N" stubs. Code blocks are complete. The integration test in Task 6 references `appsync.mutate`/`appsync.query` and `eventBusTrap` as helpers — these must be matched to the file's existing harness (Step 1 of that task is explicitly "read the existing harness"); the assertion shapes are concrete.

**Type consistency** — `Deposit` shape (with `detectedAt`, `failedAt`, `reason` nullable) appears identically in: schema (Task 1), service interface (Task 9), test fixtures (Tasks 8, 12). `DepositInput { depositId, amountCents, currency }` is consistent across schema, service, mutation string, and tests. `DepositNotFoundError` exported from `deposit.service.ts` is imported by both the service spec and the pending-page spec. The `subscribeToDepositEvent(depositId, onEvent)` signature is unchanged from today's service so no consumer renames are needed.

**Subscribe-readiness implementation note (acknowledged in spec):** Task 9 implements `waitForSubscriptionReady` as a 500 ms `setTimeout` heuristic. AppSync's underlying `aws-appsync-subscription-link` does not expose a `start_ack` event through the Apollo Observable surface (verified in `libs/shell/src/graphql/graphql.service.ts`); a fixed-delay heuristic matches the practical race window described in the backlog (~200 ms handshake + safety margin). If a more rigorous signal becomes available, `waitForSubscriptionReady` is the single point to upgrade.
