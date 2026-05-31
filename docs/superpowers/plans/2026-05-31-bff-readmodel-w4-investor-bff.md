# BFF Read-Model w4 — investor-bff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `investor-bff`'s `CashBalance` a version-guarded P1 projection, register every investor-bff read-row in the `ReadModelOwnership` registry (command-owned vs P1), stamp a monotonic `__version` on the command-owned `InvestorProfile` row, and migrate dashboard-bff's `InvestorSnapshot` to a versioned P1 projection (the w2 carry-over).

**Architecture:** Single-writer aggregate ownership (see `docs/architecture/READ-MODEL-OWNERSHIP.md`). `CashBalance` is ledger-authoritative → P1 via `projectVersioned`, versioned on the ledger's `snapshot.lastEventSequence`. `InvestorProfile`/`Mandate`/`Notification` are command-owned (field-level writes + condition expressions + seed-by-one-event) → registered `CommandOwned`. The InvestorProfile producer stamps a monotonic `__version` (DynamoDB atomic increment) carried in the full-row CDC subject, letting dashboard-bff project `InvestorSnapshot` as P1 without wiping the stable `onboardingCompletedAt`.

**Tech Stack:** TypeScript, `@nestfolio/event-processor` intents (`projectVersioned`/`project`/`record`/`update`), DynamoDB `UpdateExpression` (`if_not_exists(#v,:zero)+:one`), AppSync JS resolvers, Jest + `aws-sdk-client-mock`, `@nestfolio/test-support` (`expectVersionedWrite`/`expectStaleDrop`), nx `typecheck` target via isolated `tsconfig.type-test.json`.

---

## Decisions (settled before planning)

- **`__version` mechanism for the command-owned `InvestorProfile` row = atomic DynamoDB increment** (`SET #v = if_not_exists(#v, :zero) + :one`, seed = `1`). True monotonic, immune to clock skew, collision-free under concurrent writes (DynamoDB serializes the arithmetic update). Chosen over wall-clock millis (user decision, 2026-05-31).
- **CashBalance `__version` source = `subject.snapshot.lastEventSequence`** — the same monotonic ledger sequence `ledger-bff` (w1) uses; `ledger-ctrl` already stamps it on `BalanceEvent` and CDC carries it. No producer change needed.
- **Enforcement gate = an nx `typecheck` target backed by an isolated `tsconfig.type-test.json`.** investor-bff carries 13 known latent `tsc --noEmit` errors (`investor-bff-13-latent-tsc-errors`, LATER), so a *full-project* tsc gate is red regardless of this work. The narrow tsconfig compiles only `src/read-model-ownership.ts` + `test/types/**/*.type-test.ts`, isolating the ownership trip-wire proof from those latent errors. This improves on w1/w2's manual `tsc` invocation by exposing it as `pnpm nx run <svc>:typecheck` (honors the repo's "run via nx" constraint).

## Out of scope

- **Deposit / Withdrawal / Order externally-settled entities** → workstream 5. The optimistic local `CashBalance` decrement in `request-withdrawal.fn.js` (a JS resolver, not an event-processor intent, so unaffected by the `Projection<'P1'>` registration) stays as-is; w5 converts withdrawal to an intent event + client-side optimistic UI.
- **Full-project `tsc --noEmit` gate for investor-bff** → blocked by `investor-bff-13-latent-tsc-errors`. This plan uses the isolated type-test gate only.
- **Deleting the dead repository mutate-methods** (`setGoal`, `updateGoal`, `grantMandate`, `setOperatingMode`, `upsertReadOnlyBalance` — no live callers; the live mutations are AppSync JS resolvers) → filed as a parking backlog item in Task 5, not deleted here ([[feedback-no-cleanup-during-migration]]).
- **`UserConfirmation`/`UserRejection`/`UserInteraction`** — named in the workstream notes but **not present in investor-bff** (verified: the rows are `InvestorProfile`/`CashBalance`/`Mandate`/`Notification`/`Deposit`/`Withdrawal`/`ExecutionModeChange`). Decision confirm/reject lives in advisory-bff (w3, already shipped as intent events). Nothing to register here.
- **`ExecutionModeChange`** — a write-once audit row created only by `setExecutionMode`'s `transactWrite`, never via an event-processor intent and never projected downstream. Left unregistered (registration would be inert). Noted in the ownership file's comment.
- Generalizing the `typecheck` target to all BFFs + audit drift-checks → workstream 6 (governance/freeze).

## File structure

