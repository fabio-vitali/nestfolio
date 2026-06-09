---
id: typed-subject-platform-context-taxonomy
status: queued
rank: 1
type: refactor
notes: "Phase-0 slice of the typed-subject-producer-contracts umbrella (design: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md § 'The one shared-library change'). The ONE shared-library change that unblocks all 4 domain slices. Today the two platform generics are asymmetric: BusEvent<T, S extends RequestContext> constrains S, but TableEntry<T, S> intersects S unconditionally — and real aggregates split three ways (tenant-scoped, region-scoped MarketSnapshot#<region>, global SecFiling). Introduce a small context taxonomy in libs/event-processor/platform/: a constrained base `EventContext = object`, re-base RequestContext onto it, add RegionContext, and constrain BOTH BusEvent<T, S extends EventContext = RequestContext> AND TableEntry<T extends object, S extends EventContext = RequestContext> to the same base (RequestContext stays the ergonomic default). Fix whatever churn the new TableEntry constraint surfaces across the lib's usage sites. libs/event-processor ONLY; unit-tested; NO deploy. Back-compat is not a constraint ([[no-deprecation]]) — clean up usage sites directly. Depends on nothing; blocks all 4 domain slices. Complex lane (touches a shared-lib export → worktree + PR)."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Typed-subject platform context taxonomy (phase-0)

Phase-0 slice of the `typed-subject-producer-contracts` umbrella. See the design spec
(`§ The one shared-library change`) for the full rationale.

## Goal

A small, constrained context taxonomy in `libs/event-processor` (`platform/`) so that both platform
generics — `BusEvent<T, S>` and `TableEntry<T, S>` — are constrained to the **same** base and can
type tenant-scoped, region-scoped, and global aggregates accurately.

## Scope

- Add `export type EventContext = object` (the constrained base; global aggregates use it directly).
- Re-base `RequestContext` onto `EventContext` (tenant-scoped: `tenantId`, `userId`, `region`).
- Add `RegionContext extends EventContext` (region-scoped: `region` only).
- Constrain **both** generics to `EventContext`, with `RequestContext` as the ergonomic default:
  `BusEvent<T = object, S extends EventContext = RequestContext>` and
  `TableEntry<T extends object = object, S extends EventContext = RequestContext>`.
- Fix the churn the new `TableEntry` constraint surfaces at the lib's usage sites (no back-compat
  shim — clean up directly, [[no-deprecation]]).

## Done

The taxonomy lands; both generics share the `EventContext` base; `RequestContext` remains the
default; lib `tsc` + unit tests green. No deploy (lib-only).

## Validation

`libs/event-processor` unit tests + workspace `tsc` green. No deploy.

## Deps

None (foundational). Blocks all 4 domain slices — they type rows as `TableEntry<Subject>` /
`TableEntry<Subject, RegionContext>` / `TableEntry<Subject, Record<string, never>>` against this
taxonomy.
