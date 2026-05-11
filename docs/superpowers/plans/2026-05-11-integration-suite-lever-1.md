# Integration suite Lever 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut integration-suite wall-clock by adding a predicate primitive to `TableAssertions.waitForItem`, lowering the default poll cadence from 2 s to 500 ms, sweeping every hand-rolled `while…Date.now…waitForItem` loop into a single primitive call, and applying three dossier-gated timeout tightenings.

**Architecture:** One library change (`libs/integration-testing` + `libs/test-support`) plus a mechanical sweep across 5 integration-test files plus three bisectable timeout-tightening commits. No production-handler / infra changes. Validation gate is a wall-clock delta on `pnpm nx run-many -t test-integration --parallel=2` measured before and after in the same session.

**Tech Stack:** TypeScript, Jest, aws-sdk-client-mock (existing unit-test harness for `TableAssertions`), Nx, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-11-integration-suite-lever-1-design.md`

---

## File Map

**Library — modify:**
- `libs/integration-testing/src/fixtures/table-assertions.ts:42-89` — extend `waitForItem` with `predicate` + `description` params, AND with `match`, include last-observed item in timeout error.
- `libs/test-support/src/context.ts:31` — `pollInterval` default `2_000 → 500`.

**Library tests — modify:**
- `libs/integration-testing/test/table-assertions.test.ts` — add `predicate parameter` and `match + predicate` describe blocks following the existing `aws-sdk-client-mock` pattern.

**Service integration tests — sweep (in scope):**
- `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts` (~11 sites, status-flip patterns)
- `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts` (~9 sites, try/catch+waitForItem patterns)
- `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.resilience.integration.test.ts` (1 helper function wrapping `waitForItem`)
- `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts` (1 outer-poll site at `:84` — `:232` uses `queryItems`, out of scope)
- `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts` (4 outer-poll sites — confirm `waitForItem`-wrapping vs `queryItems`-wrapping at each)

**Service integration tests — out of scope** (don't wrap `waitForItem`; would need a different primitive — file as follow-up if needed):
- `services/advisory/decision-workflow-ctrl/test/integration/*.test.ts` — outer poll wraps `ListExecutionsCommand` (Step Functions)
- `services/ledger/ledger-ctrl/test/integration/*.test.ts` — outer poll wraps `countItems` helper (Lever 3 territory)

**Timeout tightenings (three bisectable commits):**
- `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts:64` — `trap.waitForEvent({ timeoutMs: 90_000 })` → `30_000` (NOTIFICATION_CREATED).
- advisory-bff outer-poll timeouts 60 s → 30 s (the sweep already removes the inner 5 s; this tightening shortens the *single remaining* timeout per call site).
- 60 s `waitForItem` timeouts in agent-ctrl integration tests → 20 s:
  - `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts:91`
  - `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts:80`
  - `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts:81`

**Backlog file — update on ship:**
- `docs/backlog/integration-suite-slowness-architecture-levers.md` — `status: active → shipped`, fill `validation_gate:` with wall-clock numbers.
- New queued entries (one per): `integration-suite-lever-2-adapter-warmup`, `integration-suite-lever-3-ledger-ctrl-resilience-consolidation`, `integration-suite-lever-4-parallelism`, `integration-suite-lever-5-cdk-bundling`.

---

## Task 1: Capture pre-baseline integration-suite wall-clock

**Files:**
- Create: `/tmp/integ-pre-lever-1.log` (transient — kept in `/tmp/`, not committed).

- [ ] **Step 1: Confirm clean working tree on the worktree branch.**

Run: `git status`
Expected: working tree clean (worktree just branched off the spec commit).

- [ ] **Step 2: Run the full integration suite to capture pre-baseline wall-clock.**

Run:
```bash
time pnpm nx run-many -t test-integration --parallel=2 2>&1 | tee /tmp/integ-pre-lever-1.log
```

This is long (~50–55 min on the dossier baseline; could be shorter now that ranks 1–6 closed). Do NOT background it — the wall-clock measurement is the point.

Expected: all suites green (we're measuring against post-rank-6 truth, not the inflated dossier numbers). If any suite is red, STOP and file the failure as a separate backlog item before proceeding — Lever 1 measurement is invalid if the suite is failing.

- [ ] **Step 3: Record the headline numbers.**

Extract from the log:
```bash
grep "Successfully ran target\|wall-clock\|real " /tmp/integ-pre-lever-1.log | tail -5
```

Note the wall-clock figure in a working scratchpad — this is the number Task 13 compares against. No commit.

---

## Task 2: Extend `waitForItem` with predicate + description (TDD)

**Files:**
- Modify: `libs/integration-testing/src/fixtures/table-assertions.ts:42-89`
- Modify: `libs/integration-testing/test/table-assertions.test.ts`

- [ ] **Step 1: Add a failing test — predicate-only happy path.**

Append to `libs/integration-testing/test/table-assertions.test.ts` after the existing `describe('TableAssertions.waitForItem — match parameter', …)` block:

```ts
describe('TableAssertions.waitForItem — predicate parameter', () => {
  it('returns item when predicate returns true', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', status: 'APPROVED' }),
    });

    const assertions = new TableAssertions(makeCtx());
    const item = await assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      predicate: (i) => i['status'] === 'APPROVED',
      description: 'status === APPROVED',
    });
    expect(item['status']).toBe('APPROVED');
  });

  it('keeps polling when predicate returns false, resolves once it returns true', async () => {
    ddbMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', status: 'PENDING' }) })
      .resolvesOnce({ Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', status: 'PENDING' }) })
      .resolves({ Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', status: 'APPROVED' }) });

    const assertions = new TableAssertions(makeCtx());
    const item = await assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      predicate: (i) => i['status'] === 'APPROVED',
    });
    expect(item['status']).toBe('APPROVED');
  });

  it('AND-combines match and predicate: both must be satisfied', async () => {
    ddbMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', kind: 'X', status: 'PENDING' }) })
      .resolves({ Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', kind: 'X', status: 'APPROVED' }) });

    const assertions = new TableAssertions(makeCtx());
    const item = await assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      match: { kind: 'X' },
      predicate: (i) => i['status'] === 'APPROVED',
    });
    expect(item['status']).toBe('APPROVED');
  });

  it('on timeout: error includes last observed item and predicate description', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', status: 'PENDING' }),
    });

    const assertions = new TableAssertions(makeCtx());
    await expect(assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      timeoutMs: 200,
      pollIntervalMs: 50,
      predicate: (i) => i['status'] === 'APPROVED',
      description: 'status === APPROVED',
    })).rejects.toThrow(/predicate: "status === APPROVED".*Last item.*"status":"PENDING"/s);
  });

  it('on timeout with no description: predicate label says "(unlabeled)"', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', status: 'PENDING' }),
    });

    const assertions = new TableAssertions(makeCtx());
    await expect(assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      timeoutMs: 200,
      pollIntervalMs: 50,
      predicate: (i) => i['status'] === 'APPROVED',
    })).rejects.toThrow(/predicate: "\(unlabeled\)"/);
  });

  it('on timeout with no item ever observed: Last item label says "(never observed)"', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: undefined });

    const assertions = new TableAssertions(makeCtx());
    await expect(assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      timeoutMs: 200,
      pollIntervalMs: 50,
      predicate: (i) => i['status'] === 'APPROVED',
      description: 'status === APPROVED',
    })).rejects.toThrow(/Last item: \(never observed\)/);
  });

  it('predicate exceptions surface immediately (not retried)', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel' }),
    });

    const assertions = new TableAssertions(makeCtx());
    await expect(assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      timeoutMs: 1_000,
      predicate: () => { throw new Error('boom'); },
    })).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run:
```bash
pnpm nx run integration-testing:test --testPathPatterns=table-assertions
```

Expected: 7 new tests fail (predicate param not yet supported by implementation).

- [ ] **Step 3: Implement predicate + description in `waitForItem`.**

Edit `libs/integration-testing/src/fixtures/table-assertions.ts:42-89`. Replace the entire method body:

```ts
async waitForItem(params: {
  table: string;
  pk: string;
  sk?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  match?: Record<string, unknown>;
  predicate?: (item: Record<string, unknown>) => boolean;
  description?: string;
}): Promise<Record<string, unknown>> {
  const timeout = params.timeoutMs ?? this.ctx.timings.eventTimeout;
  const pollInterval = params.pollIntervalMs ?? this.ctx.timings.pollInterval;
  const deadline = Date.now() + timeout;
  const tableName = await this.ctx.ssm.tableName(params.table);

  let lastObserved: Record<string, unknown> | undefined;

  while (Date.now() < deadline) {
    let item: Record<string, unknown> | undefined;

    if (params.sk) {
      const result = await this.client.send(new GetItemCommand({
        TableName: tableName,
        Key: marshall({ pk: params.pk, sk: params.sk }),
      }));
      if (result.Item) item = unmarshall(result.Item);
    } else {
      const result = await this.client.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: marshall({ ':pk': params.pk }),
        Limit: 1,
      }));
      if (result.Items?.length) item = unmarshall(result.Items[0]);
    }

    if (item) {
      lastObserved = item;
      const matchOk = !params.match || Object.entries(params.match).every(([k, v]) => item![k] === v);
      const predicateOk = !params.predicate || params.predicate(item);
      if (matchOk && predicateOk) {
        this.observed.push({ tableName, pk: item['pk'] as string, sk: item['sk'] as string });
        return item;
      }
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  const matchDesc = params.match ? ` match=${JSON.stringify(params.match)}` : '';
  const predDesc = params.predicate ? ` predicate: "${params.description ?? '(unlabeled)'}"` : '';
  const lastDesc = lastObserved ? JSON.stringify(lastObserved) : '(never observed)';
  throw new Error(
    `TableAssertions: timeout waiting for item pk=${params.pk} sk=${params.sk ?? '(any)'}${matchDesc}${predDesc} in ${params.table} after ${timeout}ms. Last item: ${lastDesc}`
  );
}
```

- [ ] **Step 4: Run tests to verify they pass.**

Run:
```bash
pnpm nx run integration-testing:test --testPathPatterns=table-assertions
```

Expected: all tests pass (existing `match` tests + 7 new predicate tests).

- [ ] **Step 5: Commit.**

```bash
git add libs/integration-testing/src/fixtures/table-assertions.ts libs/integration-testing/test/table-assertions.test.ts
git commit -m "feat(integration-testing): waitForItem predicate + description params"
```

---

## Task 3: Lower default `pollInterval` 2000 → 500 ms

**Files:**
- Modify: `libs/test-support/src/context.ts:31`

- [ ] **Step 1: Edit the default.**

In `libs/test-support/src/context.ts:31`, change:

```ts
pollInterval: overrides?.pollInterval ?? 2_000,
```

to:

```ts
pollInterval: overrides?.pollInterval ?? 500,
```

- [ ] **Step 2: Verify no test-support unit tests rely on the old default.**

Run:
```bash
pnpm nx run test-support:test
```

Expected: green (default-value change should not break tests unless a test asserts the exact default).

- [ ] **Step 3: Commit.**

```bash
git add libs/test-support/src/context.ts
git commit -m "perf(test-support): pollInterval default 2000 -> 500 ms"
```

---

## Task 4: Sweep `advisory-bff` outer-poll loops

**Files:**
- Modify: `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`

This file has ~11 sites of the pattern: pre-existence `waitForItem({timeoutMs: 60_000})` followed by `while (Date.now() < deadline) { item = await waitForItem({timeoutMs: 5_000}); if (item.X === Y) break; await sleep; }`.

**Migration recipe:**
- If outer-poll checks one field for equality (e.g. `item.status === 'APPROVED'`) → migrate to `match: { status: 'APPROVED' }`.
- If outer-poll checks a richer condition (set membership, length, etc.) → migrate to `predicate: (i) => …, description: '…'`.
- Drop the pre-existence `waitForItem` call (the single migrated call subsumes existence + value).
- Drop the outer `while` loop, the inner 5 s `timeoutMs`, the manual `setTimeout` sleep, and the post-loop `expect(item!).toBe(…)` if it's redundant with the assertion already inside `waitForItem`.

- [ ] **Step 1: List every outer-poll site in the file.**

Run:
```bash
grep -n "while.*Date\.now\|while.*deadline" services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts
```

Expected: ~11 line numbers. Cross-check by reading 30 lines of context around each.

- [ ] **Step 2: Migrate the first site (lines ~94–127) as the reference pattern.**

Before (representative — actual line numbers may shift):

```ts
await table.waitForItem({
  table: 'advisory-bff',
  pk: `Decision#${ctx.tenantId}#${decisionId}`,
  sk: 'DecisionReadModel',
  timeoutMs: 60_000,
});

// Now send DECISION_APPROVED — update() with condition: attribute_exists(pk)
await eb.putEvent({ /* ... */ });

