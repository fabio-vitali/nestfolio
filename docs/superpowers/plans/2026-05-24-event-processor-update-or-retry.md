# event-processor `updateOrRetry()` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `updateOrRetry()` event-processor intent factory that throws ConditionalCheckFailed (rather than silently swallowing it) so SQS redrives the message until the precondition holds. Swap advisory-bff's `decisionStatusChanged` transform to use it — fixes the silent loss of status transitions arriving before the row exists.

**Architecture:** Two-piece change. (1) Library: extend `UpdateIntent` with an optional `onConditionFail: 'skip' | 'retry'` discriminant, add a new `updateOrRetry()` factory that sets it to `'retry'`, and branch in `IntentExecutor.executeUpdate` to re-throw on `ConditionalCheckFailedException` when the policy is retry. Existing `update({condition})` keeps its current `deduplicated: true` semantic — the new behavior is opt-in. (2) Service: change one call site in `services/advisory/advisory-bff/src/transforms/decision-status-changed.ts` from `update()` to `updateOrRetry()` and update the corresponding unit test expectations. Add one integration test that emits `DECISION_BLOCKED` before `DECISION_PACKET_CREATED` and asserts the final `status: 'BLOCKED'`.

**Tech Stack:** TypeScript, AWS DynamoDB DocumentClient, EventBridge, `@nestfolio/event-processor` (in-repo lib), Jest, `aws-sdk-client-mock`, integration harness `@nestfolio/test-support` (`EventBridgeClient`, `TableHelpers.waitForItem`).

**Spec:** `docs/superpowers/specs/2026-05-24-event-processor-update-or-retry-design.md`

**Workstream:** `docs/backlog/new-investor-happy-path-pending-at-decision-confirm.md`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `libs/event-processor/src/types/write-intent.ts` | Modify | Add `onConditionFail?: 'skip' \| 'retry'` to `UpdateIntent` |
| `libs/event-processor/src/intents/update-or-retry.ts` | Create | New `updateOrRetry()` factory |
| `libs/event-processor/src/intents/index.ts` | Modify | Re-export `updateOrRetry` |
| `libs/event-processor/src/index.ts` | Modify | Public re-export of `updateOrRetry` |
| `libs/event-processor/src/engine/intent-executor.ts` | Modify | Branch on `intent.onConditionFail === 'retry'` |
| `libs/event-processor/test/intents/intents.test.ts` | Modify | Tests for `updateOrRetry()` factory |
| `libs/event-processor/test/engine/intent-executor.test.ts` | Modify | Tests for executor retry branch |
| `services/advisory/advisory-bff/src/transforms/decision-status-changed.ts` | Modify | Swap `update()` → `updateOrRetry()` |
| `services/advisory/advisory-bff/test/unit/transforms/decision-status-changed.test.ts` | Modify | Update 5 expectation blocks |
| `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts` | Modify | Add out-of-order delivery test |

---

## Task 1: Add `onConditionFail` field to `UpdateIntent` type

**Files:**
- Modify: `libs/event-processor/src/types/write-intent.ts:29-38`

This is a type-only change. No tests yet — they come with the factory (Task 2) and executor branch (Task 3).

- [ ] **Step 1: Extend UpdateIntent**

Open `libs/event-processor/src/types/write-intent.ts` and replace lines 29-38:

```ts
export interface UpdateIntent {
  readonly _tag: 'update';
  readonly typename: string;
  readonly updates: Record<string, unknown>;
  readonly removes?: string[];
  readonly condition?: string;
  readonly conditionNames?: Record<string, string>;
  readonly conditionValues?: Record<string, unknown>;
  readonly overrides?: KeyOverrides;
  /**
   * Behavior on ConditionalCheckFailedException when `condition` is set.
   * - 'skip' (default, also when undefined) — return
   *   `{ success: true, deduplicated: true }` so SQS treats the message
   *   as terminal. Use for dedup / skip-if-not-X patterns.
   * - 'retry' — re-throw so SQS redrives the message. Use for
   *   wait-until-X patterns where the precondition is expected to
   *   become true on a subsequent delivery (e.g., another event
   *   creates the row first). Set via the `updateOrRetry()` factory;
   *   never set directly via `update()` opts.
   */
  readonly onConditionFail?: 'skip' | 'retry';
}
```

