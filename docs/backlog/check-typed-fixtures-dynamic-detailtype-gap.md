---
id: check-typed-fixtures-dynamic-detailtype-gap
status: parking
type: tooling
epic: typed-test-fixtures
epic_role: captured
notes: "check-typed-fixtures gate matches static literal detailType only — a putEvent with a variable/computed detailType escapes the gate, so a co-wrong subject there is uncaught."
references: []
out_of_scope: []
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
is inherent to static-literal gating. Options when full typed coverage is desired: (a) refactor
the parameterized fixtures to per-event literal `putEvent` calls; (b) extend the gate to resolve
simple `EventTypes.NAME` member expressions to their literal (it already partially does for the
compound-skip note); (c) add a runtime assertion in the test harness. Captured under the
`typed-test-fixtures` epic (does not block closure — the runtime `schema.parse(subject)` backstop
in `putEvent` still fires for the literal-typed majority).