// Poll until status flips to APPROVED (waitForItem only checks existence, not value)
const deadline = Date.now() + 60_000;
let item: Record<string, unknown> | undefined;
while (Date.now() < deadline) {
  item = await table.waitForItem({
    table: 'advisory-bff',
    pk: `Decision#${ctx.tenantId}#${decisionId}`,
    sk: 'DecisionReadModel',
    timeoutMs: 5_000,
  });
  if (item['status'] === 'APPROVED') break;
  await new Promise(r => setTimeout(r, 3_000));
}

expect(item!['status']).toBe('APPROVED');
```

After:

```ts
// Wait for DecisionReadModel to exist (created by DECISION_PACKET_CREATED handler)
await table.waitForItem({
  table: 'advisory-bff',
  pk: `Decision#${ctx.tenantId}#${decisionId}`,
  sk: 'DecisionReadModel',
  timeoutMs: 60_000,
});

// Now send DECISION_APPROVED — update() with condition: attribute_exists(pk)
await eb.putEvent({ /* ... */ });

// Wait for the status flip (single primitive call replaces the outer poll loop)
const item = await table.waitForItem({
  table: 'advisory-bff',
  pk: `Decision#${ctx.tenantId}#${decisionId}`,
  sk: 'DecisionReadModel',
  timeoutMs: 60_000,
  match: { status: 'APPROVED' },
});

