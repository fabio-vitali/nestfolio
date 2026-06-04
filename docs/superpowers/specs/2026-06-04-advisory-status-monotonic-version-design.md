# AdvisoryStatus recompute: strictly-monotonic version

**Date:** 2026-06-04
**Backlog:** `advisory-status-recompute-monotonic-version`
**Type:** refactor (read-model-ownership program — last QUEUED residual)
**Status:** design — awaiting review

---

## 1. Problem

`advisory-bff`'s `advisory-status-projector.ts` recomputes the per-tenant
`AdvisoryStatus.inFlightCount` (count of non-terminal `DecisionReadModel` rows)
post-commit and writes it via:

```ts
const version = Date.now();
await executor.execute(
  projectVersioned('AdvisoryStatus', { tenantId, inFlightCount }, {
    version, overrides: { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' },
  }),
  ctx,
);
```

`projectVersioned` guards the write with `attribute_not_exists(pk) OR
attribute_not_exists(#v) OR #__version < :version`. **Two recomputes for the same
tenant in the same wall-clock millisecond produce equal `version` values**, so the
second write fails the `#__version < :version` guard and is dropped as
"deduplicated". The fresher count is silently lost.

The same carried `__version` is consumed downstream: the row CDC-emits
`ADVISORY_STATUS_UPDATED` carrying `__version` top-level; `investor-adpt` forwards
it; `dashboard-bff`'s `advisory-status.ts` re-projects a P3 copy via
`projectVersioned('AdvisoryStatus', …, { version: subject.__version })`. A same-ms
collision therefore drops the update on **both** sides.

### Severity
Benign today: a dropped recompute self-heals on the next `DecisionReadModel`
change, and two recomputes 1 ms apart count near-identical data. This is the
lowest-urgency residual of the read-model-ownership program, filed because
"drain QUEUED = the model is fully correct".

### Known dead end (do not re-attempt)
The reverted C1 attempt keyed the version on the max stream `SequenceNumber`.
`DecisionReadModel` rows are keyed `Decision#<tenant>#<id>` (per-decision pk), so
a tenant's decisions land in **different** stream shards whose `SequenceNumber`s
are not comparable. `max(SequenceNumber)` over a multi-decision batch is therefore
non-monotonic for the per-tenant `AdvisoryStatus` row, and the recompute never
wrote (caught by the integration "recomputes inFlightCount" test). The projector
already carries a code comment documenting this; it stays.

There is **no external monotonic source** for a per-tenant rollup that spans
decision shards. The version must be a **self-increment counter** on the row.

---

## 2. Decision

**Reclassify `advisory-bff`'s `AdvisoryStatus` from `Projection<'P3'>` to
`CommandOwned`, and write it with the existing
`update(typename, updates, { add: { __version: 1 } })` self-increment upsert.**

This is the pattern already used by three producers to self-stamp a monotonic
`__version` on a command-owned row (READ-MODEL-OWNERSHIP §3): `decision-workflow-ctrl`
(`DecisionPacket`), `market-intelligence-ctrl` (`MarketSnapshot`),
`investor-profile-ctrl` (`InvestorProfileSnapshot`). The `UpdateIntent.add` field
does `ADD #__version :1` in the same `UpdateExpression` as the `SET`, atomically
and without a prior read — DynamoDB guarantees strict monotonicity regardless of
which shards triggered the batch.

### Why CommandOwned is the honest classification
READ-MODEL-OWNERSHIP §2 discriminator: *"after creation, who drives ongoing state
changes?"* — **the service itself** recomputes `AdvisoryStatus` from its own rows
→ command-owned. The current `Projection<'P3'>` label conflates two distinct
rows that happen to share a typename:

- **`advisory-bff`'s row** — the *owner's* self-driven derived rollup. Command-owned.
- **`dashboard-bff`'s row** — a *consumer's* pure projection fed by the owner's
  `ADVISORY_STATUS_UPDATED` announcement. Genuinely P3. **Unchanged.**

Per-service registry scoping already permits the same typename to carry different
tags across services (§9.1, `MandateSnapshot` is `P1` in two services).