**investor-bff** (`services/investor/investor-bff/`)
- Create `src/read-model-ownership.ts` — ownership registration (declaration merging).
- Create `tsconfig.type-test.json` — isolated typecheck config.
- Create `test/types/read-model-ownership.type-test.ts` — `@ts-expect-error` trip-wire proof.
- Modify `project.json` — add `typecheck` target.
- Modify `src/transforms/balance-updated.ts` — `project` → `projectVersioned`.
- Modify `test/unit/transforms/balance-updated.test.ts` — versioned intent + executor fresh/stale.
- Modify `src/transforms/onboarding-completed.ts` — seed `__version: 1` on InvestorProfile.
- Modify `src/graphql/js-function/update-goal.fn.js` — increment `__version`.
- Modify `src/graphql/js-function/update-operating-mode.fn.js` — increment `__version`.
- Modify `src/repositories/investor-profile.repository.ts` — increment `__version` in `setExecutionMode`.
- Modify `test/unit/graphql/update-goal.test.ts`, `test/unit/graphql/update-operating-mode.test.ts` — assert increment.
- Modify `test/unit/transforms/onboarding-completed.test.ts` — assert seed `__version: 1`.
- Modify `test/integration/investor-bff.integration.test.ts` — assert `__version` on CashBalance + InvestorProfile.

**dashboard-bff** (`services/investor/dashboard-bff/`)
- Modify `src/transforms/investor-snapshot.ts` — `project` → `projectVersioned` (version from `payload.__version`, `onboardedAt` from `payload.onboardingCompletedAt`).
- Modify `src/read-model-ownership.ts` — add `InvestorSnapshot: Projection<'P1'>`.
- Create `tsconfig.type-test.json` + `test/types/read-model-ownership.type-test.ts`; add `typecheck` target to `project.json`.
- Modify `test/unit/transforms/investor-snapshot.test.ts` — versioned intent + onboardedAt-from-payload + undefined-on-missing-version.

---

## Task 1: investor-bff — CashBalance → versioned P1 + ownership registry + typecheck gate

**Files:**
- Modify: `services/investor/investor-bff/src/transforms/balance-updated.ts`
- Modify: `services/investor/investor-bff/test/unit/transforms/balance-updated.test.ts`
- Create: `services/investor/investor-bff/src/read-model-ownership.ts`
- Create: `services/investor/investor-bff/tsconfig.type-test.json`
- Create: `services/investor/investor-bff/test/types/read-model-ownership.type-test.ts`
- Modify: `services/investor/investor-bff/project.json`

- [ ] **Step 1: Rewrite the failing unit test for the versioned CashBalance transform**

Replace the entire contents of `test/unit/transforms/balance-updated.test.ts`:

```typescript
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IntentExecutor, projectVersioned } from '@nestfolio/event-processor';
import { expectVersionedWrite, expectStaleDrop } from '@nestfolio/test-support';
import { balanceUpdated } from '../../../src/transforms/balance-updated';

const ddbMock = mockClient(DynamoDBDocumentClient);
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const makeUow = (lastEventSequence: number) => ({
  event: {
    id: 'e1',
    type: 'BALANCE_UPDATED',
    timestamp: '2026-01-01T00:00:00.000Z',
    subject: {
      tenantId: 't1',
      userId: 'u1',
      cashBalanceCents: 500_000,
      snapshot: { positions: {}, cashBalanceCents: 500_000, lastEventSequence },
    },
    context: { tenantId: 't1' },
  },
  payload: {},
  record: {},
});

const fakeCtx = {
  eventId: 'evt-1',
  eventType: 'BALANCE_UPDATED',
  tenantId: 't1',
  timestamp: '2026-01-01T00:00:00.000Z',
  receiveCount: 1,
  serviceName: 'investor-bff',
} as never;

describe('balanceUpdated transform', () => {
  it('returns a projectVersioned CashBalance intent keyed on snapshot.lastEventSequence', () => {
    expect(
      balanceUpdated(makeUow(42) as Parameters<typeof balanceUpdated>[0]),
    ).toEqual(
      projectVersioned('CashBalance', {
        tenantId: 't1',
        userId: 'u1',
        cashBalanceCents: 500_000,
      }, {
        version: 42,
        overrides: { pk: 'InvestorProfile#t1#u1', sk: 'CashBalance' },
      }),
    );
  });

  it('defaults version to 0 when the event carries no snapshot sequence', () => {
    const intent = balanceUpdated({
      event: {
        id: 'e1', type: 'BALANCE_UPDATED', timestamp: '2026-01-01T00:00:00.000Z',
        subject: { tenantId: 't1', userId: 'u1', cashBalanceCents: 1 },
        context: { tenantId: 't1' },
      },
      payload: {}, record: {},
    } as Parameters<typeof balanceUpdated>[0]) as { version: number };
    expect(intent.version).toBe(0);
  });

  describe('version guard (executor)', () => {
    let executor: IntentExecutor;
    beforeEach(() => {
      ddbMock.reset();
      executor = new IntentExecutor({ docClient, tableName: 'TestTable' });
    });

    // onAnyCommand(): the executor builds PutCommand from its OWN @aws-sdk/lib-dynamodb
    // copy; under pnpm nesting that can be a distinct class, so on(PutCommand) misses.
    it('applies a fresh versioned write when the condition succeeds', async () => {
      ddbMock.onAnyCommand().resolves({});
      const result = await executor.execute(
        balanceUpdated(makeUow(10) as Parameters<typeof balanceUpdated>[0]),
        fakeCtx,
      );
      expectVersionedWrite(result);
    });

    it('drops a stale write when the version condition fails', async () => {
      const err = new Error('stale');
      err.name = 'ConditionalCheckFailedException';
      ddbMock.onAnyCommand().rejects(err);
      const result = await executor.execute(
        balanceUpdated(makeUow(3) as Parameters<typeof balanceUpdated>[0]),
        fakeCtx,
      );
      expectStaleDrop(result);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test investor-bff --testPathPatterns=balance-updated`