expect(item['status']).toBe('APPROVED');
```

Note: the pre-existence wait stays (semantically meaningful — separates "creation" from "approval"). Only the outer-poll → single call.

- [ ] **Step 3: Migrate all remaining outer-poll sites in the file.**

Apply the recipe to each site identified in Step 1. For each, classify as `match:` (equality) or `predicate:` (richer). If unsure, copy the inner `if (item.X === Y) break;` expression into a `predicate:` callback and add a `description:` matching the source-code form.

- [ ] **Step 4: Run the file's integration tests.**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run advisory-bff:test-integration
```

Expected: all advisory-bff integration tests green. If any fail, the migration of that test is wrong — re-read the original outer-poll logic and fix.

- [ ] **Step 5: Commit.**

```bash
git add services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts
git commit -m "refactor(advisory-bff): collapse waitForItem outer-poll loops to single primitive call"
```

---

## Task 5: Sweep `compliance-ctrl` integration outer-poll loops

**Files:**
- Modify: `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`

This file uses a different shape — `try { item = await waitForItem({timeoutMs: 5_000}); if (item.X === Y) break; } catch { … }` — where the catch handles the "row doesn't exist yet" case by retrying. After migration, the single `waitForItem` call with longer timeout + `match`/`predicate` subsumes both states.

