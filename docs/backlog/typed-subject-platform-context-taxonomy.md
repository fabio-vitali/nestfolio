---
id: typed-subject-platform-context-taxonomy
status: active
rank: 1
type: refactor
notes: "Phase-0 slice of the typed-subject-producer-contracts umbrella (design: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md § 'The one shared-library change'). The ONE shared-library change that unblocks all 4 domain slices. Today the two platform generics are asymmetric: BusEvent<T, S extends RequestContext> constrains S, but TableEntry<T, S> intersects S unconditionally — and real aggregates split three ways (tenant-scoped, region-scoped MarketSnapshot#<region>, global SecFiling). Introduce a small context taxonomy in libs/event-processor/platform/: a constrained base `SubjectContext = object`, re-base RequestContext onto it, add RegionContext, and constrain BOTH BusEvent<T, S extends SubjectContext = RequestContext> AND TableEntry<T extends object, S extends SubjectContext = RequestContext> to the same base (RequestContext stays the ergonomic default). Fix whatever churn the new TableEntry constraint surfaces across the lib's usage sites. libs/event-processor ONLY; unit-tested; NO deploy. Back-compat is not a constraint ([[no-deprecation]]) — clean up usage sites directly. Depends on nothing; blocks all 4 domain slices. Complex lane (touches a shared-lib export → worktree + PR)."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope:
  - "Converting any service's inline row types to TableEntry<Subject> (TaxLot, SnapshotRecord, SecFiling, snapshot/projection rows, AgentCompletion/AgentFailureRow) — that is the per-domain slices' job; phase-0 only lands the taxonomy + fixes lib-internal churn."
  - "Authoring any producer zod subject contract — domain slices."
  - "WS-2 (cdc-publisher-typed-subjects), WS-3 (consumer-parse-subject), and the enforcement capstone."
  - "Renaming the existing handler-context EventContext (types/event-context.ts) — explicitly rejected; the new base is named SubjectContext precisely to avoid disturbing that pervasive public symbol. Lib-only, NO workspace-wide rename, NO deploy."
  - "Any runtime/behavioural change to emitted context or row payloads — this is a compile-time type change only."
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

- Add `export type SubjectContext = object` (the constrained base; global aggregates use it directly).
  **Named `SubjectContext`, not `EventContext`** (the design's original name): `EventContext` is
  already a public export — the per-invocation handler context (`RequestContext` + runtime fields).
  Decision: user, 2026-06-09. See the design spec's naming-correction note.
- Re-base `RequestContext` onto `SubjectContext` (tenant-scoped: `tenantId`, `userId`, `region`).
- Add `RegionContext extends SubjectContext` (region-scoped: `region` only).
- Constrain **both** generics to `SubjectContext`, with `RequestContext` as the ergonomic default:
  `BusEvent<T = object, S extends SubjectContext = RequestContext>` and
  `TableEntry<T extends object = object, S extends SubjectContext = RequestContext>`.
- Fix the churn the new `TableEntry` constraint surfaces at the lib's usage sites (no back-compat
  shim — clean up directly, [[no-deprecation]]).

## Out of scope

- Converting any service's inline row types to `TableEntry<Subject>` (`TaxLot`, `SnapshotRecord`,
  `SecFiling`, snapshot/projection rows, `AgentCompletion`/`AgentFailureRow`) — that is the per-domain
  slices' job; phase-0 only lands the taxonomy + fixes lib-internal churn.
- Authoring any producer zod subject contract — domain slices.
- WS-2 (`cdc-publisher-typed-subjects`), WS-3 (`consumer-parse-subject`), the enforcement capstone.
- Renaming the existing handler-context `EventContext` (`types/event-context.ts`) — explicitly
  rejected; the new base is `SubjectContext` precisely to avoid disturbing that pervasive public
  symbol. **`libs/event-processor` only; NO workspace-wide rename; NO deploy.**
- Any runtime/behavioural change to emitted context or row payloads — compile-time type change only.

## Done

The taxonomy lands; both generics share the `SubjectContext` base; `RequestContext` remains the
default; lib `tsc` + unit tests green. No deploy (lib-only).

## Validation

`libs/event-processor` unit tests + workspace `tsc` green. No deploy.

## Deps

None (foundational). Blocks all 4 domain slices — they type rows as `TableEntry<Subject>` /
`TableEntry<Subject, RegionContext>` / `TableEntry<Subject, Record<string, never>>` against this
taxonomy.
