---
id: circuit-breaker-heal-rule-disable-propagation-race
status: parking
type: bug
notes: "e2e fixture's heal-rule EB Disable doesn't propagate before the breaker-OPEN write, so the heal SM auto-closes the fixture-opened breaker in ~2s — distinct root cause from the fixed 22s reorder bug."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: integration-test-timing-fragility
epic_role: core
---

# withBreakerOpen() fixture: heal-rule Disable propagation race

Distinct root cause from the reorder bug fixed in commit `e290fbe9` (event-freshness-conditional
`updateFeatureFlag`, [[circuit-breaker-lifecycle-e2e-breaker-stuck-open]]): the
`circuit-breaker-lifecycle` e2e fixture's `withBreakerOpen()` helper disables the heal EventBridge
rule before writing the breaker OPEN, but the EB Disable API call does not propagate before the
write lands, so the heal state machine still fires and auto-closes the fixture-opened breaker
within ~2s. This shrinks scenario 14's Phase-2 disabled window to ~2s wide instead of the intended
duration.

Observed twice: 2026-06-26 (during the throttle-storm forensics run) and again on 2026-07-18
(openedAt/closedAt ~2s apart in the breaker-state snapshot).

Surfaced during the 2026-07-19 root-cause session (ledger Entry 32) as a re-observed but
NOT-fixed secondary race; not in the pre-ship-findings JSON (that batch predates this
observation), filed here per the same session's deferred-filing instruction.