- [ ] **Step 1: List every outer-poll site.**

Run:
```bash
grep -n "while.*Date\.now\|while.*deadline" services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts
```

Expected: ~9 sites.

- [ ] **Step 2: Migrate the first site (lines ~103–131) as reference.**

Before:

```ts
// Poll for THIS test's mandateId — handler may run multiple times if the
// SQS Lambda redelivers, but each carries the same mandateId so the
// assertion is stable.
let item: Record<string, unknown> | undefined;
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  try {
    item = await table.waitForItem({
      table: 'compliance-ctrl',
      pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
      sk: 'MandateSnapshot',
      timeoutMs: 5_000,
    });
    if (item['mandateId'] === mandateId) break;
  } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 2_000));
}
if (!item || item['mandateId'] !== mandateId) {
  throw new Error(`MandateSnapshot did not project mandateId=${mandateId} within 90s`);
}

expect(item['mandateId']).toBe(mandateId);
expect(item['level']).toBe('DISCRETIONARY');
// ... more expects
```

After:

```ts
// Poll for THIS test's mandateId — handler may run multiple times if the
// SQS Lambda redelivers, but each carries the same mandateId so the
// assertion is stable.
const item = await table.waitForItem({
  table: 'compliance-ctrl',
  pk: `GuardrailPolicy#${ctx.tenantId}#${userId}`,
  sk: 'MandateSnapshot',
  timeoutMs: 90_000,
  match: { mandateId },
});

