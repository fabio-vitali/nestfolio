---
id: circuit-breaker-feature-flags-ui-gating
status: parking
type: bug
notes: "scenario 14 e2e: getFeatureFlags stays all `enabled:true` after circuit breaker opens. UI never reflects the gated-mutation state."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Circuit-breaker open state not reflected in `getFeatureFlags` for UI mutation gating

**Failing e2e:** `apps/e2e-feature-tests/src/account/circuit-breaker-lifecycle.e2e.test.ts` — scenario 14 ("disables gated mutations when breaker opens and re-enables when breaker closes").

The test opens the broker circuit breaker, then polls `getFeatureFlags` expecting at least one of `confirmDecision` / `initiateDeposit` / `requestWithdrawal` to flip to `enabled: false`. After 120s timeout, all three remain `{enabled: true, reason: null}`.

This means either:
1. The circuit breaker is not actually opening on the trigger the test fires (broker-alpaca-adpt CB state never transitions to OPEN), OR
2. The CB opens correctly but `getFeatureFlags` (compliance-ctrl or wherever the resolver lives) doesn't read CB state, OR
3. The CB opens and the resolver knows about it, but the read model (BFF or AppSync resolver) doesn't surface it.

**Cheapest next step:** trigger the breaker manually on dev (whatever the test fixture does) and inspect:
- DDB state for broker-alpaca-adpt CB (if state-tracked)
- CloudWatch logs of the `getFeatureFlags` resolver / Lambda
- `compliance-ctrl` mode-aware authority resolver — whether it reads CB state at all

**Context:** the circuit-breaker workstream redesign (memory: `project_circuit_breaker_redesign`) moved the CB into broker-alpaca-adpt with feature flags + notifications. The test was likely written against an earlier design where flags were directly toggleable; the post-redesign wiring may not propagate CB state to feature flags.

**Independent of `decision-workflow-ctrl-sf-stuck-waitforcompliance`** — different code path, different domain. Fixing one does not fix the other.

Surfaced 2026-05-09 during validation gate of `advisory-empty-state-pending-decisions-count` workstream.