Expected: FAIL — current transform returns a `project` (`_tag: 'project'`) intent, not `projectVersioned`; the first assertion's `toEqual` mismatches and `intent.version` is `undefined`.

- [ ] **Step 3: Switch the transform to `projectVersioned`**

Replace the entire contents of `src/transforms/balance-updated.ts`:

```typescript
import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

interface BalanceUpdatedPayload {
  tenantId: string;
  userId: string;
  cashBalanceCents: number;
  // Ledger stamps a monotonic sequence on the snapshot it emits with
  // BALANCE_UPDATED; we version-guard the CashBalance projection on it so a
  // late/duplicate ledger event can never clobber a newer balance.
  snapshot?: { lastEventSequence?: number };
}

export const balanceUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent => {
  const s = uow.event.subject as BalanceUpdatedPayload;
  const version = Number(s.snapshot?.lastEventSequence ?? 0);
  return projectVersioned('CashBalance', {
    tenantId: s.tenantId,
    userId: s.userId,
    cashBalanceCents: s.cashBalanceCents,
  }, {
    version,
    overrides: { pk: `InvestorProfile#${s.tenantId}#${s.userId}`, sk: 'CashBalance' },
  });
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test investor-bff --testPathPatterns=balance-updated`
Expected: PASS (4 assertions: versioned-intent shape, version-0 default, fresh write, stale drop).

- [ ] **Step 5: Create the ownership registry**

Create `src/read-model-ownership.ts`:

```typescript
/**
 * investor-bff read-model ownership registration (workstream 4).
 *
 * Opting these typenames into @nestfolio/event-processor's ReadModelOwnership
 * registry turns on compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - CashBalance : P1 — ledger is the external authority; projectVersioned only
 *     (project/accumulate/update/record on it fail typecheck).
 *   - InvestorProfile / Mandate / Notification : CommandOwned — driven by local
 *     commands after a one-event seed; field-level update() + record() seed are
 *     allowed, projectVersioned on them fails typecheck.
 *
 * NOT registered (intentional):
 *   - Deposit / Withdrawal → workstream 5 (externally-settled; become Projection<'P1'>).
 *   - ExecutionModeChange → write-once audit row, never written via an intent and
 *     never projected; registration would be inert.
 */
import type { Projection, CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    CashBalance: Projection<'P1'>;
    InvestorProfile: CommandOwned;
    Mandate: CommandOwned;
    Notification: CommandOwned;
  }
}

export {};
```

- [ ] **Step 6: Create the isolated typecheck config**

Create `tsconfig.type-test.json` (narrow include — does NOT pull in the 13 latent `src` errors):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/read-model-ownership.ts", "test/types/**/*.ts"]
}
```

- [ ] **Step 7: Create the trip-wire type-test**

Create `test/types/read-model-ownership.type-test.ts`:

```typescript
/**
 * Compile-time proof that investor-bff's ReadModelOwnership registration enforces
 * the intent×typename rules. Verified by: pnpm nx run investor-bff:typecheck
 * (tsc --noEmit -p tsconfig.type-test.json). Every @ts-expect-error MUST fire.
 */
import { project, accumulate, update, record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CashBalance is P1 — projectVersioned is the only blessed write.
projectVersioned('CashBalance', { cashBalanceCents: 1 }, { version: 1 });
// @ts-expect-error P1 row cannot be written with unconditional project()
project('CashBalance', { cashBalanceCents: 1 });
// @ts-expect-error P1 row cannot be accumulated
accumulate('CashBalance', { field: 'cashBalanceCents', increment: 1 });
// @ts-expect-error P1 row cannot be field-updated
update('CashBalance', { cashBalanceCents: 1 });
// @ts-expect-error P1 row cannot be append-recorded
record('CashBalance', { cashBalanceCents: 1 });

// CommandOwned rows — record() (one-event seed) and update() (field writes) allowed.
record('Notification', { notificationId: 'n1' });
update('InvestorProfile', { operatingMode: 'BALANCED' });
update('Mandate', { status: 'REVOKED' });
// @ts-expect-error a command-owned row is not a versioned projection
projectVersioned('InvestorProfile', { a: 1 }, { version: 1 });
// @ts-expect-error a command-owned row is not a versioned projection
projectVersioned('Mandate', { a: 1 }, { version: 1 });

export {};
```

- [ ] **Step 8: Add the `typecheck` target to project.json**