- [ ] **Step 2: Type-check the lib**

Run: `pnpm nx run event-processor:lint && pnpm nx run event-processor:test --runInBand`
Expected: PASS — existing tests still green; the new optional field doesn't break them.

- [ ] **Step 3: Commit**

```bash
git add libs/event-processor/src/types/write-intent.ts
git commit -m "feat(event-processor): add onConditionFail discriminant to UpdateIntent

Optional 'skip' | 'retry' policy on UpdateIntent that the executor
will branch on. Default behavior is unchanged ('skip' === undefined).
The 'retry' policy is reserved for the updateOrRetry() factory.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add `updateOrRetry()` factory

**Files:**
- Create: `libs/event-processor/src/intents/update-or-retry.ts`
- Modify: `libs/event-processor/src/intents/index.ts`
- Modify: `libs/event-processor/src/index.ts`
- Test: `libs/event-processor/test/intents/intents.test.ts`

- [ ] **Step 1: Write failing tests in `libs/event-processor/test/intents/intents.test.ts`**

Append at the end of the file (after line 111, the close of `describe('update()')` block, line 110 is `});` for update's last `it`, line 111 is `});` for the describe):

```ts
describe('updateOrRetry()', () => {
  it('should create an UpdateIntent with onConditionFail: retry', () => {
    const intent = updateOrRetry('DecisionReadModel', { status: 'BLOCKED' }, {
      condition: 'attribute_exists(pk)',
    });
    expect(intent).toEqual({
      _tag: 'update',
      typename: 'DecisionReadModel',
      updates: { status: 'BLOCKED' },
      condition: 'attribute_exists(pk)',
      onConditionFail: 'retry',
    });
  });

  it('should preserve removes, overrides, conditionNames, conditionValues', () => {
    const intent = updateOrRetry('DecisionReadModel', { status: 'APPROVED' }, {
      condition: 'attribute_exists(pk) AND #v = :v',
      conditionNames: { '#v': 'version' },
      conditionValues: { ':v': 1 },
      removes: ['tempField'],
      overrides: { pk: 'Decision#t#d', sk: 'DecisionReadModel' },
    });
    expect(intent).toEqual({
      _tag: 'update',
      typename: 'DecisionReadModel',
      updates: { status: 'APPROVED' },
      condition: 'attribute_exists(pk) AND #v = :v',
      conditionNames: { '#v': 'version' },
      conditionValues: { ':v': 1 },
      removes: ['tempField'],
      overrides: { pk: 'Decision#t#d', sk: 'DecisionReadModel' },
      onConditionFail: 'retry',
    });
  });
});
```

Also add to the imports at the top of the file (line 6 currently imports `update`):

```ts
import { update } from '../../src/intents/update';
import { updateOrRetry } from '../../src/intents/update-or-retry';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run event-processor:test --testPathPatterns intents.test`
Expected: FAIL — module `../../src/intents/update-or-retry` does not exist.

- [ ] **Step 3: Create the factory file**

Create `libs/event-processor/src/intents/update-or-retry.ts`:

```ts
import type { UpdateIntent, KeyOverrides } from '../types/write-intent';

/**
 * Like update() but throws ConditionalCheckFailedException instead of
 * returning `{ success: true, deduplicated: true }` when the condition
 * fails. SQS will redrive the message until the precondition holds (or
 * maxReceiveCount is exhausted → DLQ).
 *
 * Use when the condition expresses a precondition that must hold for the
 * write to make sense — e.g., advisory-bff's status updates that should
 * wait for DECISION_PACKET_CREATED to land before applying.
 *
 * For the dedup / skip-if-not-X semantic, keep using update({condition}).
 */