expect(item['mandateId']).toBe(mandateId);
expect(item['level']).toBe('DISCRETIONARY');
// ... more expects (unchanged — they verify the projected row contents)
```

The try/catch, outer loop, manual sleep, and the redundant null-guard throw all disappear — single `waitForItem` with `match: { mandateId }` handles both "row absent" and "row present but mandateId mismatch" via its own internal poll. The subsequent `expect(item['level']).toBe(...)` lines stay — they're verifying additional projected fields, not the wait condition.

- [ ] **Step 3: Migrate all remaining sites in the file.**

Apply the same pattern. The 9 sites mostly differ in `pk` and which `match`/`predicate` they need.

- [ ] **Step 4: Run integration tests.**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run compliance-ctrl:test-integration
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts
git commit -m "refactor(compliance-ctrl): collapse waitForItem outer-poll loops to single primitive call"
```

---

## Task 6: Sweep `compliance-ctrl` resilience helper

**Files:**
- Modify: `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.resilience.integration.test.ts`

This file has one helper function (lines ~44–) wrapping `waitForItem` in an outer poll. Refactor the helper to call `waitForItem` once with the appropriate `match`/`predicate`.

- [ ] **Step 1: Read the existing helper.**

Read lines 40–80 of the file to understand its signature and call sites.

- [ ] **Step 2: Refactor the helper body to a single `waitForItem` call.**

Replace the outer `while…try { waitForItem(timeoutMs: 5_000) } catch … sleep` with one `waitForItem({ timeoutMs, match: { … } })` or `predicate:` call, depending on what the helper currently checks.

- [ ] **Step 3: Verify call sites still type-check.**

Run:
```bash
pnpm nx run compliance-ctrl:typecheck 2>&1 | tail -20
```

