---
id: broker-alpaca-adpt-resilience-trap-collapse
status: parking
type: refactor
notes: "broker-alpaca-adpt.resilience.integration.test.ts creates 2 EventBusTrap rules in beforeAll — same anti-pattern that caused advisory-adpt + investor-adpt EB-rule-propagation flakes (shipped 2026-05-13). Hasn't been observed flaking yet; pre-emptive collapse to 1-trap-with-2-detailtypes."
references:
  - "services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.resilience.integration.test.ts"
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: integration-test-timing-fragility
epic_role: core
---

# broker-alpaca-adpt.resilience: collapse 2-trap pattern → 1 trap

## Why this is filed

The 2026-05-13 ship of `advisory-adpt-from-investor-mandate-issued-sequential-flake` diagnosed the trap-empty flake family as **EventBridge rule-propagation eventual consistency**: a brand-new EB rule's canary warmup confirms activation on one rule-evaluation partition, but cross-bus forwarded events may be evaluated on other partitions that haven't yet seen the rule, dropping the event silently.

The fix in advisory-adpt + investor-adpt was to collapse N traps in beforeAll/per-test → 1 trap covering all detail-types, so the single rule has more wall-clock time to fully propagate before any test publishes.

A grep of remaining `*-adpt/test/integration/*.integration.test.ts` for the same anti-pattern (≥2 `new EventBusTrap` / `trap.deploy` calls in one file) flagged:

- `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.resilience.integration.test.ts` — 2 traps / 2 tests

## What to do

Same shape as the shipped fixes: deploy one `EventBusTrap` in `beforeAll` with `detailType: [<detailType1>, <detailType2>]`, then call `trap.waitForEvent({ detailType: ... })` filtered per `it()` block.

## Promotion trigger

Promote to QUEUED when this file flakes with `Captured-but-unmatched buffer: []` in CI or local runs.