In `services/investor/investor-bff/project.json`, add a `typecheck` target after the `lint` target inside `"targets"` (change `"lint": { "executor": "@nx/eslint:lint" }` to include the new target):

```json
    "lint": { "executor": "@nx/eslint:lint" },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc --noEmit -p services/investor/investor-bff/tsconfig.type-test.json"
      }
    }
```

- [ ] **Step 9: Run the typecheck gate — expect GREEN**

Run: `pnpm nx run investor-bff:typecheck`
Expected: PASS (exit 0, no output). Every `@ts-expect-error` is satisfied by a real error; `projectVersioned('CashBalance', …)`, `record('Notification', …)`, `update('InvestorProfile'/'Mandate', …)` compile clean.

- [ ] **Step 10: Negative check — prove the trip-wire actually fires, then revert**

Temporarily delete the `// @ts-expect-error` comment line directly above `project('CashBalance', { cashBalanceCents: 1 });` in the type-test, then run:

Run: `pnpm nx run investor-bff:typecheck`
Expected: FAIL — `Argument of type '"CashBalance"' is not assignable to parameter of type 'never'.` (the call is now a real, unsuppressed error). This proves the registration is live. **Restore the deleted `// @ts-expect-error` line** and re-run to confirm GREEN again.

- [ ] **Step 11: Commit**

```bash
git add services/investor/investor-bff/src/transforms/balance-updated.ts \
        services/investor/investor-bff/test/unit/transforms/balance-updated.test.ts \
        services/investor/investor-bff/src/read-model-ownership.ts \
        services/investor/investor-bff/tsconfig.type-test.json \
        services/investor/investor-bff/test/types/read-model-ownership.type-test.ts \
        services/investor/investor-bff/project.json
git commit -m "feat(investor-bff): CashBalance versioned P1 + ownership registry + typecheck gate"
```

---

## Task 2: investor-bff — stamp monotonic `__version` on the InvestorProfile row

InvestorProfile is command-owned. CDC emits the full row as the event subject, so a `__version` on the row is carried in every `INVESTOR_PROFILE_CREATED`/`UPDATED` event. There are exactly **four live write paths** (verified — the repo `setGoal`/`updateGoal`/`grantMandate`/`setOperatingMode` methods are dead): the seed, the two AppSync resolvers, and `setExecutionMode`. Each must establish/increment `__version`.

**Files:**
- Modify: `services/investor/investor-bff/src/transforms/onboarding-completed.ts`
- Modify: `services/investor/investor-bff/test/unit/transforms/onboarding-completed.test.ts`
- Modify: `services/investor/investor-bff/src/graphql/js-function/update-goal.fn.js`
- Modify: `services/investor/investor-bff/test/unit/graphql/update-goal.test.ts`
- Modify: `services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js`
- Modify: `services/investor/investor-bff/test/unit/graphql/update-operating-mode.test.ts`
- Modify: `services/investor/investor-bff/src/repositories/investor-profile.repository.ts`

- [ ] **Step 1: Add a failing assertion that the seed stamps `__version: 1`**

In `test/unit/transforms/onboarding-completed.test.ts`, add this test inside the `describe('onboardingCompleted transform', …)` block (reuse the existing `baseSubject`/`ctx` fixtures already defined in the file):

```typescript
  it('stamps __version: 1 on the seeded InvestorProfile row', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const profile = items.find((i: any) => i.Put?.Item.sk === 'InvestorProfile').Put.Item;
    expect(profile.__version).toBe(1);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx test investor-bff --testPathPatterns=onboarding-completed`
Expected: FAIL — `profile.__version` is `undefined`.

- [ ] **Step 3: Add `__version: 1` to the seed**

In `src/transforms/onboarding-completed.ts`, in the InvestorProfile `Put.Item` object, add `__version: 1,` immediately after the `onboardingCompletedAt: now,` line:

```typescript
            mandateId,
            mandateLevel,
            onboardingCompletedAt: now,
            __version: 1,
            createdAt: now,
            updatedAt: now,
            timestamp: now,
          } satisfies TableEntry,
```

(Leave the `Mandate` sibling row unchanged — Mandate is command-owned and not projected as P1 anywhere, so it needs no version.)

- [ ] **Step 4: Run to verify the seed test passes**

Run: `pnpm nx test investor-bff --testPathPatterns=onboarding-completed`
Expected: PASS.

- [ ] **Step 5: Add a failing assertion that `updateGoal` increments `__version`**

In `test/unit/graphql/update-goal.test.ts`, add a test asserting the UpdateItem expression carries the increment. Match the file's existing harness (it calls `request(ctx)` with a stubbed `ctx`). Add:

```typescript
  it('increments __version in the update expression', () => {
    const ctx = {
      stash: { tenantId: 't1', userId: 'u1' },
      arguments: { input: { targetReturn: 0.1 } },
    };
    const req = request(ctx as any);
    expect(req.update.expression).toContain('#v = if_not_exists(#v, :zero) + :one');
    expect(req.update.expressionNames['#v']).toBe('__version');
  });
```

