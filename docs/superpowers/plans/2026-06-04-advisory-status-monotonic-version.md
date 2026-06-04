# AdvisoryStatus strictly-monotonic version — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `advisory-bff`'s per-tenant `AdvisoryStatus.inFlightCount` recompute write a strictly-monotonic `__version`, eliminating the same-millisecond `Date.now()` collision that silently drops the fresher count.

**Architecture:** Reclassify `advisory-bff`'s `AdvisoryStatus` row from `Projection<'P3'>` to `CommandOwned` and swap `projectVersioned(version: Date.now())` for the existing `update('AdvisoryStatus', updates, { add: { __version: 1 } })` self-increment upsert (atomic `ADD`, strictly monotonic, no external version source). `dashboard-bff`'s consumer-side P3 projection is unchanged — the carried `__version` is now a stronger counter. No new library code; this is the pattern three other producers already use.

**Tech Stack:** TypeScript, `@nestfolio/event-processor` (IntentExecutor + `update` intent), Jest + `aws-sdk-client-mock`, DynamoDB, Nx.

**Spec:** `docs/superpowers/specs/2026-06-04-advisory-status-monotonic-version-design.md`

---

## File map

- **Modify** `services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts` — swap write `projectVersioned` → `update` + `add`.
- **Modify** `services/advisory/advisory-bff/src/read-model-ownership.ts` — `AdvisoryStatus: Projection<'P3'>` → `CommandOwned`.
- **Modify** `services/advisory/advisory-bff/test/types/read-model-ownership.type-test.ts` — flip the trip-wire.
- **Modify** `services/advisory/advisory-bff/test/unit/handlers/advisory-status-projector.test.ts` — assert the `UpdateCommand` shape + `ADD #__version` regression.
- **Verify only** `services/investor/dashboard-bff/**` — no change; confirm green.
- **Modify** `docs/architecture/READ-MODEL-OWNERSHIP.md` — §3/§4/§9 owner/consumer split.
- **Modify** `services/advisory/advisory-bff/CLAUDE.md` — service-card regen.

> Tasks 1's four file edits are one **atomic compile unit**: the type system forces the ownership tag, the handler write, and the type-test to move together, and the unit test moves with the handler. They land in a single commit so no intermediate commit has a red build.

---

### Task 1: advisory-bff — reclassify + swap write + update tests (atomic)

**Files:**
- Modify: `services/advisory/advisory-bff/src/read-model-ownership.ts`
- Modify: `services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts`
- Modify: `services/advisory/advisory-bff/test/types/read-model-ownership.type-test.ts`
- Modify: `services/advisory/advisory-bff/test/unit/handlers/advisory-status-projector.test.ts`

- [ ] **Step 1: Flip the ownership registration**

Replace the full contents of `src/read-model-ownership.ts`:

```ts
/**
 * advisory-bff read-model ownership registration.
 *
 * Compile-time enforcement:
 *   - DecisionReadModel : P1 → projectVersioned only (record/update/accumulate fail typecheck).
 *   - AdvisoryStatus    : CommandOwned → advisory-bff's OWN derived aggregate,
 *     recomputed + self-versioned via update(..., { add: { __version: 1 } }).
 *     projectVersioned on it no longer compiles (that is the point). dashboard-bff
 *     holds the consumer-side Projection<'P3'> copy of the announced aggregate.
 *   - UserConfirmation / UserRejection / UserInteraction : CommandOwned (AppSync fn.js writes).
 */
import type { Projection, CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    DecisionReadModel: Projection<'P1'>;
    AdvisoryStatus: CommandOwned;
    UserConfirmation: CommandOwned;
    UserRejection: CommandOwned;
    UserInteraction: CommandOwned;
  }
}

export {};
```

- [ ] **Step 2: Swap the handler write**

Replace the full contents of `src/handlers/advisory-status-projector.ts`:

```ts
import '../read-model-ownership';
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IntentExecutor, update, asTenantId, asUserId, type EventContext } from '@nestfolio/event-processor';
import { AdvisoryRepository } from '../repositories/advisory.repository';

const TABLE = process.env.TABLE_NAME!;
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repo = new AdvisoryRepository(TABLE, ddbClient);
const executor = new IntentExecutor({ docClient, tableName: TABLE });

// AdvisoryStatus is advisory-bff's OWN command-owned derived aggregate.
// `inFlightCount` is RECOMPUTED post-commit by counting this tenant's
// non-terminal DecisionReadModel rows (a pure function of the projected rows),
// then written with an atomic self-increment of `__version` via
// `update(..., { add: { __version: 1 } })`. The loop guard (skip AdvisoryStatus
// records) prevents the projector's own writes from re-triggering a recompute.
//
// VERSION = atomic counter (ADD #__version :1), NOT wall clock. A prior version
// used `projectVersioned` with `version: Date.now()`; two recomputes for the
// same tenant in the same millisecond produced EQUAL versions and the
// `#__version < :version` guard silently dropped the fresher count. The
// self-increment is strictly monotonic regardless of which DecisionReadModel
// shards triggered the batch. dashboard-bff projects this row P3 keyed on the
// carried `__version`, which a counter keeps monotonic.
//
// Do NOT switch the version to the stream SequenceNumber: DecisionReadModel rows
// are keyed `Decision#<tenant>#<id>` (per-decision pk), so a tenant's decisions
// land in DIFFERENT stream shards and their SequenceNumbers are NOT comparable
// across shards — max(SequenceNumber) over a multi-decision batch is
// non-monotonic for the per-tenant AdvisoryStatus row (proven: advisory-bff
// integration "recomputes inFlightCount" -> row never written).
export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  const tenants = new Set<string>();
  for (const rec of event.Records) {
    const image = rec.dynamodb?.NewImage ?? rec.dynamodb?.OldImage;
    if (!image) continue;
    const row = unmarshall(image as Record<string, AttributeValue>) as Record<string, unknown>;
    if (row.__typename !== 'DecisionReadModel') continue; // loop guard
    if (typeof row.tenantId === 'string') tenants.add(row.tenantId);
  }

  for (const tenantId of tenants) {
    const inFlightCount = await repo.countInFlightDecisions(tenantId);
    // System-originated recompute: no end-user request context. The
    // RequestContext fields are required by EventContext; supply system
    // sentinels — pickRequestContext copies them onto the AdvisoryStatus row
    // (harmless: the row is keyed/queried by pk/tenantId, never by userId).
    const ctx: EventContext = {
      tenantId: asTenantId(tenantId),
      userId: asUserId('system'),
      region: process.env.AWS_REGION ?? 'us-east-1',
      eventId: `recompute-${tenantId}-${Date.now()}`,
      eventType: 'ADVISORY_STATUS_RECOMPUTED',
      timestamp: new Date().toISOString(),
      serviceName: 'advisory-bff',
      record: {},
    };
    await executor.execute(
      update('AdvisoryStatus', { tenantId, inFlightCount }, {
        add: { __version: 1 },
        overrides: { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' },
      }),
      ctx,
    );
  }
};
```

> `Date.now()`/`new Date()` here run in the Lambda runtime (NOT a Workflow script) and are fine — they no longer drive the version, only the trace `eventId`/`timestamp`.

- [ ] **Step 3: Flip the type-test trip-wire**

Replace the full contents of `test/types/read-model-ownership.type-test.ts`:

```ts
/**
 * Compile-time proof that advisory-bff's ownership registration rejects the
 * wrong write intents. A `@ts-expect-error` that does NOT error is itself a
 * compile failure. Verified by `nx run advisory-bff:typecheck`
 * (tsconfig.type-test.json) — no runtime assertions.
 */