### Reuse rationale (primary objective)
This consolidates `AdvisoryStatus` onto the **already-canonical, already-proven**
self-increment version-stamping pattern, making it byte-identical to
`MarketSnapshot` / `InvestorProfileSnapshot` / `DecisionPacket` — **one liftable
pattern across four producers, zero new library code**. The rejected alternative
(a new `recomputeVersioned` P3 intent) would fragment version-stamping into two
mechanisms for a single current use case (YAGNI) and add shared-library surface.

### Type-gate fact that forces the classification
`update` is constrained by `RejectProjection<K>`, which rejects **any** projection
(P1/P2/P3). So the self-increment write is only type-legal once the row is
`CommandOwned`. `projectVersioned` (`RejectNonP1`) conversely rejects
`CommandOwned`, so the old write stops compiling — the type system enforces the
swap.

---

## 3. Change set

### 3.1 `advisory-bff` handler — `src/handlers/advisory-status-projector.ts`
Swap the write. Correct `update` signature is
`update(typename, updates, options)` (`add`/`overrides` live in the third arg):

```ts
import { IntentExecutor, update, asTenantId, asUserId, type EventContext } from '@nestfolio/event-processor';
// …
for (const tenantId of tenants) {
  const inFlightCount = await repo.countInFlightDecisions(tenantId);
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
```

The executor builds `SET tenantId = :…, inFlightCount = :…, __typename = :…,
<requestContext>, updatedAt = :… ADD #__version :1` as an **unconditional upsert**
(no condition ⇒ row seeded if absent; `ADD` on an absent attribute is `0 + 1`).
Update the head comment: drop the `projectVersioned`/`Date.now()` rationale, keep
the SequenceNumber dead-end note, document the self-increment + CommandOwned
classification.

### 3.2 `advisory-bff` ownership — `src/read-model-ownership.ts`
`AdvisoryStatus: Projection<'P3'>` → `AdvisoryStatus: CommandOwned`. Update the
module comment (it currently says "P3 derived aggregate → projectVersioned only").
`import type { Projection, CommandOwned }` already present.

### 3.3 `advisory-bff` type-test — `test/types/read-model-ownership.type-test.ts`
The trip-wire flips:
- `projectVersioned('AdvisoryStatus', …)` → now **fails** (CommandOwned rejected
  by `RejectNonP1`): add `@ts-expect-error`.
- `update('AdvisoryStatus', …)` / `accumulate('AdvisoryStatus', …)` /
  `record('AdvisoryStatus', …)` → now **compile** (CommandOwned allowed): remove
  their `@ts-expect-error` lines (a `@ts-expect-error` that does not error is
  itself a compile failure).
- Add a positive assertion for the new blessed write:
  `update('AdvisoryStatus', { inFlightCount: 1 }, { add: { __version: 1 } });`.
- Refresh the explanatory comments.

### 3.4 `advisory-bff` unit test — `test/unit/handlers/advisory-status-projector.test.ts`
The "recomputes…" test asserts on `input.Item` (PutItem shape). `update` issues an
`UpdateCommand`, so rewrite the assertion to match the update shape:
- find the intercepted call whose `input.Key?.sk === 'AdvisoryStatus'`;
- assert `input.Key.pk === 'T#t1'`;
- assert the recomputed `inFlightCount` (3) appears in `ExpressionAttributeValues`;
- **regression assertion (the fix):** assert `UpdateExpression` contains an `ADD`
  clause incrementing `__version`, and that **no precomputed `Date.now()` version**
  is used. This locks the counter mechanism in.

The "ignores AdvisoryStatus records" and "recomputes once per tenant" tests are
unaffected (no DDB-shape assertion).

### 3.5 `dashboard-bff` — NO code change (verify only)
`advisory-status.ts` keeps `Projection<'P3'>` + `projectVersioned(version:
subject.__version)`. The carried `__version` is now a strictly-increasing counter,
which only strengthens its existing guard. Confirm `dashboard-bff:typecheck` and
its `advisory-status` transform test still pass; no deploy needed.

### 3.6 Canonical doc — `docs/architecture/READ-MODEL-OWNERSHIP.md`
Per the doc header ("do not edit without updating the type-enforcement layer"),
the type layer is unchanged (the `CommandOwned`/`Projection` tags and reject
helpers are untouched) — only a per-service registration moves. Amend the
*classification text* to remove the owner/consumer conflation:

- **§4** ("P3 — Derived aggregate"): change the example. P3's canonical example
  becomes **`dashboard-bff`'s projection of the announced `AdvisoryStatus`
  aggregate** (consumer side). Note that an *owner's* self-driven derived rollup
  that self-manages its version is command-owned (uses `update` + `add:
  {__version:1}`), not P3.
- **§9** per-row table: split the `AdvisoryStatus` row — `advisory-bff` (owner,
  derived rollup, self-incremented `__version`) = **command-owned**;
  `dashboard-bff` (consumer) = **projection P3**.
- **§3** per-producer version-source table: add an `advisory-bff` /
  `AdvisoryStatus` → `ADVISORY_STATUS_UPDATED` row, version field `__version`,
  mechanism `update(…, { add: { __version: 1 } })` upsert — joining the three
  existing producers.

### 3.7 Service card — `services/advisory/advisory-bff/CLAUDE.md` (derived doc)
Regenerate via `audit-service advisory-bff` (or hand-edit to match): the Handlers
entry ("writes via projectVersioned"), the "Read model" block (P3 → CommandOwned
for AdvisoryStatus), and the projector description. Source + derived ship together.

---

## 4. Drift-checker analysis (all six rules pass)

`tools/check-read-model-drift.mjs`, after the change, with `AdvisoryStatus`
registered `CommandOwned` in advisory-bff and written via `update`:

- **R1 accumulate-on-projection** — n/a; write is `update`, row no longer a projection.
- **R2 p1-without-version-guard** — n/a; row is CommandOwned, not P1.
- **R3 dual-writer** — no `*.fn.js` command writer to `AdvisoryStatus` exists in
  advisory-bff (`publish-advisory-status-update.fn.js` is an IAM echo resolver,
  `payload: null`, no DDB write; `get-advisory-status.fn.js` is a GetItem). The
  projector's `update` is the sole ongoing writer. No coexisting command write ⇒
  no trip.
- **R4 registry-conflict** — single tag within advisory-bff. The differing
  `dashboard-bff` tag (P3) is another service; cross-service differences are
  permitted (§9.1).
- **R5 unclassified-write** — `AdvisoryStatus` is registered (CommandOwned) ⇒ classified.
- **R6 exclusion-conflict** — not in `tools/read-model-exclusions.json`; no conflict.

---

## 5. Transition / safety (no migration)

Existing dev `AdvisoryStatus` rows carry a `__version` equal to a past `Date.now()`
(~1.7e12). The first post-deploy recompute does `ADD #__version :1` → that value
+ 1, i.e. it **continues** from the wall-clock value and keeps strictly
increasing. `dashboard-bff`'s `#__version < :version` guard sees the larger value
and applies. New tenants seed `__version = 1`. No backfill, no double-write, no
consumer change. This matches the backlog `out_of_scope`.

---

## 6. Validation gate

- `pnpm nx run advisory-bff:typecheck` (type-test trip-wire flipped) — green.
- `pnpm nx run advisory-bff:test` (unit, incl. rewritten projector test with the
  ADD-on-`__version` regression assertion) — green.
- `pnpm nx run dashboard-bff:typecheck` + `dashboard-bff:test` — green (unchanged).
- `pnpm nx run event-processor:read-model-drift` — green (§4 analysis).
- `pnpm nx affected -t test,lint --base=origin/main` — green.
- Deploy `advisory-bff` to dev (`deploy.sh sandbox --prefix=dev
  --services=advisory-bff`).
- `pnpm nx run advisory-bff:test-integration` — the `AdvisoryStatus (P3
  inFlightCount recompute)` block (asserts `inFlightCount` 2→1) passes unchanged.
- Scoped e2e: the advisory decision-cycle scenario that surfaces the in-flight
  count, to confirm the live broadcast path still delivers.

---

## 7. Out of scope

- No change to `dashboard-bff`'s `advisory-status.ts` P3 transform beyond
  confirming it stays correct under the monotonic counter.
- No change to the `inFlightCount` recompute logic (`countInFlightDecisions`).
- No backfill/migration of existing `AdvisoryStatus` rows.
- No re-attempt of the stream `SequenceNumber` approach.
- No application of the pattern to other P3/derived aggregates — generalising
  beyond `AdvisoryStatus` is a separate promote-on-second-use-case item.
- No new event-processor intent (`update` + `add` already exists).