> If the existing tests reference the AppSync values via the `appsync-utils-dynamodb` mock (`util.dynamodb.toMapValues` returns the raw object in the mock), assert on `req.update.expressionValues[':one']` too: `expect(req.update.expressionValues[':one']).toBe(1)`. If the mock wraps values, drop that line — the expression + names assertions are sufficient.

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm nx test investor-bff --testPathPatterns=update-goal`
Expected: FAIL — expression does not contain the `__version` increment.

- [ ] **Step 7: Add the increment to `update-goal.fn.js`**

In `src/graphql/js-function/update-goal.fn.js`, extend the `request` function. After the existing `updates.push('updatedAt = :now');` line, add the version increment and register its name/values:

```javascript
  updates.push('updatedAt = :now');
  updates.push('#v = if_not_exists(#v, :zero) + :one');
  names['#v'] = '__version';
  values[':zero'] = 0;
  values[':one'] = 1;

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk, sk: 'InvestorProfile' }),
    update: {
      expression: `SET ${updates.join(', ')}`,
      expressionNames: names,
      expressionValues: util.dynamodb.toMapValues(values),
    },
    condition: { expression: 'attribute_exists(pk)' },
  };
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm nx test investor-bff --testPathPatterns=update-goal`
Expected: PASS.

- [ ] **Step 9: Add a failing assertion that `updateOperatingMode` increments `__version`**

In `test/unit/graphql/update-operating-mode.test.ts`, add:

```typescript
  it('increments __version in the update expression', () => {
    const ctx = { stash: { tenantId: 't1', userId: 'u1' }, arguments: { mode: 'BALANCED' } };
    const req = request(ctx as any);
    expect(req.update.expression).toContain('#v = if_not_exists(#v, :zero) + :one');
    expect(req.update.expressionNames['#v']).toBe('__version');
  });
```

- [ ] **Step 10: Run to verify it fails**

Run: `pnpm nx test investor-bff --testPathPatterns=update-operating-mode`
Expected: FAIL.

- [ ] **Step 11: Add the increment to `update-operating-mode.fn.js`**

In `src/graphql/js-function/update-operating-mode.fn.js`, replace the `update` block of the returned object:

```javascript
    update: {
      expression:
        'SET operatingMode = :mode, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
      expressionNames: { '#ts': 'timestamp', '#v': '__version' },
      expressionValues: util.dynamodb.toMapValues({ ':mode': mode, ':now': now, ':zero': 0, ':one': 1 }),
    },
```

- [ ] **Step 12: Run to verify it passes**

Run: `pnpm nx test investor-bff --testPathPatterns=update-operating-mode`
Expected: PASS.

- [ ] **Step 13: Increment `__version` in `setExecutionMode` (GO_LIVE_CONFIRMED path)**

In `src/repositories/investor-profile.repository.ts`, in `setExecutionMode`, update the InvestorProfile `Update` inside the `transactWrite`:

```typescript
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: 'InvestorProfile' },
              UpdateExpression:
                'SET executionMode = :mode, updatedAt = :now, #ts = :ts, #v = if_not_exists(#v, :zero) + :one',
              ExpressionAttributeNames: { '#ts': 'timestamp', '#v': '__version' },
              ExpressionAttributeValues: { ':mode': toMode, ':now': now, ':ts': now, ':zero': 0, ':one': 1 },
            },
          },
```

- [ ] **Step 14: Run the full investor-bff unit suite**

Run: `pnpm nx test investor-bff`
Expected: PASS (all unit tests green, including the existing `event-listener` / repository tests — `setExecutionMode`'s mocked `transactWrite` test asserts the call happened, not the exact expression, so it stays green).

- [ ] **Step 15: Commit**

```bash
git add services/investor/investor-bff/src/transforms/onboarding-completed.ts \
        services/investor/investor-bff/test/unit/transforms/onboarding-completed.test.ts \
        services/investor/investor-bff/src/graphql/js-function/update-goal.fn.js \
        services/investor/investor-bff/test/unit/graphql/update-goal.test.ts \
        services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js \
        services/investor/investor-bff/test/unit/graphql/update-operating-mode.test.ts \
        services/investor/investor-bff/src/repositories/investor-profile.repository.ts
git commit -m "feat(investor-bff): stamp monotonic __version on InvestorProfile across all live write paths"
```

---

## Task 3: dashboard-bff — InvestorSnapshot → versioned P1 (w2 carry-over)

The producer now stamps `__version` and keeps `onboardingCompletedAt` stable on the full-row CDC subject, so dashboard-bff can do a full-row versioned write without wiping `onboardedAt`.

**Files:**
- Modify: `services/investor/dashboard-bff/src/transforms/investor-snapshot.ts`
- Modify: `services/investor/dashboard-bff/test/unit/transforms/investor-snapshot.test.ts`
- Modify: `services/investor/dashboard-bff/src/read-model-ownership.ts`
- Create: `services/investor/dashboard-bff/tsconfig.type-test.json`
- Create: `services/investor/dashboard-bff/test/types/read-model-ownership.type-test.ts`
- Modify: `services/investor/dashboard-bff/project.json`

- [ ] **Step 1: Rewrite the failing unit test for the versioned InvestorSnapshot transform**

Replace the entire contents of `test/unit/transforms/investor-snapshot.test.ts`:

```typescript
import { projectVersioned } from '@nestfolio/event-processor';
import { investorSnapshot } from '../../../src/transforms/investor-snapshot';

