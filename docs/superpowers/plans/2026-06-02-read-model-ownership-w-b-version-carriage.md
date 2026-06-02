# WS-B — `__version` Carriage on Producer Events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stamp a monotonic version on the producer-owned rows that feed downstream `Projection<'P1'>` consumers, so WS-C can convert those consumers to `projectVersioned`.

**Architecture:** Atomic per-row `__version` via DynamoDB `ADD #__version :1` (`update(..., { add: { __version: 1 } })`); CDC-as-outbox carries it top-level on the emitted event with no extra publish code (the new-image is the event `subject`). `decision-workflow-ctrl`'s `DecisionPacket` is the reference. Ledger keeps its existing `lastEventSequence` (a deliberate, documented exception — already the version source for `CashBalance`).

**Tech Stack:** TypeScript, `@nestfolio/event-processor` (intent factories + CDC pipeline), AppSync JS resolvers, DynamoDB Streams → EventBridge, Jest (unit + integration via `EventBusTrap`), Nx, CDK.

---

## Context & Settled Decisions

This plan implements **WS-B** of `read-model-ownership-producer-aggregates` (design: `docs/superpowers/specs/2026-06-01-read-model-ownership-producer-aggregates-design.md` §"WS-B"). Code reconnaissance corrected the design's stated scope; the corrections were confirmed with the user (2026-06-02):

| Producer (design listed) | Reality found in code | WS-B action |
|---|---|---|
| investor-bff `Mandate` | **No `__version` anywhere** (issue Put + revoke resolver) | **CODE** — stamp on issue + bump on revoke |
| market-intelligence-ctrl `MarketSnapshot` | `update()` upsert, no `__version` | **CODE** — add `{ add: { __version: 1 } }` ×2 |
| investor-profile-ctrl `InvestorProfileSnapshot` | `record()` create-only on a **per-cycle** row → every rebuild silently `CCFEx`'d, `_UPDATED` never fires, snapshot frozen at onboarding (same bug MI-ctrl already fixed) | **CODE** — switch `record()` → `update()` upsert + `{ add: { __version: 1 } }` (design-prescribed; fixes the latent staleness bug) |
| investor-bff `InvestorProfile` | **Already increments** `__version` (shipped in w4: `update-goal`/`update-operating-mode`/`setExecutionMode` resolvers do `SET #v = if_not_exists(#v,:zero)+:one`; seed `__version: 1`) | **VERIFY-ONLY** — integration assertion, no code |
| ledger-ctrl `LEDGER_ENTRY_RECORDED` | **Already carries `lastEventSequence`** (`snapshot-to-events.ts:61-66`), already the version source for `CashBalance` P1 | **VERIFY-ONLY** — keep `lastEventSequence` (grandfathered), document it, integration assertion, no code |

**User decisions (AskUserQuestion, 2026-06-02):**
1. Ledger keeps `lastEventSequence` (no redundant `__version` alias); document the exception in `READ-MODEL-OWNERSHIP.md §3`.
2. Include the IP-ctrl `record()`→`update()` switch in WS-B (it is required for `__version` to be meaningful and fixes the latent staleness bug).

**Why there is no type violation from the mixed field names:** `projectVersioned(typename, fields, { version })` takes a numeric `version` at the *consumer* call site — it does not constrain the *source event* field name. Events are free-form payloads; no type requires a source event to carry `__version`. The reserved `__version` attribute is what the executor stamps on the *projected* row. So ledger emitting `lastEventSequence` is type-safe; the consumer maps it.

**The atomic-increment mechanism (verified in code):**
- `update(typename, updates, { add: { __version: 1 } })` → executor emits `... ADD #a0 :a0` where `#a0`→`__version`, `:a0`→`1` (`libs/event-processor/src/engine/intent-executor.ts:190-201`). `update()` with no `condition` is a DDB `UpdateItem` upsert: on the first write `ADD` on the absent attribute yields `__version = 1`; subsequent writes increment. No separate seed write needed for the `update()` path.
- For a `transactWrite` `Put` seed (Mandate issue) and an AppSync JS resolver (Mandate revoke), there is no intent factory — stamp `__version: 1` as a plain attribute on the Put, and bump via `SET #v = if_not_exists(#v, :zero) + :one` in the resolver (matching the existing InvestorProfile resolvers).
- CDC carries it automatically: `change-data-capture.ts:127` sets the event `subject` to the full new-image when no `transform` is configured (all four services here configure none).