export function updateOrRetry(
  typename: string,
  updates: Record<string, unknown>,
  options: {
    condition: string;
    removes?: string[];
    conditionNames?: Record<string, string>;
    conditionValues?: Record<string, unknown>;
    overrides?: KeyOverrides;
  },
): UpdateIntent {
  return {
    _tag: 'update',
    typename,
    updates,
    condition: options.condition,
    onConditionFail: 'retry',
    ...(options.removes ? { removes: options.removes } : {}),
    ...(options.conditionNames ? { conditionNames: options.conditionNames } : {}),
    ...(options.conditionValues ? { conditionValues: options.conditionValues } : {}),
    ...(options.overrides ? { overrides: options.overrides } : {}),
  };
}
```

- [ ] **Step 4: Add internal re-export in `libs/event-processor/src/intents/index.ts`**

Open `libs/event-processor/src/intents/index.ts` and append (verify the existing pattern uses `export { update } from './update';`):

```ts
export { updateOrRetry } from './update-or-retry';
```

- [ ] **Step 5: Add public re-export in `libs/event-processor/src/index.ts`**

Open `libs/event-processor/src/index.ts`, find the line `export { update } from './intents/update';` (line 17), and add the new export immediately after:

```ts
export { update } from './intents/update';
export { updateOrRetry } from './intents/update-or-retry';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm nx run event-processor:test --testPathPatterns intents.test`
Expected: PASS — both new tests in `describe('updateOrRetry()')` block green; existing tests untouched.

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/intents/update-or-retry.ts \
        libs/event-processor/src/intents/index.ts \
        libs/event-processor/src/index.ts \
        libs/event-processor/test/intents/intents.test.ts
git commit -m "feat(event-processor): add updateOrRetry() intent factory

Mirrors update() but sets onConditionFail: 'retry' on the produced
UpdateIntent. Behavior change is registered in Task 3 (executor
branch); this commit only adds the factory + tests for the
intent shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Executor branch — throw on ConditionalCheckFailed when retry policy is set

**Files:**
- Modify: `libs/event-processor/src/engine/intent-executor.ts:166-175`
- Test: `libs/event-processor/test/engine/intent-executor.test.ts:192-236` (the existing `describe('update intent')` block)

- [ ] **Step 1: Write failing executor tests**

Open `libs/event-processor/test/engine/intent-executor.test.ts`. Inside the existing `describe('update intent', () => { ... })` block (between line 192 and the closing `});` at line 236), append these tests just before the closing `});`:

```ts
    it('returns deduplicated when ConditionalCheckFailedException and condition set with default policy', async () => {
      const err = new Error('cond-fail');
      err.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejectsOnce(err);

      const intent = update('DecisionPacket', { status: 'BLOCKED' }, {
        condition: 'attribute_exists(pk)',
      });
      const result = await executor.execute(intent, fakeCtx);
      expect(result).toEqual({ _tag: 'update', success: true, deduplicated: true });
    });

    it('rethrows ConditionalCheckFailedException when onConditionFail is retry', async () => {
      const err = new Error('cond-fail');
      err.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejectsOnce(err);

      // Hand-build the intent so we don't depend on Task 2's updateOrRetry
      // factory inside this engine-level test.
      const intent = {
        _tag: 'update' as const,
        typename: 'DecisionReadModel',
        updates: { status: 'BLOCKED' },
        condition: 'attribute_exists(pk)',
        onConditionFail: 'retry' as const,
      };

      await expect(executor.execute(intent, fakeCtx))
        .rejects.toThrow('cond-fail');
    });

    it('rethrows non-ConditionalCheckFailedException regardless of onConditionFail', async () => {
      const err = new Error('throughput-exceeded');
      err.name = 'ProvisionedThroughputExceededException';
      ddbMock.on(UpdateCommand).rejectsOnce(err);

      const intent = {
        _tag: 'update' as const,
        typename: 'DecisionReadModel',
        updates: { status: 'BLOCKED' },
        condition: 'attribute_exists(pk)',
        onConditionFail: 'retry' as const,
      };

      await expect(executor.execute(intent, fakeCtx))
        .rejects.toThrow('throughput-exceeded');
    });
```

- [ ] **Step 2: Run test to verify the new tests fail**

Run: `pnpm nx run event-processor:test --testPathPatterns intent-executor.test`
Expected: the FIRST new test (`returns deduplicated...with default policy`) PASSES (it asserts existing behavior); the SECOND new test (`rethrows...when onConditionFail is retry`) FAILS because the executor currently returns `{ deduplicated: true }` instead of throwing; the THIRD test (`rethrows non-ConditionalCheckFailed...`) PASSES (the existing `throw error` line at the bottom of the catch already rethrows non-ConditionalCheckFailed errors).

- [ ] **Step 3: Implement the branch**

Open `libs/event-processor/src/engine/intent-executor.ts`. Replace lines 166-175 (the current catch block in `executeUpdate`):

```ts
    } catch (error: unknown) {
      // ConditionalCheckFailedException is the no-op signal for guarded
      // updates (matches the executeRecord dedup pattern). Callers express
      // "skip if pre-condition not met" via `condition` rather than reading
      // and branching themselves.
      if (intent.condition && error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return { _tag: 'update', success: true, deduplicated: true };
      }
      throw error;
    }