const makeUow = (over: Record<string, unknown> = {}, type = 'INVESTOR_PROFILE_UPDATED') => ({
  event: {
    id: 'e1',
    type,
    timestamp: '2026-02-02T00:00:00.000Z',
    subject: {
      goal: { objective: 'RETIREMENT' },
      riskProfile: { score: 7 },
      operatingMode: 'BALANCED',
      onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
      __version: 5,
      ...over,
    },
    context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
  },
  payload: {},
  record: {},
});

describe('investorSnapshot transform', () => {
  it('returns a projectVersioned InvestorSnapshot intent versioned on payload __version', () => {
    expect(investorSnapshot(makeUow() as Parameters<typeof investorSnapshot>[0])).toEqual(
      projectVersioned('InvestorSnapshot', {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        goalType: 'RETIREMENT',
        riskLevel: '7',
        operatingMode: 'BALANCED',
        onboardedAt: '2026-01-01T00:00:00.000Z',
      }, {
        version: 5,
        overrides: { pk: 'T#t1', sk: 'InvestorSnapshot' },
      }),
    );
  });

  it('reads onboardedAt from the stable payload field on UPDATED events too (not event.timestamp)', () => {
    const intent = investorSnapshot(
      makeUow({}, 'INVESTOR_PROFILE_UPDATED') as Parameters<typeof investorSnapshot>[0],
    ) as { fields: Record<string, unknown> };
    expect(intent.fields.onboardedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns undefined when the producer has not stamped a __version', () => {
    expect(
      investorSnapshot(makeUow({ __version: undefined }) as Parameters<typeof investorSnapshot>[0]),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx test dashboard-bff --testPathPatterns=investor-snapshot`
Expected: FAIL — transform returns a `project` intent, includes no `onboardedAt` on UPDATED, and never returns `undefined`.

- [ ] **Step 3: Migrate the transform to `projectVersioned`**

Replace the entire contents of `src/transforms/investor-snapshot.ts`:

```typescript
import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

/**
 * Versioned P1 projection of the InvestorSnapshot row from the composite
 * InvestorProfile payload (workstream 4).
 *
 * Subscribes to INVESTOR_PROFILE_CREATED and INVESTOR_PROFILE_UPDATED. The CDC
 * publisher in investor-bff emits the entire InvestorProfile row as the event
 * subject — including the producer-stamped monotonic `__version` and the stable
 * `onboardingCompletedAt`. We version-guard on `__version` (a late/duplicate
 * INVESTOR_PROFILE_* event can never clobber newer state) and read `onboardedAt`
 * from the always-present payload field so a full-row write never wipes it.
 *
 * Returns undefined when `__version` is absent (a producer that has not adopted
 * versioning yet) — dropped, not written, mirroring advisory-status.ts.
 */
export const investorSnapshot = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as Record<string, unknown>;

  if (payload.__version === undefined) return undefined;

  const goal = payload.goal as Record<string, unknown> | undefined;
  const riskProfile = payload.riskProfile as Record<string, unknown> | undefined;

  const fields: Record<string, unknown> = {
    tenantId,
    userId,
    region,
  };
  if (goal?.objective !== undefined) fields.goalType = goal.objective;
  if (riskProfile?.score !== undefined) fields.riskLevel = String(riskProfile.score);
  if (payload.operatingMode !== undefined) fields.operatingMode = payload.operatingMode;
  if (payload.onboardingCompletedAt !== undefined) fields.onboardedAt = payload.onboardingCompletedAt;

  return projectVersioned('InvestorSnapshot', fields, {
    version: Number(payload.__version),
    overrides: { pk: `T#${tenantId}`, sk: 'InvestorSnapshot' },
  });
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm nx test dashboard-bff --testPathPatterns=investor-snapshot`
Expected: PASS.

- [ ] **Step 5: Register InvestorSnapshot as P1**

In `src/read-model-ownership.ts`, add `InvestorSnapshot: Projection<'P1'>;` inside the `interface ReadModelOwnership { … }` block (after `PositionSnapshot`), and remove the now-stale "deferred to w4" carry-over note from the file's doc comment:

```typescript
declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    PortfolioSummary: Projection<'P1'>;
    PositionSnapshot: Projection<'P1'>;
    InvestorSnapshot: Projection<'P1'>;
    AdvisoryStatus: Projection<'P3'>;
    Activity: Projection<'P2'>;
  }
}
```

In the doc comment at the top of the file, change the carry-over block to reflect that InvestorSnapshot is now registered. Replace:

```
 * NOT registered (intentional carry-overs, see the w2 plan "Out of scope"):
 *   - InvestorSnapshot → P1 deferred to w4 (producer __version + stable onboardedAt).
 *   - TimeTravelAvailability → untouched.
```

with:

```
 *   - InvestorSnapshot : P1 → projectVersioned (workstream 4 — producer now
 *     stamps __version and keeps onboardingCompletedAt stable).
 *
 * NOT registered (intentional):
 *   - TimeTravelAvailability → untouched.
```

- [ ] **Step 6: Create the isolated typecheck config + trip-wire type-test**

Create `tsconfig.type-test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/read-model-ownership.ts", "test/types/**/*.ts"]
}
```

Create `test/types/read-model-ownership.type-test.ts`:

```typescript
/**
 * Compile-time proof of dashboard-bff's ReadModelOwnership enforcement.
 * Verified by: pnpm nx run dashboard-bff:typecheck. Every @ts-expect-error MUST fire.
 */
import { project, accumulate, record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// P1 — projectVersioned only.
projectVersioned('PortfolioSummary', { a: 1 }, { version: 1 });
projectVersioned('PositionSnapshot', { a: 1 }, { version: 1 });
projectVersioned('InvestorSnapshot', { a: 1 }, { version: 1 });
// @ts-expect-error InvestorSnapshot is P1 — unconditional project() is forbidden
project('InvestorSnapshot', { a: 1 });
// @ts-expect-error PortfolioSummary is P1 — project() is forbidden
project('PortfolioSummary', { a: 1 });

// P3 — projectVersioned of the announced aggregate; never accumulate.
projectVersioned('AdvisoryStatus', { pendingDecisionsCount: 1 }, { version: 1 });
// @ts-expect-error AdvisoryStatus is a projection — accumulate is forbidden
accumulate('AdvisoryStatus', { field: 'pendingDecisionsCount', increment: 1 });

// P2 — append log via record.
record('Activity', { activityId: 'a1' });
// @ts-expect-error Activity is an append log (P2), not a versioned projection
projectVersioned('Activity', { a: 1 }, { version: 1 });

export {};
```

- [ ] **Step 7: Add the `typecheck` target to dashboard-bff project.json**

In `services/investor/dashboard-bff/project.json`, add after the `lint` target:

```json
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc --noEmit -p services/investor/dashboard-bff/tsconfig.type-test.json"
      }
    }
```

(If `project.json` has no `lint` target with a trailing position, add `typecheck` as the last entry of the `"targets"` object — ensure valid JSON commas.)

- [ ] **Step 8: Run the dashboard-bff typecheck gate — expect GREEN, then negative-check**

Run: `pnpm nx run dashboard-bff:typecheck`
Expected: PASS.

Negative check: delete the `// @ts-expect-error` above `project('InvestorSnapshot', { a: 1 });`, re-run → expect FAIL (`not assignable to parameter of type 'never'`), then **restore the line** and confirm GREEN.

- [ ] **Step 9: Run the dashboard-bff unit suite**

Run: `pnpm nx test dashboard-bff`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add services/investor/dashboard-bff/src/transforms/investor-snapshot.ts \
        services/investor/dashboard-bff/test/unit/transforms/investor-snapshot.test.ts \
        services/investor/dashboard-bff/src/read-model-ownership.ts \
        services/investor/dashboard-bff/tsconfig.type-test.json \
        services/investor/dashboard-bff/test/types/read-model-ownership.type-test.ts \
        services/investor/dashboard-bff/project.json
git commit -m "feat(dashboard-bff): InvestorSnapshot versioned P1 projection + ownership registration (w2 carry-over)"
```

---

## Task 4: investor-bff — integration assertions for `__version`

Prove end-to-end (against the materialization pipeline) that CashBalance and InvestorProfile carry `__version`.

**Files:**
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

- [ ] **Step 1: Version-guard the CashBalance materialization assertion**

In `test/integration/investor-bff.integration.test.ts`, in the `should materialize CashBalance on BALANCE_UPDATED` test (~line 115), add a `snapshot.lastEventSequence` to the injected event `detail` and assert `__version` on the materialized row. Change the `detail` object and the assertions:

```typescript
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          tenantId: ctx.tenantId,
          userId,
          cashBalanceCents: 500_000,
          snapshot: { positions: {}, cashBalanceCents: 500_000, lastEventSequence: 7 },
        },
      });
