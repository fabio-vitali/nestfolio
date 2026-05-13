---
id: revoke-mandate-e2e-timeout-flake
status: queued
rank: 9
type: bug
notes: "revoke-mandate e2e scenario times out intermittently against deployed dev — root cause unknown, not in the operating-mode or compliance subsystems."
references:
  - "apps/e2e-feature-tests/src/profile/revoke-mandate.e2e.test.ts"
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# `revoke-mandate.e2e.test.ts` intermittent timeout

Surfaced 2026-05-10 in the validation_gate of `non-investor-profile-trigger-operating-mode-lookup` ("30/33 PASS — … 1 revoke-mandate timeout in different subsystem"). Not previously filed; the flake is described as "in a different subsystem" — i.e. unrelated to the operating-mode lookup work that surfaced it, root cause not yet localised.

Distinct from the resolved `investor-bff-double-revoke-assertion-mismatch` (shipped 2026-05-11) which addressed an assertion regex mismatch on the double-revoke path — this is a wall-clock timeout on the single happy-path scenario.

## Cheapest next step

Re-run `apps/e2e-feature-tests/src/profile/revoke-mandate.e2e.test.ts` 3× against deployed dev with `--verbose`; if it reproduces, capture which `waitForGraphQL`/`getProfile` poll exceeds its budget. Likely candidates: SQS-to-DDB lag on `MANDATE_REVOKED` projection in `investor-bff`, or a missing subscription update on the mandate row.