(Or `nx run-many -t typecheck --projects=compliance-ctrl` if `typecheck` isn't a target.)

Expected: green.

- [ ] **Step 4: Run integration tests.**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run compliance-ctrl:test-integration
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add services/advisory/compliance-ctrl/test/integration/compliance-ctrl.resilience.integration.test.ts
git commit -m "refactor(compliance-ctrl): collapse resilience helper outer poll into waitForItem call"
```

---

## Task 7: Sweep `dashboard-bff` `waitForItem`-wrapping outer poll

**Files:**
- Modify: `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`

Only the outer-poll site at line ~83 wraps `waitForItem`. The other while-loop (line ~232) wraps `queryItems` — leave it alone (out of scope).

- [ ] **Step 1: Read the in-scope site (lines ~80–100).**

Identify the field being checked and pick `match:` vs `predicate:`.

- [ ] **Step 2: Migrate it to a single `waitForItem` call.**

Follow the Task 4 recipe.

- [ ] **Step 3: Run integration tests.**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run dashboard-bff:test-integration
```

Expected: green.

- [ ] **Step 4: Commit.**

```bash
git add services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts
git commit -m "refactor(dashboard-bff): collapse waitForItem outer-poll loop to single primitive call"
```

---

## Task 8: Sweep `investor-bff` `waitForItem`-wrapping outer polls

**Files:**
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

Four outer-poll sites at lines ~223, ~340, ~738, ~886. For each, verify whether it wraps `waitForItem` (in scope) or another primitive (out of scope — skip).

- [ ] **Step 1: Classify each of the 4 sites.**

Run:
```bash
for L in 223 340 738 886; do
  echo "=== Line $L ==="
  sed -n "$((L-1)),$((L+15))p" services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
done
```

For each: is the body `waitForItem` (in scope) or something else (skip and leave alone)?

- [ ] **Step 2: Migrate every in-scope site.**

Follow the Task 4 / Task 5 recipe per site.

- [ ] **Step 3: Run integration tests.**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run investor-bff:test-integration
```

Expected: green.

- [ ] **Step 4: Commit.**

```bash
git add services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit -m "refactor(investor-bff): collapse waitForItem outer-poll loops to single primitive call"
```

---

## Task 9: Tighten `EventBusTrap` 90 s → 30 s (NOTIFICATION_CREATED)

**Files:**
- Modify: `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts:64`

- [ ] **Step 1: Locate the exact line.**

Run:
```bash
grep -n "trap.waitForEvent.*90_000" services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts
```

Expected: one match at line 64.

- [ ] **Step 2: Edit.**

Change `timeoutMs: 90_000` to `timeoutMs: 30_000` on that line.

- [ ] **Step 3: Run the affected suite.**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run compliance-ctrl:test-integration
```

Expected: green. The 30 s value should comfortably cover real-world CDC convergence (5–15 s).

- [ ] **Step 4: Commit.**

```bash
git add services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts
git commit -m "perf(compliance-ctrl): tighten NOTIFICATION_CREATED waitForEvent 90s -> 30s"
```

---

## Task 10: Tighten advisory-bff outer-poll timeouts 60 s → 30 s

**Files:**
- Modify: `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`

After Task 4's sweep, each migrated call site uses one timeout (the outer 60 s). Lower those to 30 s — observed convergence ≤ 22 s per the dossier.

- [ ] **Step 1: List the post-sweep 60 s sites.**

Run:
```bash
grep -n "timeoutMs:\s*60_000" services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts
```

Expected: multiple sites (the ones touched in Task 4 plus pre-existence waits).

- [ ] **Step 2: Edit each `60_000` to `30_000` in the file.**

Use a single sed-style replace OR per-line edit — both work since the pattern is unambiguous in this file's context. Per-line edit is safer; verify by re-running the grep after.

- [ ] **Step 3: Run the affected suite.**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run advisory-bff:test-integration
```

Expected: green.

- [ ] **Step 4: Commit.**

```bash
git add services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts
git commit -m "perf(advisory-bff): tighten waitForItem outer timeouts 60s -> 30s"
```

---

## Task 11: Tighten agent-ctrl `waitForItem` 60 s → 20 s

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts:91`
- Modify: `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts:80`
- Modify: `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts:81`

Rationale: these agent-ctrls do a synchronous DDB write inside the handler — once the event reaches the Lambda, the row is there. 60 s was overcautious.

- [ ] **Step 1: Confirm each line is `timeoutMs: 60_000` on a `waitForItem` call.**

Run:
```bash
sed -n "91p" services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts
sed -n "80p" services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts
sed -n "81p" services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts
```

Expected: each line shows `timeoutMs: 60_000,`. If a line has drifted, locate the current line for the same call.

- [ ] **Step 2: Change `60_000 → 20_000` on each line.**

- [ ] **Step 3: Run the three affected suites.**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many -t test-integration --projects=investor-profile-ctrl,market-intelligence-ctrl,advisory-narrative-ctrl
```

Expected: green.

- [ ] **Step 4: Commit.**

```bash
git add services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts \
        services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts \
        services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts
git commit -m "perf(agent-ctrls): tighten waitForItem 60s -> 20s on synchronous handler writes"
```

---

## Task 12: Capture post-baseline + per-suite delta report

**Files:**
- Create: `/tmp/integ-post-lever-1.log` (transient).

- [ ] **Step 1: Run the full integration suite to capture post-baseline wall-clock.**

Run:
```bash
time pnpm nx run-many -t test-integration --parallel=2 2>&1 | tee /tmp/integ-post-lever-1.log
```

Expected: all suites green.

- [ ] **Step 2: Compute per-suite wall-clock delta.**

Run:
```bash
grep -E "test-integration.*[0-9]+(\.[0-9]+)?\s*s" /tmp/integ-pre-lever-1.log > /tmp/pre-suite-times.txt
grep -E "test-integration.*[0-9]+(\.[0-9]+)?\s*s" /tmp/integ-post-lever-1.log > /tmp/post-suite-times.txt
diff -u /tmp/pre-suite-times.txt /tmp/post-suite-times.txt
```

(Nx output format may need slight adjustment to this regex — the goal is per-project wall-clock lines for comparison.)

- [ ] **Step 3: Record headline numbers in scratchpad.**

Note: aggregate wall-clock pre, aggregate post, delta, count of suites improved / regressed / unchanged. This will go into the validation_gate of the backlog file in Task 14.

No commit (transient logs).

---

## Task 13: Validation gate — run integration suite twice for stability

**Files:** none modified.

- [ ] **Step 1: Re-run integration suite a second time.**

Run:
```bash
time pnpm nx run-many -t test-integration --parallel=2 2>&1 | tee /tmp/integ-post-lever-1-run2.log
```

Expected: all suites green; no new flakes vs `/tmp/integ-post-lever-1.log`.

- [ ] **Step 2: Confirm gate criteria.**

Verify:
- Aggregate wall-clock delta (post vs pre) ≥ −60 s improvement.
- No individual suite wall-clock regresses by > 5 s vs pre-baseline.
- Both post-runs are green; no new flakes.

If any criterion fails, STOP and triage — the spec's gate is not met. Likely culprits: a tightened timeout was too aggressive (revert that single commit), or the 500 ms cadence is throttling a specific suite (apply a per-suite `pollInterval` override).

If all criteria pass, proceed to Task 14.

No commit.

---

## Task 14: Ship the workstream — update backlog, refile Levers 2–5

**Files:**
- Modify: `docs/backlog/integration-suite-slowness-architecture-levers.md` (frontmatter).
- Create: `docs/backlog/integration-suite-lever-2-adapter-warmup.md`
- Create: `docs/backlog/integration-suite-lever-3-ledger-ctrl-resilience-consolidation.md`
- Create: `docs/backlog/integration-suite-lever-4-parallelism.md`
- Create: `docs/backlog/integration-suite-lever-5-cdk-bundling.md`
- Auto-modified by lint: `docs/BACKLOG.md`.

- [ ] **Step 1: Update the active backlog entry to shipped.**

Edit `docs/backlog/integration-suite-slowness-architecture-levers.md` frontmatter:

```yaml
---
id: integration-suite-slowness-architecture-levers
status: shipped
type: refactor
notes: "Diagnostic dossier on integration-suite wall-clock. Lever 1 shipped 2026-05-11; Levers 2–5 refiled as separate queued entries."
references:
  - docs/superpowers/specs/2026-05-11-integration-suite-lever-1-design.md
  - docs/superpowers/plans/2026-05-11-integration-suite-lever-1.md
out_of_scope:
  - "Lever 2 (adapter Lambda cold-start warmup) — refiled"
  - "Lever 3 (ledger-ctrl resilience it.each consolidation) — refiled"
  - "Lever 4 (--parallel=4) — refiled"
  - "Lever 5 (CDK bundling tax in the unit suite) — refiled"
spec: docs/superpowers/specs/2026-05-11-integration-suite-lever-1-design.md
plan: docs/superpowers/plans/2026-05-11-integration-suite-lever-1.md
topic_memory: []
validation_gate: "Lever 1 shipped: aggregate wall-clock <PRE> -> <POST> (delta <DELTA>). No individual suite regressed > 5 s. Two consecutive post-runs green. Per-suite breakdown in PR description."
closed: "2026-05-11"
---
```

Fill `<PRE>`, `<POST>`, `<DELTA>` with the headline numbers from Task 12.

- [ ] **Step 2: Refile Levers 2–5 using `backlog-add`.**

Invoke the `backlog-add` skill four times — one per lever. Each entry uses `status: queued`, `type: refactor`, points to the original dossier file as the reference for context. The skill creates the file + runs lint --fix.

(If the backlog-add skill isn't available in the executing context, manually create the four files with proper frontmatter and run lint --fix below.)

- [ ] **Step 3: Run backlog-lint --fix.**

Run:
```bash
node .claude/skills/backlog-lint/lint.mjs --fix
```

Expected: `✓ 84 backlog files; all 7 rules pass (with --fix applied)` (or whatever total after the 4 new files).

- [ ] **Step 4: Commit.**

```bash
git add docs/backlog/integration-suite-slowness-architecture-levers.md \
        docs/backlog/integration-suite-lever-2-adapter-warmup.md \
        docs/backlog/integration-suite-lever-3-ledger-ctrl-resilience-consolidation.md \
        docs/backlog/integration-suite-lever-4-parallelism.md \
        docs/backlog/integration-suite-lever-5-cdk-bundling.md \
        docs/BACKLOG.md
git commit -m "$(cat <<'EOF'
docs(backlog): Lever 1 shipped; refile Levers 2-5 as separate queued entries

Per spec docs/superpowers/specs/2026-05-11-integration-suite-lever-1-design.md.
Validation gate: aggregate wall-clock <PRE> -> <POST> (delta <DELTA>).
EOF
)"
```

---

## Task 15: Open PR with per-suite delta in description

**Files:** none modified.

- [ ] **Step 1: Push branch.**

Run:
```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: Create PR.**

