---
id: check-typed-fixtures-dynamic-detailtype-gap
status: active
rank: null
type: tooling
epic: typed-test-fixtures
epic_role: core
notes: "CORE. check-typed-fixtures gate matches static literal detailType only — a putEvent with a variable/computed detailType escapes the gate, so a co-wrong subject there is uncaught. A structural hole in the epic's done_when deliverable 'regression gate forbids untyped putEvent in migrated domains'; promoted captured→core 2026-06-19 (closure-predicate test). Approach (2026-06-19 user direction): ban dynamic detailType outright (no escape hatch) + strip comments before scanning; unroll the two it.each blocks in onboarding-notification.integration.test.ts to per-event literal calls (8 registered → typed subject form; ORDER_REJECTED stays an unregistered literal, deferred to typed-test-fixtures-execution-deferred-cross-domain)."
references: []
out_of_scope:
  - "Wiring the gate into an nx target / pre-commit hook (it is the package.json `check:typed-fixtures` script today) — separate concern; file if it blocks."
  - "Typed migration of the parked ORDER_*/NormalizedOrderEvent family (incl. ORDER_REJECTED) — blocked on out-of-scope production forks per typed-test-fixtures-execution-deferred-cross-domain; left as documented unregistered literals."
  - "Any DRY test-support emit<K>() helper to preserve it.each — YAGNI; unrolling to per-event literal calls suffices."
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# check-typed-fixtures gate blind to dynamic `detailType` putEvent

Surfaced 2026-06-18 by the **typed-test-fixtures Phase 4** final whole-branch review.

`tools/check-typed-fixtures.mjs` flags a legacy `putEvent({ detail })` only when the `detailType`
is a **static string literal** it can match against the registered-events list. A call-site that
passes a **variable or computed** `detailType` routes through the legacy untyped `putEvent`
overload and the gate **transparently skips it** — so a co-wrong subject there is NOT caught at
compile time (the typed overload's `subject: SubjectOf<K>` only binds when `K` is a literal) NOR
at gate time.

Concrete instance: `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts:91`
emits `BALANCE_UPDATED` (among ~10 events) from an `it.each(...)` array whose `detailType` is a
loop variable. The gate skips the whole parameterized block. (Same shape as the e2e compound
`AlpacaAdptEventTypes.ALPACA_ACCOUNT_SNAPSHOT` the gate already reports as "skipped: trailing
name not in registry".)

This is a **gate-coverage limitation**, not a defect in any one fixture: the dynamic-name pattern
is inherent to static-literal gating. Options to close it: (a) refactor the parameterized
fixtures to per-event literal `putEvent` calls; (b) extend the gate to resolve simple
`EventTypes.NAME` member expressions to their literal (it already partially does for the
compound-skip note); (c) add a runtime assertion in the test harness.

**Core (promoted 2026-06-19).** This is load-bearing for the epic's `done_when` deliverable
*"regression gate forbids untyped putEvent in migrated domains"* — a structural blind spot means
the gate does NOT fully forbid untyped `putEvent`, so the clause is not yet true. The runtime
`schema.parse(subject)` backstop fires for the literal-typed majority, but the gate hole itself is
part of the done-definition and must be closed (or explicitly carved out) before the epic ships.