```

and after the existing `expect(item['cashBalanceCents']).toBe(500_000);`:

```typescript
      expect(item['__typename']).toBe('CashBalance');
      expect(item['cashBalanceCents']).toBe(500_000);
      expect(item['__version']).toBe(7);
```

- [ ] **Step 2: Assert seed `__version: 1` on the InvestorProfile row**

In the onboarding/composite-row test that asserts `profile['onboardingCompletedAt']` (~line 247), add directly after it:

```typescript
      expect(profile['onboardingCompletedAt']).toBeDefined();
      expect(profile['__version']).toBe(1);
```

- [ ] **Step 3: Assert `__version` increments past 1 after an updateGoal mutation**

In the `should update goal on composite row and emit INVESTOR_PROFILE_UPDATED` test (~line 481), after the mutation completes and the row is re-read, assert the version advanced. Add an assertion on the re-fetched profile row (use the test's existing helper `getInvestorProfileItems(ctx.tenantId, userId)` to fetch the `sk === 'InvestorProfile'` row after the mutation):

```typescript
      const after = (await getInvestorProfileItems(ctx.tenantId, userId)).find((i) => i['sk'] === 'InvestorProfile')!;
      expect(Number(after['__version'])).toBeGreaterThan(1);
```

> If this test does not already re-read the row post-mutation, insert the fetch immediately before the assertion. The seed wrote `__version: 1`; the `updateGoal` resolver's `if_not_exists(#v,:zero)+:one` makes it `2`.

- [ ] **Step 4: Run the investor-bff integration suite**

Run: `pnpm nx run investor-bff:test-integration`
Expected: PASS. (Integration tests use the real dev pipeline; auto-run per [[feedback-integration-tests-auto-run]]. This is part of the closing-phase validation but run it here to confirm the new assertions before committing.)

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit -m "test(investor-bff): assert __version on CashBalance + InvestorProfile materialization"
```

---

## Task 5: File the dead-repository-method cleanup finding

Not a code change — a file-and-continue side-finding ([[feedback-no-cleanup-during-migration]]).

- [ ] **Step 1: File a parking backlog item**

Invoke the `backlog-add` skill to create `docs/backlog/investor-bff-dead-repo-mutate-methods.md` (status `parking`) with body: "`InvestorProfileRepository` `setGoal`/`updateGoal`/`grantMandate`/`setOperatingMode`/`upsertReadOnlyBalance` have no live callers — the live profile mutations are AppSync JS resolvers (`update-goal.fn.js`, `update-operating-mode.fn.js`) and the live balance write is the `balance-updated` projection. Surfaced during w4. `upsertReadOnlyBalance` writes `CashBalance`, now a ledger-owned P1 projection, so it is also an ownership violation if ever wired. Promote on next investor-bff touch." Then state in chat what was filed and continue.

---

## Validation gate (closing phase — executed by /backlog-next steps 6.2–6.4)

1. **`pnpm nx affected -t test,lint --base=origin/main`** — all affected unit/lint green.
2. **`pnpm nx run investor-bff:typecheck` and `pnpm nx run dashboard-bff:typecheck`** — both GREEN (the ownership trip-wires; NOT in the `test,lint` gate, run explicitly).
3. **Deploy** both touched services to dev: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,dashboard-bff`.
4. **`pnpm nx run investor-bff:test-integration`** and **`pnpm nx run dashboard-bff:test-integration`** — green against deployed dev.
5. **Scoped e2e** — the investor/onboarding + dashboard-snapshot flows only (NOT the full suite, NOT Playwright): the e2e-feature scenarios that exercise onboarding → InvestorProfile/InvestorSnapshot materialization and BALANCE_UPDATED → CashBalance. Pick the involved scenarios by name via `JEST_NAME` ([[feedback-e2e-nx-wrapper-strips-quotes]]). A fail-then-pass on rerun is a real failure — pull CloudWatch evidence from the failing window before continuing ([[feedback-flake-means-broken]]).

`validation_gate:` in the backlog file is filled with the concrete commit SHAs + the deploy log line + the integ/e2e command output.

---

## Self-review

- **Spec coverage** (spec §"Decomposition" step 4 + §"Per-row classification"): CashBalance → P1 ✔ (Task 1); command rows confirmed + registered ✔ (Task 1 registry + the rows already use field-level `update()` + `attribute_exists` conditions + `record()` seed, verified in exploration); InvestorProfile `__version` carry-over ✔ (Task 2); dashboard InvestorSnapshot → P1 ✔ (Task 3). Externally-settled rows correctly deferred to w5.
- **Placeholder scan:** every code step shows full literal code; every run step has an exact command + expected result. No TBD/“similar to”.
- **Type consistency:** `projectVersioned(typename, fields, { version, overrides })` used identically across Tasks 1/3 and matches the real signature (`src/intents/project-versioned.ts`). `__version` reserved attribute (`#v`) consistent across seed, both resolvers, `setExecutionMode`, and the projectVersioned executor. Ownership tags (`Projection<'P1'>` / `CommandOwned`) match the exported types. `expectVersionedWrite`/`expectStaleDrop` signatures match `@nestfolio/test-support`.
- **Known intermediate states:** after Task 1, dashboard's `InvestorSnapshot` is still `project()` (unregistered) until Task 3 — independent services, each self-consistent per commit. The producer `__version` (Task 2) and the consumer migration (Task 3) only meet at the deploy/e2e gate; their unit tests are independent (each controls its own payload).