```

with this new block:

```ts
    } catch (error: unknown) {
      // ConditionalCheckFailedException semantics depend on the caller's
      // policy:
      //
      // - `onConditionFail: 'retry'` (set via updateOrRetry()) — re-throw
      //   so SQS redrives. Used when `condition` expresses a precondition
      //   that should hold on a later delivery, not a dedup check.
      // - `onConditionFail: 'skip'` or undefined (the default via the
      //   `update()` factory) — return `{ success: true, deduplicated:
      //   true }`. Matches executeRecord's putIfNotExists dedup pattern;
      //   callers express "skip if pre-condition not met" via `condition`
      //   without reading and branching themselves.
      if (intent.condition && error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        if (intent.onConditionFail === 'retry') {
          throw error;
        }
        return { _tag: 'update', success: true, deduplicated: true };
      }
      throw error;
    }
```

- [ ] **Step 4: Run test to verify all pass**

Run: `pnpm nx run event-processor:test --testPathPatterns intent-executor.test`
Expected: all tests in `describe('update intent')` PASS. Run the full lib test once more for safety:

Run: `pnpm nx run event-processor:test`
Expected: PASS — every existing test still green; the new tests in update intent describe green.

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/intent-executor.ts \
        libs/event-processor/test/engine/intent-executor.test.ts
git commit -m "feat(event-processor): branch executeUpdate on onConditionFail policy

When onConditionFail is 'retry', ConditionalCheckFailedException is
re-thrown so SQS redrives the message (matches every other intent's
failure model). Default behavior (undefined or 'skip') is unchanged —
existing callers continue to see deduplicated: true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Swap advisory-bff transform to `updateOrRetry`

**Files:**
- Modify: `services/advisory/advisory-bff/src/transforms/decision-status-changed.ts:1,44-50`
- Test: `services/advisory/advisory-bff/test/unit/transforms/decision-status-changed.test.ts:1,17-50`

- [ ] **Step 1: Update the existing unit tests to expect `updateOrRetry`**

Open `services/advisory/advisory-bff/test/unit/transforms/decision-status-changed.test.ts`.

Replace line 1:

```ts
import { update } from '@nestfolio/event-processor';
```

with:

```ts
import { updateOrRetry } from '@nestfolio/event-processor';
```

Replace the 4 `update('DecisionReadModel', ...)` expectations on lines 19-23, 28-32, 37-41, 46-50 (one per status mapping test) with `updateOrRetry('DecisionReadModel', ...)`. The opts shape stays identical — only the factory name changes.

Example for the first one (DECISION_PACKET_UPDATED):

```ts
  it('should map DECISION_PACKET_UPDATED to COMPLIANCE_REVIEW status', () => {
    expect(decisionStatusChanged(makeUow('DECISION_PACKET_UPDATED') as any)).toEqual(
      updateOrRetry('DecisionReadModel', { status: 'COMPLIANCE_REVIEW' }, {
        condition: 'attribute_exists(pk)',
        overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' },
      }),
    );
  });
```

Repeat the same substitution for the three sibling tests (DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMATION_REQUESTED, and the USER_CONFIRMATION_REQUESTED-with-taskToken case on lines 53-62).

Also update the two `ReturnType<typeof update>` annotations on lines 65 and 78 and 87:

```ts
const result = decisionStatusChanged(makeUow('DECISION_APPROVED') as any) as ReturnType<typeof updateOrRetry>;
```

and similarly for the two others.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx run advisory-bff:test --testPathPatterns decision-status-changed.test`
Expected: FAIL — the existing transform returns `update()` output (no `onConditionFail`), the new expectations want `updateOrRetry()` output (`onConditionFail: 'retry'`).

- [ ] **Step 3: Update the transform**

Open `services/advisory/advisory-bff/src/transforms/decision-status-changed.ts`.

Replace line 1:

```ts
import { update, type WriteIntent } from '@nestfolio/event-processor';
```

with:

```ts
import { updateOrRetry, type WriteIntent } from '@nestfolio/event-processor';
```

Replace the return block on lines 44-50:

```ts
  return update('DecisionReadModel', fields, {
    condition: 'attribute_exists(pk)',
    overrides: {
      pk: `Decision#${uow.event.subject.tenantId}#${uow.event.subject.decisionId}`,
      sk: 'DecisionReadModel',
    },
  });
```

with:

```ts
  return updateOrRetry('DecisionReadModel', fields, {
    condition: 'attribute_exists(pk)',
    overrides: {
      pk: `Decision#${uow.event.subject.tenantId}#${uow.event.subject.decisionId}`,
      sk: 'DecisionReadModel',
    },
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx run advisory-bff:test --testPathPatterns decision-status-changed.test`
Expected: PASS — all 8 tests in the file green.

Also run the full unit suite for advisory-bff:

Run: `pnpm nx run advisory-bff:test`
Expected: PASS — no other transform/handler test broken by the import change.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-bff/src/transforms/decision-status-changed.ts \
        services/advisory/advisory-bff/test/unit/transforms/decision-status-changed.test.ts
git commit -m "fix(advisory-bff): use updateOrRetry for status transitions

DECISION_PACKET_UPDATED / DECISION_APPROVED / DECISION_BLOCKED /
USER_CONFIRMATION_REQUESTED can arrive at advisory-bff before
DECISION_PACKET_CREATED creates the row (race between
decision-workflow-ctrl and compliance-ctrl CDC paths). The previous
update({condition: attribute_exists(pk)}) silently swallowed the
ConditionalCheckFailed and acked the SQS message — the status
transition was permanently lost and the row stayed at PENDING.

updateOrRetry() throws on the same exception so SQS redrives the
message; by the time the redelivery hits, the CREATE has typically
landed and the update applies.

Resolves: docs/backlog/new-investor-happy-path-pending-at-decision-confirm.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Integration test — out-of-order delivery (BLOCKED before CREATED)

**Files:**
- Modify: `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`

The existing tests on lines 172-215 (`should update DecisionSummary to BLOCKED on DECISION_BLOCKED`) emit CREATED first, then BLOCKED. We add a sibling test that emits BLOCKED first, waits for the redrive to settle, emits CREATED, and asserts BLOCKED arrives.

- [ ] **Step 1: Locate the insertion point**

Open `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`. Find the existing test `should update DecisionSummary to BLOCKED on DECISION_BLOCKED` (starts line 172, ends line 215 with `}, 120_000);`). Insert the new test immediately after this block.

- [ ] **Step 2: Add the out-of-order test**

Insert this block after line 215:

```ts
    it('should land at BLOCKED when DECISION_BLOCKED arrives before DECISION_PACKET_CREATED (out-of-order delivery)', async () => {
      const decisionId = `integ-blocked-oo-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      // Step 1: emit DECISION_BLOCKED before any DECISION_PACKET_CREATED.
      // With update({condition: attribute_exists(pk)}) this would be silently
      // swallowed as deduplicated: true; with updateOrRetry() it throws
      // ConditionalCheckFailed and SQS redrives the message.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_BLOCKED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
        },
      });

      // Step 2: wait long enough that any silent swallow would have settled,
      // then emit DECISION_PACKET_CREATED. SQS visibility timeout on the
      // advisory-bff event-listener queue means the redrive cycle runs while
      // we wait. 8s is comfortably above the default visibility timeout for
      // event-listener queues in this codebase.
      await new Promise((r) => setTimeout(r, 8_000));

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'DRIFT',
          proposedTrades: [],
          explanation: 'Test for out-of-order BLOCKED',
          confirmationRequired: false,
        },
      });

      // Step 3: assert the row exists AND eventually flips to BLOCKED via the
      // redelivered DECISION_BLOCKED. timeoutMs is wide because SQS redrive
      // backoff can take a couple of cycles to converge once the row exists.
      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk,
        sk: 'DecisionReadModel',
        timeoutMs: 90_000,
        match: { status: 'BLOCKED' },
      });
      expect(item['status']).toBe('BLOCKED');
    }, 180_000);
```

- [ ] **Step 3: Verify lint/typecheck**

Run: `pnpm nx run advisory-bff:lint`
Expected: PASS.

(Do NOT run the integration test yet — it must run against the deployed advisory-bff bundle, and the new code isn't deployed. Task 7 deploys + runs.)

- [ ] **Step 4: Commit**

```bash
git add services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts
git commit -m "test(advisory-bff): integration scenario for out-of-order BLOCKED

Emits DECISION_BLOCKED before DECISION_PACKET_CREATED for the same
(tenant, decisionId). Asserts the row eventually lands at status:
BLOCKED — verifying the updateOrRetry() retry-on-condition-fail path
end-to-end through SQS redrive.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full pre-deploy verification

- [ ] **Step 1: Affected unit tests**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: PASS — covers event-processor + advisory-bff + any downstream lib that uses them.

- [ ] **Step 2: Build advisory-bff bundle**

Run: `pnpm nx run advisory-bff:build`
Expected: PASS — the esbuild bundle picks up the new lib export and the swapped transform.

If build fails, fix root cause (import resolution, type drift) before continuing. Do NOT skip with `--skip-nx-cache`.

---

## Task 7: Deploy + integration validation on dev

- [ ] **Step 1: Deploy advisory-bff (and event-processor library transitively) to dev**

Run:

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff
```

Expected: stack updates with the new bundle. Watch the deploy log for the new Lambda Code SHA on `dev-advisory-bff-IngressHandler*` — confirm it changed from the pre-deploy SHA. The Egress publisher Lambda may also rebuild (same source tree); that's fine.

If the deploy reports "no changes," verify the build artifact timestamp post-Task 6 Step 2 — esbuild may have cached. Force rebuild with:

```bash
pnpm nx run advisory-bff:build --skip-nx-cache && bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff
```

- [ ] **Step 2: Run the affected integration tests**

```bash
pnpm nx affected -t test-integration --base=origin/main
```

Expected: PASS — including the new `should land at BLOCKED when DECISION_BLOCKED arrives before DECISION_PACKET_CREATED` scenario.

If the new test fails, do NOT loop on retries. Pull CloudWatch evidence from the failing window per `feedback_flake_means_broken.md` — query `dev-advisory-bff-IngressHandler*` for the test's `decisionId` and check whether the DECISION_BLOCKED event-listener invocation throws (good — redrive is working) or returns success/deduplicated (the deploy didn't pick up the new code).

- [ ] **Step 3: Sanity-check the existing happy-path integration test still passes**

The advisory-bff integration suite contains the existing in-order BLOCKED test (line 172). Re-running the whole file confirms no regression. The `affected` command in Step 2 already covers it; if you want to scope:

```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm jest services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts
```

Expected: all integration cases PASS, including both the in-order BLOCKED and the new out-of-order BLOCKED.

---

## Task 8: Manual Playwright validation gate (USER)

This step is performed by the user, not by an automated agent. Per `feedback_always_rerun_e2e.md`, `apps/nestfolio-e2e` runs are user-triggered only — NEVER scripted by skills.

- [ ] **Step 1: Notify the user**

When all preceding tasks pass, post a message to the user with this exact prompt:

> Implementation + integration validation complete. Please run the new-investor-happy-path Playwright scenario manually to close the validation gate:
> ```
> NESTFOLIO_INTEG_PREFIX=dev pnpm nx run nestfolio-e2e:e2e -- --grep "new-investor-happy-path"
> ```
> Expected: the test should reach Step 10 (`advisory.page.confirm()`) and either (a) pass through to logout if compliance APPROVED+L2 and AWAITING_CONFIRMATION fires, or (b) fail with status badge = 'BLOCKED' (not 'PENDING'). The latter means this fix works AND surfaces the separately-tracked Bug C (LLM non-determinism vs suitability cap). PENDING means the fix didn't propagate — capture the failing tenant ID and CloudWatch link.

- [ ] **Step 2: Wait for user confirmation before proceeding to the closing phase**

Do NOT mark the workstream shipped until the user confirms the Playwright run reached at least the badge transition (either AWAITING_CONFIRMATION or BLOCKED). Stuck at PENDING = fix incomplete.

---

## Task 9: Workstream closing phase (backlog-next §6)

- [ ] **Step 1: Mark dossier shipped**

Open `docs/backlog/new-investor-happy-path-pending-at-decision-confirm.md`. Change `status: active` to `status: shipped`. Fill `validation_gate:` with concrete evidence:

```yaml
validation_gate: |
  - unit: pnpm nx affected -t test,lint --base=origin/main → PASS (commit <SHA from Task 3>)
  - integration: out-of-order BLOCKED scenario passed on dev (commit <SHA from Task 5>)
  - deploy: dev-advisory-bff-IngressHandler Code SHA updated <pre-SHA> → <post-SHA>
  - manual Playwright: new-investor-happy-path reached <AWAITING_CONFIRMATION | BLOCKED> badge transition on <date>
```

Commit:

```bash
git add docs/backlog/new-investor-happy-path-pending-at-decision-confirm.md
git commit -m "docs(backlog): ship new-investor-happy-path-pending-at-decision-confirm

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 2: Regenerate the index**

Run: `node .claude/skills/backlog-lint/lint.mjs --fix`
Expected: rules pass; `docs/BACKLOG.md` updated to show this workstream in "Recently Shipped".

```bash
git add docs/BACKLOG.md
git commit -m "docs(backlog): regen index after shipping silent-dedup fix

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: File the two out-of-scope side findings as new backlog entries**

Use the `backlog-add` skill twice to file:

1. `assemble-packet-narrative-explainability-key-mismatch` (`type: bug`) — AssemblePacket reads `narrative.explainability.rationale` but advisory-narrative-ctrl spreads explainability at the top level. References `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts:83-87` and `services/advisory/advisory-narrative-ctrl/src/agent-service.ts:143`. **status: queued** (it affects whether the e2e suite sees the real rationale on the UI).

2. `e2e-test-tolerance-or-agent-constraint-against-suitability-block` (`type: bug` or `type: design`) — The new-investor-happy-path Playwright scenario assumes AWAITING_CONFIRMATION as terminal, but the LLM can produce equity allocations that legitimately violate the SuitabilityChecker risk-score cap. Two paths: (a) constrain agents to produce compliant allocations (deterministic spec), or (b) widen the test to accept BLOCKED + assert the badge transitions correctly either way. **status: queued** (also blocks e2e green).

Both go to QUEUED, not parking, per `feedback_e2e_gaps_queued_not_parking.md`.

- [ ] **Step 4: Route to finishing-a-development-branch**

Invoke `superpowers:finishing-a-development-branch` to handle merge / PR / cleanup. Do NOT manually `gh pr create` / `gh pr merge` — the skill manages branch deletion, FF reconciliation, and the post-merge ExitWorktree warning explanation.

- [ ] **Step 5: After the merge skill returns — ExitWorktree explicitly**

Per backlog-next §6.8, the worktree session must be exited explicitly even after `finishing-a-development-branch` cleans the on-disk worktree:

```
ExitWorktree({ action: "remove", discard_changes: true })
```

The "discard N commits permanently" warning is expected after a clean squash/FF merge — the commit contents are on `main`. Verify with:

```bash
git merge-base --is-ancestor worktree-advisory-bff-status-update-silent-dedup-fix main
```

Exit 0 → safe to remove.

---

## Self-review notes

- **Spec coverage:** ✅ Every section of the spec maps to at least one task:
  - "Public API" → Tasks 1 + 2 (type + factory).
  - "Executor branch" → Task 3.
  - "Call-site change" → Task 4.
  - "Behavior on SQS redrive" → Task 5 (integration scenario validates redrive convergence).
  - "Idempotency" → covered implicitly by Task 5 + the existing in-order BLOCKED test (no double-application).
  - "Out of scope" → Task 9 Step 3 (files the two side findings).
  - "Testing strategy" sections (8 tests) → split across Tasks 2 (intent shape × 2), Task 3 (executor × 3), Task 4 (transform × 1 effective swap), Task 5 (integration × 1).
  - "Validation gate" → Tasks 6, 7, 8.

- **Placeholder scan:** no TBDs, no TODOs, every code block is complete.

- **Type consistency:** `updateOrRetry()` factory has the same parameter shape across Task 2 (definition), Task 4 (call-site), and Task 5 (test expectation). `onConditionFail` is `'skip' | 'retry'` everywhere. `UpdateIntent._tag` stays `'update'` (no new discriminator at the executor switch).

- **Validation gate is honored:** Task 8 explicitly bounces Playwright to the user (no automated run).