Use the standard `gh pr create` form. PR body must include:
- Spec + plan paths.
- Aggregate wall-clock delta (PRE / POST / DELTA).
- Per-suite delta table (from Task 12 step 2).
- Re-run #2 confirmation that no new flakes appeared.
- List of timeout tightenings with rationale for each.

- [ ] **Step 3: Confirm CI green.**

Wait for PR checks. If anything fails, triage in a follow-up commit on the branch.

---

## Notes for the executor

- **Worktree discipline:** This plan assumes you're on an isolated worktree. If you're not, STOP and create one (`using-git-worktrees` skill) before Task 2.
- **Sweep ordering:** Tasks 4–8 are mostly independent. If running subagent-driven, they can be dispatched in parallel after Task 2 + 3 land; but each task's commit must be sequenced into the same branch.
- **Tightening reversibility:** Tasks 9, 10, 11 are deliberately separate commits so a single `git revert` can roll back one tightening without losing the others.
- **Don't tighten before sweeping:** the tightenings assume the sweep has happened (the 5 s inner timeout is gone, the call-site uses a single `waitForItem` per assertion). Reversing order will hide where wall-clock came from.
- **Per-suite override path:** if Task 13 reveals a specific suite hit DDB throttling at 500 ms cadence, the per-test fix is `createTestContext({ pollInterval: 2000 })` in that suite's setup — don't revert the global default.