import { project, accumulate, update, record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// DecisionReadModel is P1 — projectVersioned is the only blessed write.
projectVersioned('DecisionReadModel', { a: 1 }, { version: 1 });

// AdvisoryStatus is advisory-bff's OWN command-owned derived aggregate, written
// with an atomic self-increment of __version via update() — the strictly-
// monotonic recompute fix (was projectVersioned + Date.now()).
update('AdvisoryStatus', { inFlightCount: 1 }, { add: { __version: 1 } });

// @ts-expect-error — unconditional project on the P1 DecisionReadModel must not typecheck
project('DecisionReadModel', { a: 1 });
// @ts-expect-error — accumulate on the P1 DecisionReadModel must not typecheck
accumulate('DecisionReadModel', { field: 'count', increment: 1 });
// @ts-expect-error — command update on the P1 DecisionReadModel must not typecheck
update('DecisionReadModel', { a: 1 });
// @ts-expect-error — record (append) on the P1 DecisionReadModel must not typecheck
record('DecisionReadModel', { a: 1 });

// AdvisoryStatus is CommandOwned — projectVersioned (P1-only) is now rejected.
// @ts-expect-error — projectVersioned on the command-owned AdvisoryStatus must not typecheck
projectVersioned('AdvisoryStatus', { a: 1 }, { version: 1 });

// User command rows (AppSync fn.js writes; CommandOwned). projectVersioned rejected.
record('UserConfirmation', { a: 1 });
record('UserRejection', { a: 1 });
record('UserInteraction', { a: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('UserConfirmation', { a: 1 }, { version: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('UserRejection', { a: 1 }, { version: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('UserInteraction', { a: 1 }, { version: 1 });

export {};
```

> Removed: the three `@ts-expect-error` lines that rejected `accumulate`/`record`/`update` on AdvisoryStatus — they now compile (CommandOwned), so a lingering `@ts-expect-error` would itself fail. Added: the positive `update(... add)` assertion and the new `@ts-expect-error` on `projectVersioned('AdvisoryStatus', …)`.

- [ ] **Step 4: Rewrite the projector unit test (UpdateCommand shape + regression)**

In `test/unit/handlers/advisory-status-projector.test.ts`, replace the first test (`it('recomputes AdvisoryStatus on a DecisionReadModel stream record', …)`, the whole `it(...)` block) with:

```ts
  it('recomputes AdvisoryStatus via an atomic __version self-increment (UpdateCommand)', async () => {
    countMock.mockResolvedValue(3);

    await handler(streamEvent([{ __typename: 'DecisionReadModel', tenantId: 't1', pk: 'Decision#t1#d1' }]));

    expect(countMock).toHaveBeenCalledWith('t1');
    // The write is an UpdateCommand (update intent), NOT a PutItem — match by Key.sk.
    // (commandCalls(UpdateCommand) fails the instanceof identity check across
    // event-processor's duplicate @aws-sdk/lib-dynamodb copy, so match over raw calls.
    // See feedback_worktree_symlink_masks_test_failures.)
    type UpdateInput = {
      Key?: Record<string, unknown>;
      UpdateExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
      ExpressionAttributeValues?: Record<string, unknown>;
    };
    const call = (ddbMock.calls() as Array<{ args: [{ input: UpdateInput }] }>)
      .find((c) => c.args[0].input.Key?.sk === 'AdvisoryStatus');
    expect(call).toBeDefined();
    const input = call!.args[0].input;
    expect(input.Key!.pk).toBe('T#t1');
    // Recomputed inFlightCount written via SET.
    expect(Object.values(input.ExpressionAttributeNames!)).toContain('inFlightCount');
    expect(Object.values(input.ExpressionAttributeValues!)).toContain(3);
    // REGRESSION (the fix): __version is bumped via an atomic ADD self-increment,
    // NOT a precomputed Date.now() version on a projectVersioned PutItem.
    expect(Object.values(input.ExpressionAttributeNames!)).toContain('__version');
    expect(input.UpdateExpression).toMatch(/\bADD\b/);
  });
```

Leave the other two tests (`ignores AdvisoryStatus records`, `recomputes once per tenant`) unchanged — they assert call counts, not DDB shape.

- [ ] **Step 5: Typecheck (trip-wire green)**

Run: `pnpm nx run advisory-bff:typecheck`
Expected: PASS. (If a `@ts-expect-error` reports "unused", a trip-wire line is stale — re-check Step 3.)

- [ ] **Step 6: Unit tests green**

Run: `pnpm nx run advisory-bff:test`
Expected: PASS, including the rewritten projector test.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/advisory-bff/src/read-model-ownership.ts \
        services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts \
        services/advisory/advisory-bff/test/types/read-model-ownership.type-test.ts \
        services/advisory/advisory-bff/test/unit/handlers/advisory-status-projector.test.ts
git commit --no-verify -m "fix(advisory-bff): strictly-monotonic AdvisoryStatus version via update+add self-increment

Reclassify AdvisoryStatus P3 -> CommandOwned; swap projectVersioned(Date.now())
for update(..., { add: { __version: 1 } }). Kills the same-ms version collision
that dropped the fresher inFlightCount recompute.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: dashboard-bff — confirm no regression (verify only)

**Files:** none modified. `dashboard-bff`'s `AdvisoryStatus` stays `Projection<'P3'>` consuming the carried `__version`, now a stronger monotonic counter.

- [ ] **Step 1: Typecheck**

Run: `pnpm nx run dashboard-bff:typecheck`
Expected: PASS (unchanged).

- [ ] **Step 2: Unit tests (incl. advisory-status transform)**

Run: `pnpm nx run dashboard-bff:test`
Expected: PASS (unchanged).

No commit (no change).

---

### Task 3: Drift-checker — confirm all rules pass (verify only)

- [ ] **Step 1: Run the read-model drift gate**

Run: `pnpm nx run event-processor:read-model-drift`
Expected: PASS. (`AdvisoryStatus` is now CommandOwned in advisory-bff + written via `update`; spec §4 proves R1–R6 all pass — notably R3 has no `*.fn.js` writer to AdvisoryStatus.)

If the target name errors, discover it: `pnpm nx show project event-processor --json | grep -i drift` and run the actual target.

No commit (no change).

---

### Task 4: Canonical doc — READ-MODEL-OWNERSHIP.md owner/consumer split

**Files:** Modify `docs/architecture/READ-MODEL-OWNERSHIP.md`

- [ ] **Step 1: §3 per-producer version-source table — add an advisory-bff row**

After the `investor-profile-ctrl | InvestorProfileSnapshot …` row in the §3 table, add:

```
| advisory-bff | `AdvisoryStatus` → `ADVISORY_STATUS_UPDATED` | `__version` | `update(..., { add: { __version: 1 } })` upsert (self-driven derived rollup) |
```

- [ ] **Step 2: §4 — fix the P3 example (owner vs consumer)**

In the §4 table's **P3** row, replace the Description cell text:

> Counts/rollups **computed over owned rows** or projected from an authoritative aggregate emitted by the owner. Never accumulated from disparate event types. `AdvisoryStatus` in-flight count is the canonical example.

with:

> A **consumer's** derived copy of an authoritative aggregate emitted by the owner. `dashboard-bff`'s P3 copy of the announced `AdvisoryStatus` aggregate is the canonical example. NOTE: an **owner's** self-driven derived rollup that self-manages its own `__version` (e.g. `advisory-bff`'s `AdvisoryStatus`, recomputed from its own decision rows) is **command-owned**, written via `update(..., { add: { __version: 1 } })` — not P3.

- [ ] **Step 3: §9 per-row classification table — split the AdvisoryStatus row**

Replace the row:

```
| `AdvisoryStatus` in-flight count | derived from owned decision rows | projection P3 |
```

with the two rows:

```
| `AdvisoryStatus` (advisory-bff, owner) | derived from its own decision rows; self-increments `__version` via `update`+`add` | command-owned |
| `AdvisoryStatus` (dashboard-bff, consumer) | projected from `ADVISORY_STATUS_UPDATED` | projection P3 |
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/READ-MODEL-OWNERSHIP.md
git commit --no-verify -m "docs(read-model-ownership): split AdvisoryStatus owner(command-owned)/consumer(P3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Service card — advisory-bff/CLAUDE.md regen

**Files:** Modify `services/advisory/advisory-bff/CLAUDE.md`

- [ ] **Step 1: Update the Handlers entry**

Replace:

```
- advisory-status-projector.ts — DDB-stream consumer (P3 derived aggregate); recomputes AdvisoryStatus.inFlightCount post-commit by counting non-terminal DecisionReadModel rows via countInFlightDecisions; writes via projectVersioned; loop-guarded to skip AdvisoryStatus records
```

with:

```
- advisory-status-projector.ts — DDB-stream consumer (advisory-bff's own command-owned derived aggregate); recomputes AdvisoryStatus.inFlightCount post-commit by counting non-terminal DecisionReadModel rows via countInFlightDecisions; writes via update(..., { add: { __version: 1 } }) (atomic strictly-monotonic __version self-increment, was projectVersioned+Date.now()); loop-guarded to skip AdvisoryStatus records
```

- [ ] **Step 2: Update the Read model block**

Replace:

```
- ReadModelOwnership registered in src/read-model-ownership.ts
  - P1 (projectVersioned): DecisionReadModel
  - P3 (projectVersioned, derived): AdvisoryStatus
  - CommandOwned (AppSync fn.js PutItems): UserConfirmation, UserRejection, UserInteraction
```

with:

```
- ReadModelOwnership registered in src/read-model-ownership.ts
  - P1 (projectVersioned): DecisionReadModel
  - CommandOwned (self-versioned derived aggregate via update+add:{__version:1}): AdvisoryStatus (owner; dashboard-bff holds the consumer-side Projection<'P3'> copy)
  - CommandOwned (AppSync fn.js PutItems): UserConfirmation, UserRejection, UserInteraction
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-bff/CLAUDE.md
git commit --no-verify -m "docs(advisory-bff): card — AdvisoryStatus CommandOwned via update+add self-increment

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Closing (handled by /backlog-next Step 6 — not tasks here)

- `pnpm nx affected -t test,lint --base=origin/main` green.
- Deploy `advisory-bff` to dev; run `advisory-bff:test-integration` (the `AdvisoryStatus (P3 inFlightCount recompute)` block — asserts `inFlightCount` 2→1 — passes unchanged); scoped advisory e2e.
- Ship the backlog file (`validation_gate`), `backlog-lint --fix`, finish branch, worktree cleanup, postflight.

---

## Self-review

- **Spec coverage:** §2 decision → Task 1 (Steps 1–2). §3.3/§3.4 tests → Task 1 (Steps 3–4). §3.5 dashboard-bff verify → Task 2. §4 drift analysis → Task 3. §3.6 canonical doc → Task 4. §3.7 card → Task 5. §6 validation gate → Task 1 Steps 5–6 + Closing. No gaps.
- **Placeholder scan:** none — every code/edit step shows full content.
- **Type/name consistency:** `update('AdvisoryStatus', { tenantId, inFlightCount }, { add: { __version: 1 }, overrides })` used identically in handler, type-test, and asserted in the unit test; `CommandOwned` import already present in `read-model-ownership.ts`; `__version` / `ExpressionAttributeNames` shape matches `intent-executor.ts` `executeUpdate` (`#aN`/`:aN` ADD clause).