## Out of Scope (do not touch in WS-B)
- Consumer `projectVersioned` conversions (WS-C) — this WS only makes the version available at source.
- The dead `InvestorProfileRepository.revokeMandate()` method (`investor-profile.repository.ts:202`, no live callers — verified by grep) — tracked by `investor-bff-dead-repo-mutate-methods`.
- The `READ-MODEL-OWNERSHIP.md §9` per-row producer table — WS-D's job. WS-B touches only §3.
- R4 per-service drift-checker scoping (WS-C), the mandatory-error gate (WS-D), broker-ctrl `ExecutionMode` (WS-D).

---

## File Structure

**Modify (code):**
- `services/investor/investor-bff/src/transforms/onboarding-completed.ts` — add `__version: 1` to the Mandate `Put` item.
- `services/investor/investor-bff/src/graphql/js-function/revoke-mandate.fn.js` — bump `__version` in the `UpdateItem` expression.
- `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts` — add `{ add: { __version: 1 } }` to both `update('MarketSnapshot', …)` calls.
- `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts` — import `update`; switch the `InvestorProfileSnapshot` `record()` → `update(..., { add: { __version: 1 }, overrides: {…} })`.
- `services/advisory/investor-profile-ctrl/src/read-model-ownership.ts` — update the stale "written via record()" comment to "written via update() upsert".

**Modify (tests):**
- `services/investor/investor-bff/test/unit/transforms/onboarding-completed.test.ts`
- `services/investor/investor-bff/test/unit/graphql/revoke-mandate.test.ts`
- `services/advisory/market-intelligence-ctrl/test/unit/event-listener.test.ts`
- `services/advisory/investor-profile-ctrl/test/unit/event-listener.test.ts`
- `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`
- `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`
- `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts`
- `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts`

**Modify (docs):**
- `docs/architecture/READ-MODEL-OWNERSHIP.md` — §3 settled per-producer version-source table.
- Service cards regenerated in the closing phase (`audit-service`): investor-bff, market-intelligence-ctrl, investor-profile-ctrl.

---

## Task 1: investor-bff `Mandate` — `__version` carriage

**Files:**
- Modify: `services/investor/investor-bff/src/transforms/onboarding-completed.ts` (the Mandate `Put`, lines 76-97)
- Modify: `services/investor/investor-bff/src/graphql/js-function/revoke-mandate.fn.js`
- Test: `services/investor/investor-bff/test/unit/transforms/onboarding-completed.test.ts`
- Test: `services/investor/investor-bff/test/unit/graphql/revoke-mandate.test.ts`

- [ ] **Step 1: Write the failing unit tests**

In `onboarding-completed.test.ts`, add after the existing Mandate test (after line 53):

```ts
  it('stamps __version: 1 on the seeded Mandate row (WS-B carriage)', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const mandate = items.find((i: any) => i.Put?.Item.sk === 'Mandate').Put.Item;
    expect(mandate.__version).toBe(1);
  });
```

In `revoke-mandate.test.ts`, add inside `describe('revokeMandate resolver', …)`:

```ts
  it('bumps __version atomically on revoke (WS-B carriage)', () => {
    const req = request(baseCtx as any);
    expect(req.update.expression).toMatch(/#v = if_not_exists\(#v, :zero\) \+ :one/);
    expect(req.update.expressionNames['#v']).toBe('__version');
    expect(req.update.expressionValues[':zero'].N).toBe('0');
    expect(req.update.expressionValues[':one'].N).toBe('1');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx run investor-bff:test --testPathPatterns "onboarding-completed|revoke-mandate"`
Expected: FAIL — `mandate.__version` is `undefined`; the revoke expression has no `#v` clause.

