# Typed-Subject Platform Context Taxonomy (phase-0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a small, constrained context taxonomy in `libs/event-processor` so that both platform generics — `BusEvent<T, S>` and `TableEntry<T, S>` — are constrained to the **same** base (`SubjectContext = object`) and can type tenant-scoped, region-scoped, and global aggregates accurately.

**Architecture:** Add `SubjectContext` (the constraint base, `= object`) and `RegionContext` (region-scoped, `{ region }`) alongside the existing `RequestContext` in `libs/event-processor/src/domain/schemas.ts` (the established home for context types — `platform/{bus,table}.ts` already import `RequestContext` from there). Widen `BusEvent`'s constraint from `S extends RequestContext` to `S extends SubjectContext`, and ADD that constraint to `TableEntry` (which is currently unconstrained). `RequestContext` is left **untouched** — it already structurally satisfies `object`, so it remains the ergonomic default for both generics with zero blast radius. A type-level test (validated by the `typecheck` target) locks in the three scoping shapes + that the constraint rejects non-object `S`.

**Tech Stack:** TypeScript 5 (strict, `noUnusedLocals`/`noUnusedParameters`), Nx, Jest (runtime tests), `tsc --noEmit` (type-level tests via the `typecheck` target).

**Naming note:** The base is `SubjectContext`, NOT `EventContext` (the umbrella design's original name). `EventContext` is already a public export — the per-invocation handler context (`RequestContext` + `{eventId, eventType, timestamp, serviceName, record}`). User decision 2026-06-09; recorded in the design spec's naming-correction note.

**Empirically verified before planning** (`tsc` probes, 2026-06-09):
- `interface X extends SubjectContext` (alias for `object`) **compiles** — interfaces may extend an `object` type alias.
- `TableEntry<Subject, Record<string, never>>` does **NOT** poison the subject's declared fields to `never` — explicit properties win over the index signature in an intersection, so `…['accession']` stays `string`. The design's global representation is sound.
- `TableEntry<Subject, string>` → `TS2344: Type 'string' does not satisfy the constraint 'object'`. The new constraint bites.
- No workspace site passes a non-object `S` to `TableEntry`/`BusEvent` (only the definition sites use an explicit 2nd arg) → predicted churn ≈ 0.

---

## File Structure

- `libs/event-processor/src/domain/schemas.ts` — **Modify.** Add `SubjectContext` + `RegionContext` next to `RequestContext`. (Home for context types; co-located with `RequestContextSchema`.)
- `libs/event-processor/src/platform/bus.ts` — **Modify.** Widen `BusEvent`'s `S` constraint to `SubjectContext`; import it.
- `libs/event-processor/src/platform/table.ts` — **Modify.** Add `S extends SubjectContext` constraint to `TableEntry`; import it.
- `libs/event-processor/src/domain/index.ts` — **Modify.** Export the two new types.
- `libs/event-processor/src/index.ts` — **Modify.** Re-export the two new types from the package barrel.
- `libs/event-processor/test/types/context-taxonomy.type-test.ts` — **Create.** Type-level test (no runtime); validated by `typecheck`.

---

### Task 1: Write the failing type-level test

**Files:**
- Create: `libs/event-processor/test/types/context-taxonomy.type-test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Type-level tests for the platform context taxonomy (phase-0).
 *
 * Validated by `pnpm nx run event-processor:typecheck` (tsc --noEmit against
 * tsconfig.type-test.json, which includes test/types/**). No runtime assertions:
 * a `@ts-expect-error` that does NOT error is itself a compile failure — that is
 * the test failing. The function-call `use(...)` idiom (mirroring
 * ownership.type-test.ts) keeps `noUnusedLocals` + lint's no-unused-expressions
 * satisfied without executing anything.
 */
import type {
  BusEvent,
  TableEntry,
  RequestContext,
  RegionContext,
  SubjectContext,
} from '../../src';

// Consumes values so nothing is reported as an unused local / unused expression.
declare function use(...xs: unknown[]): void;

// Sample subjects — pure business aggregates, no identity metainfo on the subject.
type TaxLot = { lotId: string; symbol: string };
type MarketSnapshot = { asOf: string; indices: number[] };
type SecFiling = { accession: string; form: string };

// --- the base accepts the concrete context types (both ARE SubjectContexts) ---
type ReqIsCtx = RequestContext extends SubjectContext ? true : false;
type RegIsCtx = RegionContext extends SubjectContext ? true : false;
const baseAssignable: [ReqIsCtx, RegIsCtx] = [true, true]; // both must resolve to `true`
use(baseAssignable);

// --- default S = RequestContext: a tenant-scoped row carries tenant identity + subject ---
declare const tenantRow: TableEntry<TaxLot>;
use(tenantRow.tenantId, tenantRow.userId, tenantRow.lotId, tenantRow.pk);

// --- region-scoped: carries `region`, but NOT tenant identity (no fake tenantId) ---
declare const regionRow: TableEntry<MarketSnapshot, RegionContext>;
use(regionRow.region, regionRow.asOf, regionRow.pk);
// @ts-expect-error — region-scoped rows must NOT carry tenantId
use(regionRow.tenantId);

// --- global: the bare base (no identity); declared subject fields survive ---
declare const globalRow: TableEntry<SecFiling, Record<string, never>>;
use(globalRow.accession, globalRow.form, globalRow.pk);
// @ts-expect-error — global rows carry no tenant identity
use(globalRow.tenantId);

// --- BusEvent mirrors TableEntry: same S options, context carried on the event ---
declare const regionEvent: BusEvent<MarketSnapshot, RegionContext>;
use(regionEvent.context.region, regionEvent.subject.asOf);
declare const tenantEvent: BusEvent<TaxLot>;
use(tenantEvent.context.tenantId, tenantEvent.subject.lotId);

// --- the constraint bites: a non-object S is rejected on BOTH generics ---
// @ts-expect-error — TableEntry's S must extend SubjectContext (object); string is not
type BadEntry = TableEntry<TaxLot, string>;
// @ts-expect-error — BusEvent's S must extend SubjectContext (object); number is not
type BadEvent = BusEvent<TaxLot, number>;
// Reference the aliases so neither is an unused declaration (optional-tuple, never constructed).
const badRefs: [BadEntry?, BadEvent?] = [];
use(badRefs);
```

- [ ] **Step 2: Run the test to verify it fails (RED)**

Run: `pnpm nx run event-processor:typecheck`
Expected: FAIL — `error TS2305: Module '"../../src"' has no exported member 'SubjectContext'` (and `'RegionContext'`). The new types do not exist yet.

---

### Task 2: Add the context taxonomy to `domain/schemas.ts`

**Files:**
- Modify: `libs/event-processor/src/domain/schemas.ts`

- [ ] **Step 1: Add `SubjectContext` + `RegionContext` above `RequestContext`**

Insert immediately after the `import` line at the top of the file (before `export const RequestContextSchema`):

```ts
/**
 * Base for all event/row context types — the constraint base for `BusEvent<T, S>`
 * and `TableEntry<T, S>`. Global aggregates (no identity scope) use it directly,
 * or equivalently `Record<string, never>`. Named `SubjectContext` (not `EventContext`,
 * which is the per-invocation handler context). See the typed-subject-producer-contracts
 * design spec § "The one shared-library change".
 */
export type SubjectContext = object;

/** Region-scoped aggregates (e.g. market data keyed on region; no tenant identity). */
export interface RegionContext extends SubjectContext {
  region: string;
}
```

> `RequestContext` is left exactly as-is: `type RequestContext = { tenantId; userId; region }`
> already structurally satisfies `SubjectContext` (it is an `object`), so it remains the
> ergonomic default for both generics with zero churn. No conversion to `interface` is needed.

- [ ] **Step 2: (no test run yet — barrels not updated; continue to Task 3)**

---

### Task 3: Constrain the two platform generics

**Files:**
- Modify: `libs/event-processor/src/platform/bus.ts:1-9`
- Modify: `libs/event-processor/src/platform/table.ts:1-10`

- [ ] **Step 1: Widen `BusEvent`'s constraint (`bus.ts`)**

Replace the import + type at the top of `bus.ts`:

```ts
import { type EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
```

— leave the existing aws-sdk import as-is; change only the `RequestContext` import and the `BusEvent` declaration:

Change line 4 from:
```ts
import type { RequestContext } from '../domain/schemas';
```
to:
```ts
import type { RequestContext, SubjectContext } from '../domain/schemas';
```

Change the `BusEvent` declaration (lines 6-9) from:
```ts
export type BusEvent<T = object, S extends RequestContext = RequestContext> = Event & {
  subject: T;
  context: S;
};
```
to:
```ts
export type BusEvent<T = object, S extends SubjectContext = RequestContext> = Event & {
  subject: T;
  context: S;
};
```

- [ ] **Step 2: Add `TableEntry`'s constraint (`table.ts`)**

Replace the full contents of `table.ts`:

```ts
import type { RequestContext, SubjectContext } from '../domain/schemas';

export type TableEntry<T extends object = object, S extends SubjectContext = RequestContext> = T & {
  pk: string;
  sk: string;
  __typename: string;
  createdAt: string;
  updatedAt?: string;
  ttl?: number;
} & S;
```

---

### Task 4: Export the new types from the barrels

**Files:**
- Modify: `libs/event-processor/src/domain/index.ts`
- Modify: `libs/event-processor/src/index.ts:135-144`

- [ ] **Step 1: Export from `domain/index.ts`**

Change the type-export block from:
```ts
export type {
  BusEventPayload,
  RequestContext,
} from './schemas';
```
to:
```ts
export type {
  BusEventPayload,
  RequestContext,
  RegionContext,
  SubjectContext,
} from './schemas';
```

- [ ] **Step 2: Re-export from the package barrel `src/index.ts`**

In the `export type { … } from './domain';` block (currently `BusEventPayload, RequestContext`), add the two new names:
```ts
export type {
  BusEventPayload,
  RequestContext,
  RegionContext,
  SubjectContext,
} from './domain';
```

---

### Task 5: Run the type-level test to verify it passes (GREEN)

- [ ] **Step 1: Typecheck (the type-level test + lib-wide churn)**

Run: `pnpm nx run event-processor:typecheck`
Expected: PASS (exit 0, no `tsc` errors). The `@ts-expect-error` lines are now satisfied (the constraint rejects `string`/`number`), and `SubjectContext`/`RegionContext` resolve.

> If a `@ts-expect-error` reports "Unused '@ts-expect-error' directive", the constraint did not
> fire on that line — investigate before proceeding (do not delete the directive to make it pass).
> If `noUnusedLocals`/lint complains about `BadEntry`/`BadEvent`/`badRefs`, adjust the consume idiom
> (e.g. drop the aliases and assert the shared constraint via
> `declare function ctxBound<S extends SubjectContext>(s: S): void;` + a `// @ts-expect-error`
> `ctxBound<string>('x')`), keeping the negative assertion intact.

---

### Task 6: Run the full lib lint + unit tests (verify zero runtime churn)

- [ ] **Step 1: Lint**

Run: `pnpm nx run event-processor:lint`
Expected: PASS. (The type-test uses the function-call `use(...)` idiom, so no `no-unused-expressions`/`no-unused-vars` violations.)

- [ ] **Step 2: Jest unit tests**

Run: `pnpm nx run event-processor:test`
Expected: PASS — all existing suites green. No runtime behaviour changed (this is a compile-time type change only).

---

### Task 7: Commit

- [ ] **Step 1: Commit (worktree → `--no-verify`, then verify it landed)**

```bash
git add libs/event-processor/src/domain/schemas.ts \
        libs/event-processor/src/platform/bus.ts \
        libs/event-processor/src/platform/table.ts \
        libs/event-processor/src/domain/index.ts \
        libs/event-processor/src/index.ts \
        libs/event-processor/test/types/context-taxonomy.type-test.ts
git commit --no-verify -m "refactor(event-processor): add SubjectContext base; constrain BusEvent+TableEntry

Phase-0 of typed-subject-producer-contracts. Adds SubjectContext (= object,
the constraint base) and RegionContext (region-scoped) to domain/schemas.ts.
Widens BusEvent's S constraint from RequestContext to SubjectContext and ADDS
that constraint to TableEntry (previously unconstrained). RequestContext stays
the default on both, untouched. Type-level test locks in tenant/region/global
scoping + that a non-object S is rejected.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git log --oneline -1
```
Expected: the commit SHA prints; `git status --short` is clean.

---

## Self-Review

**1. Spec coverage** (design § "The one shared-library change"):
- "constrained base `SubjectContext = object`" → Task 2. ✓
- "re-base `RequestContext`" → covered by structural satisfaction (RequestContext is an `object`); documented as a deliberate no-change in Task 2. ✓
- "add `RegionContext`" → Task 2. ✓
- "constrain BOTH `BusEvent` and `TableEntry` to the same base, `RequestContext` default" → Task 3. ✓
- "fix whatever churn the new `TableEntry` constraint surfaces" → Tasks 5/6 (typecheck + lint + jest across the lib); measured churn ≈ 0. ✓
- "lib `tsc` + unit tests green; no deploy" (validation gate) → Tasks 5/6. ✓
- Out of scope (per backlog file): no inline-row conversions, no producer contracts, no deploy. Honored. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**3. Type consistency:** `SubjectContext`, `RegionContext`, `RequestContext`, `BusEvent`, `TableEntry` named identically across all tasks and the test. The test imports exactly the names Task 4 exports. ✓