- [ ] **Step 3: Implement the Mandate seed `__version`**

In `onboarding-completed.ts`, in the Mandate `Put` `Item` (currently lines 79-95), add `__version: 1` (place it alongside the lifecycle fields, e.g. after `revokedAt: null,`):

```ts
          Item: {
            pk,
            sk: 'Mandate',
            __typename: 'Mandate',
            tenantId: s.tenantId,
            userId: s.userId,
            region: ctx.region,
            mandateId,
            level: mandateLevel,
            status: 'ACTIVE',
            operatingMode: s.operatingMode,
            effectiveDate: now,
            revokedAt: null,
            __version: 1,
            createdAt: now,
            updatedAt: now,
            timestamp: now,
          } satisfies TableEntry,
```

- [ ] **Step 4: Implement the revoke `__version` bump**

In `revoke-mandate.fn.js`, change the `update` block of `request()` to bump `__version` (mirror the InvestorProfile resolvers' `if_not_exists` pattern). The `condition` block is unchanged:

```js
    update: {
      expression: 'SET #status = :revoked, revokedAt = :now, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
      expressionNames: { '#status': 'status', '#ts': 'timestamp', '#v': '__version' },
      expressionValues: util.dynamodb.toMapValues({
        ':revoked': 'REVOKED',
        ':active': 'ACTIVE',
        ':now': now,
        ':zero': 0,
        ':one': 1,
      }),
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm nx run investor-bff:test --testPathPatterns "onboarding-completed|revoke-mandate"`
Expected: PASS (all, including the two new cases).

- [ ] **Step 6: Add the integration assertions (deferred run — validation gate)**

In `investor-bff.integration.test.ts`, the suite already traps `MANDATE_ISSUED`/`MANDATE_REVOKED` (lines 63-71) and waits for `MANDATE_ISSUED` (~line 305-314). Extend the existing onboarding/accept flow to assert the version on the trapped event `subject` (the trapped event detail is `{ subject: <new-image> }`, per the `subject` access at line 126-pattern):

```ts
    const issued = await trap.waitForEvent({ detailType: 'MANDATE_ISSUED', timeoutMs: 90_000 });
    expect((issued.detail as { subject?: Record<string, unknown> }).subject?.['__version']).toBe(1);
```

Add a revoke-flow assertion (call the `revokeMandate` AppSync mutation as the existing revoke test does, then):

```ts
    const revoked = await trap.waitForEvent({ detailType: 'MANDATE_REVOKED', timeoutMs: 90_000 });
    expect((revoked.detail as { subject?: Record<string, unknown> }).subject?.['__version']).toBe(2);
```

(Do not run integration tests yet — Task 6.)

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-bff/src/transforms/onboarding-completed.ts \
        services/investor/investor-bff/src/graphql/js-function/revoke-mandate.fn.js \
        services/investor/investor-bff/test/unit/transforms/onboarding-completed.test.ts \
        services/investor/investor-bff/test/unit/graphql/revoke-mandate.test.ts \
        services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit -m "feat(investor-bff): stamp __version on Mandate issue + revoke (WS-B)"
```

---

## Task 2: market-intelligence-ctrl `MarketSnapshot` — `__version` carriage

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts` (slow-tier `update`, lines 96-109; fast-tier `update`, lines 117-129)
- Test: `services/advisory/market-intelligence-ctrl/test/unit/event-listener.test.ts`

- [ ] **Step 1: Write the failing unit assertions**

In `event-listener.test.ts`, extend the slow-tier assertion (the `objectContaining` for the `MarketSnapshot` update intent, ~lines 100-113) to require the `add` clause, and add a fast-tier assertion. Add to the slow-tier `it` (after the existing `overrides` expectation):

```ts
      const slowIntent = result.find((i): i is { add?: Record<string, number> } =>
        (i as { typename?: string }).typename === 'MarketSnapshot');
      expect(slowIntent?.add).toEqual({ __version: 1 });
```

Add to the fast-tier `it` (after the `overrides` expectation, ~line 199):

```ts
      expect((snapshotIntent as unknown as { add?: Record<string, number> }).add).toEqual({ __version: 1 });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx run market-intelligence-ctrl:test --testPathPatterns event-listener`
Expected: FAIL — the update intents have no `add` field.

- [ ] **Step 3: Implement — add `add` to both `update()` calls**

In `event-listener.ts`, slow-tier (lines 96-109) and fast-tier (lines 117-129), change the options object from `{ overrides: { … } }` to include `add`:

```ts
        { add: { __version: 1 }, overrides: { pk: marketSnapshotPk(region), sk: MARKET_SNAPSHOT_SK } },
```

(apply to both call sites; the `updates` objects are unchanged).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm nx run market-intelligence-ctrl:test --testPathPatterns event-listener`
Expected: PASS.

- [ ] **Step 5: Add the integration assertion (deferred run)**

In `market-intelligence-ctrl.integration.test.ts`, the suite traps `MARKET_SNAPSHOT_UPDATED` and waits for it (~lines 63-65, 141-145). After the existing `waitForEvent` (line 141), add:

```ts
    expect((cdcEvent.detail as { subject?: Record<string, unknown> }).subject?.['__version']).toEqual(expect.any(Number));
```

- [ ] **Step 6: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts \
        services/advisory/market-intelligence-ctrl/test/unit/event-listener.test.ts \
        services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts
git commit -m "feat(market-intelligence-ctrl): stamp __version on MarketSnapshot upsert (WS-B)"
```

---

## Task 3: investor-profile-ctrl `InvestorProfileSnapshot` — `record()` → `update()` upsert + `__version`

> ⚠ **Behavior change.** This converts a create-only write to an upsert. After this, the snapshot **rebuilds every decision cycle** (it currently freezes at onboarding because `record()`'s `attribute_not_exists(pk)` silently drops every rebuild), and `INVESTOR_PROFILE_SNAPSHOT_UPDATED` **starts firing**. This is the design-prescribed fix and a correctness improvement (the advisory agents currently read a stale profile snapshot). Idempotency on a duplicate `eventId` is preserved by the handler's pre-existing `DuplicateInvocationError` guard (returns `[]` before the write), not by `record()`.

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts` (import line 3-12; the `record('InvestorProfileSnapshot', …)` call, lines 94-105)
- Modify: `services/advisory/investor-profile-ctrl/src/read-model-ownership.ts` (comment only)
- Test: `services/advisory/investor-profile-ctrl/test/unit/event-listener.test.ts`

- [ ] **Step 1: Update the failing unit assertions**

In `event-listener.test.ts`, the three handler tests assert `{ _tag: 'record', typename: 'InvestorProfileSnapshot', fields: {…} }`. Change each (lines ~105-114, ~198-207, ~233-242) to the `update` shape — `_tag: 'update'`, `updates` instead of `fields`, plus the `add` clause:

```ts
        expect.objectContaining({
          _tag: 'update',
          typename: 'InvestorProfileSnapshot',
          add: { __version: 1 },
          updates: expect.objectContaining({
            tenantId: 't1',
            userId: 'u1',
            sourceEventType: 'INVESTOR_PROFILE_UPDATED', // adjust per test: MANDATE_ISSUED / OPERATING_MODE_CHANGED
            sourceEventId: 'evt-1',                       // adjust per test: evt-mandate-1 / evt-mode-1
          }),
        }),
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx run investor-profile-ctrl:test --testPathPatterns event-listener`
Expected: FAIL — intent is still `_tag: 'record'` with `fields`, not `update`/`updates`/`add`.

- [ ] **Step 3: Implement — import `update` and switch the intent**

In `event-listener.ts`, add `update` to the `@nestfolio/event-processor` import (lines 3-12, alongside `record`). Then change the snapshot intent (lines 94-105) from `record` to `update`:

```ts
    update(
      'InvestorProfileSnapshot',
      {
        tenantId,
        userId,
        agentOutput: result,
        sourceEventId: ctx.eventId,
        sourceEventType,
        agentInvocationId: ctx.eventId,
      },
      { add: { __version: 1 }, overrides: { pk: investorProfileSnapshotPk(tenantId, userId), sk: INVESTOR_PROFILE_SNAPSHOT_SK } },
    ),
```

(The `record('AgentInvocation', …)` intent above it is unchanged — `AgentInvocation` is append-only.)

- [ ] **Step 4: Update the ownership comment**

In `read-model-ownership.ts`, change the comment "CommandOwned (own-aggregate written via record())" to "CommandOwned (own-aggregate written via update() upsert + atomic __version)". The `InvestorProfileSnapshot: CommandOwned` tag is unchanged (`update` is allowed for `CommandOwned`).

- [ ] **Step 5: Run unit tests + the ownership typecheck trip-wire**

Run: `pnpm nx run investor-profile-ctrl:test --testPathPatterns event-listener`
Expected: PASS.
Run: `pnpm nx run investor-profile-ctrl:typecheck`
Expected: PASS (the `update('InvestorProfileSnapshot', …)` call satisfies the `CommandOwned` constraint; `projectVersioned` would have failed but we use `update`).

- [ ] **Step 6: Add the integration assertion — the behavior-change regression test (deferred run)**

In `investor-profile-ctrl.integration.test.ts`, the suite traps both `INVESTOR_PROFILE_SNAPSHOT_CREATED` and `_UPDATED` (lines 64-65). Extend the existing first-materialization test to assert `subject.__version` is present, and add a new test that a **second** trigger for the same `(tenantId, userId)` now fires `INVESTOR_PROFILE_SNAPSHOT_UPDATED` with an incremented version (this fails on `main` today — the rebuild was silently dropped):

```ts
  it('rebuilds on a second trigger → INVESTOR_PROFILE_SNAPSHOT_UPDATED with __version 2 (WS-B)', async () => {
    // inject the first trigger (CREATED, __version 1) then a second (UPDATED, __version 2),
    // mirroring the existing single-trigger test's setup in this file.
    const updated = await trap.waitForEvent({
      detailType: 'INVESTOR_PROFILE_SNAPSHOT_UPDATED',
      match: (detail) => (detail as { subject?: Record<string, unknown> }).subject?.['userId'] === userId,
      timeoutMs: 150_000,
    });
    const subject = (updated.detail as { subject?: Record<string, unknown> }).subject!;
    expect(subject['__version']).toBe(2);
  });
```

Also confirm the IP-ctrl **resilience** suite (`investor-profile-ctrl.resilience.integration.test.ts`) has no assertion that depends on create-only dedupe semantics (duplicate-`eventId` idempotency is still covered by the `DuplicateInvocationError` short-circuit). Adjust only if such an assertion exists.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts \
        services/advisory/investor-profile-ctrl/src/read-model-ownership.ts \
        services/advisory/investor-profile-ctrl/test/unit/event-listener.test.ts \
        services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts
git commit -m "fix(investor-profile-ctrl): InvestorProfileSnapshot record()->update() upsert + __version (WS-B)

Create-only record() silently dropped every per-cycle rebuild (CCFEx), freezing
the snapshot at onboarding and never firing INVESTOR_PROFILE_SNAPSHOT_UPDATED.
Switch to update() upsert with atomic __version so the snapshot rebuilds and
carries a monotonic version for WS-C's projectVersioned conversion."
```

---

## Task 4: Verify-only (ledger + investor-bff InvestorProfile) + canonical doc §3

**Files:**
- Modify: `docs/architecture/READ-MODEL-OWNERSHIP.md` (§3, lines 50-64)
- Test: `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts`
- Test: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

- [ ] **Step 1: Document the settled per-producer version source in §3**

Replace the stale paragraph at `READ-MODEL-OWNERSHIP.md` lines 57-64 (the "ledger-ctrl … does not yet stamp … w1–w5" text) with:

```markdown
### Per-producer version source (settled — WS-B, 2026-06-02)

Every governed **owned** row that feeds a downstream `Projection<'P1'>` carries a
monotonic version top-level in its emitted events:

| Producer (owner) | Row → event | Version field | Stamp mechanism |
|---|---|---|---|
| decision-workflow-ctrl | `DecisionPacket` → `DECISION_PACKET_*` | `__version` | `update(..., { add: { __version: 1 } })`; seed `__version: 1` |
| investor-bff | `InvestorProfile` → `INVESTOR_PROFILE_*` | `__version` | resolver `SET #v = if_not_exists(#v,:zero)+:one`; seed `__version: 1` |
| investor-bff | `Mandate` → `MANDATE_ISSUED`/`MANDATE_REVOKED` | `__version` | seed `__version: 1` on issue; revoke resolver `if_not_exists(#v,:zero)+:one` |
| market-intelligence-ctrl | `MarketSnapshot` → `MARKET_SNAPSHOT_UPDATED` | `__version` | `update(..., { add: { __version: 1 } })` upsert |
| investor-profile-ctrl | `InvestorProfileSnapshot` → `INVESTOR_PROFILE_SNAPSHOT_*` | `__version` | `update(..., { add: { __version: 1 } })` upsert |
| ledger-ctrl | `LedgerEntryEvent` → `LEDGER_ENTRY_RECORDED` | `lastEventSequence` | reducer-accumulated monotonic sequence |

`ledger-ctrl` is the one **grandfathered exception**: it carries `lastEventSequence`
(its genuinely-monotonic per-`(tenant, streamType)` sequence) rather than a `__version`
attribute. Intentional — `lastEventSequence` predates the convention and is already the
version source for investor-bff's `CashBalance` P1 projection (`projectVersioned` keyed
on `snapshot.lastEventSequence`). A redundant `__version` alias was rejected (two fields,
one value). Consumers of `LEDGER_ENTRY_RECORDED` read `lastEventSequence`; all other P1
consumers read `__version`.

`projectVersioned` takes a numeric `version` argument, **not** a fixed field name, so the
source field name is a consumer-mapping detail and neither choice violates any type. The
reserved `__version` attribute is always the name stamped on the *projected* row.
```

- [ ] **Step 2: Add the ledger verify-only integration assertion (deferred run)**

In `ledger-ctrl.integration.test.ts`, the `LEDGER_ENTRY_RECORDED` CDC chain test waits for the event (~line 477-478). After the existing `detailType` assertion, add:

```ts
    expect((event.detail as { subject?: Record<string, unknown> }).subject?.['lastEventSequence']).toEqual(expect.any(Number));
```

- [ ] **Step 3: Add the investor-bff InvestorProfile verify-only assertion (deferred run)**

`investor-bff.integration.test.ts` already asserts `__version: 1` on `INVESTOR_PROFILE_CREATED` (line ~251-253). Confirm an `OPERATING_MODE_CHANGED`/`INVESTOR_PROFILE_UPDATED` path asserts the version **increments past 1** after a mutation; if absent, add (mirroring the existing update-operating-mode flow in the file):

```ts
    const changed = await trap.waitForEvent({ detailType: 'OPERATING_MODE_CHANGED', timeoutMs: 90_000 });
    expect((changed.detail as { subject?: Record<string, unknown> }).subject?.['__version']).toBeGreaterThan(1);
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/READ-MODEL-OWNERSHIP.md \
        services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts \
        services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit -m "docs(read-model): settle per-producer version source; assert ledger lastEventSequence + investor-bff __version (WS-B)"
```

---

## Task 5: Local verification (no deploy)

- [ ] **Step 1: nx affected unit + lint**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: PASS for investor-bff, market-intelligence-ctrl, investor-profile-ctrl (+ any affected lib consumers).

- [ ] **Step 2: Ownership typecheck trip-wires for the touched services**

Run: `pnpm nx run investor-profile-ctrl:typecheck && pnpm nx run market-intelligence-ctrl:typecheck && pnpm nx run investor-bff:typecheck`
Expected: PASS (these are NOT in the standard `test,lint` gate, so run explicitly).

- [ ] **Step 3: Read-model drift checker stays green**

Run: `pnpm nx run event-processor:read-model-drift`
Expected: PASS (WS-B adds no new typename registrations; tags are unchanged — `update` on `CommandOwned` rows is compliant).

---

## Task 6: Deploy + validation gate + doc regen

> This is the WS-B `validation_gate`. Dev-account ops need no confirmation. Deploy only the three services that changed code (ledger-ctrl + investor-bff `InvestorProfile` are verify-only → no deploy needed for them, but investor-bff IS deployed for the Mandate change).

- [ ] **Step 1: Deploy the touched producers to dev**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,market-intelligence-ctrl,investor-profile-ctrl`
Expected: 3/3 stacks updated.

- [ ] **Step 2: Run affected integration suites**

Run: `pnpm nx affected -t test-integration --base=origin/main`
Expected: PASS — including the new `__version`/`lastEventSequence` assertions and the IP-ctrl second-rebuild `_UPDATED` regression test (Task 3 Step 6), which fails on `main`.

- [ ] **Step 3: Run the involved e2e scenarios only (Jest e2e-feature-tests; NEVER full suite, NEVER Playwright)**

Involved flows: advisory decision pipeline (the IP snapshot now rebuilds per cycle → agents read it), profile mandate/operating-mode (Mandate `__version`), funding/ledger (`lastEventSequence`). Scope via the env-var launcher (a quoted regex on the nx CLI would be stripped → false green; use `JEST_PATH`):

```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
JEST_PATH='advisory/(first-decision|accept-decision)|profile/(revoke-mandate|update-operating-mode)|funding/fund-account' \
pnpm nx run e2e-feature-tests:test-e2e-features
```

Expected: all selected scenarios PASS. If any scenario fails-then-passes on rerun, pull CloudWatch evidence from the failing window before continuing and run a second confirmation pass (flakes are real failures).

- [ ] **Step 4: Regenerate the changed service cards**

The IP-ctrl card states "written via record()" and "continuously-projected" — stale after Task 3. Regenerate the three touched cards:

Run `audit-service` for `investor-profile-ctrl`, `market-intelligence-ctrl`, and `investor-bff`; commit the regenerated `CLAUDE.md` cards in this workstream (source + derived ship together).

```bash
git add services/advisory/investor-profile-ctrl/CLAUDE.md \
        services/advisory/market-intelligence-ctrl/CLAUDE.md \
        services/investor/investor-bff/CLAUDE.md
git commit -m "docs(cards): regenerate cards after WS-B __version carriage"
```

- [ ] **Step 5: Hand back to `/backlog-next` closing phase**

The remaining closing steps (ship the backlog file with `validation_gate` evidence, regen the backlog index, `finishing-a-development-branch`, `ExitWorktree`) are driven by the `backlog-next` skill, not this plan.

---

## Self-Review

**Spec coverage (design §WS-B):**
- investor-bff Mandate `__version` on ISSUED/REVOKED → Task 1. ✓
- Fix hardcoded `InvestorProfile.__version: 1` → already increments (w4); verify-only → Task 4 Step 3. ✓ (corrected scope, user-confirmed)
- investor-profile-ctrl `InvestorProfileSnapshot` stamp + carry, confirm rebuild semantics → Task 3 (rebuild confirmed; record→update). ✓
- market-intelligence-ctrl `MarketSnapshot` stamp + carry → Task 2. ✓
- ledger-ctrl carry `lastEventSequence`/`__version` → already carried; verify-only + document → Task 4. ✓ (user-confirmed: keep `lastEventSequence`)
- Validation gate (deploy + integration + involved e2e) → Task 6. ✓

**Placeholder scan:** every code/test step shows the actual code or exact assertion; deferred-run integration steps cite the existing trap setup to mirror. No TBD/TODO.

**Type consistency:** `update(typename, updates, { add, overrides })` shape is used identically in Tasks 2 and 3 and matches `intent-executor.ts`. `record` intents expose `fields`; `update` intents expose `updates` + `add` — the IP-ctrl test assertions in Task 3 Step 1 switch `fields`→`updates` accordingly. The revoke resolver `#v`→`__version` mapping matches the existing InvestorProfile resolvers.
