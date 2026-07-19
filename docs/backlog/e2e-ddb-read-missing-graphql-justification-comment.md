---
id: e2e-ddb-read-missing-graphql-justification-comment
status: parking
type: bug
notes: "E2E convention check #5 (hard fail): several e2e scenario tests assert via direct DDB reads with no comment justifying why BFF GraphQL is insufficient."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# e2e tests read DDB directly without the required GraphQL-insufficiency justification comment

## Evidence (audit-e2e-test judgment check, surfaced 2026-07-19 by the pre-ship deploy-gate on backlog item e2e-fixtures-test-stale-detail-envelope-assertion — unrelated to that item's own fix)

E2E convention check #5 (hard fail): direct DDB reads/assertions in test bodies must carry a comment explaining why BFF GraphQL is insufficient. Several scenario tests assert downstream state by reading DDB read-model rows with no such justifying comment. `go-live-switch` even reads the investor-bff `InvestorProfile` row's `executionMode` via DDB when that field is surfaced through GraphQL (the `confirmGoLive` mutation returns it). Others read cross-domain ctrl read models (compliance-ctrl MandateSnapshot/ComplianceCheck, reconciliation-ctrl PositionCache, investor-ctrl, broker-ctrl ExecutionMode) — plausibly legitimate but undocumented per the convention.

grep for justification keywords ('GraphQL insufficient', 'SYSTEM-scoped', etc.) returns none in these files; DDB reads at:
- `src/account/go-live-switch.e2e.test.ts:57,67,85`
- `src/advisory/operating-mode-authority.e2e.test.ts:60,79`
- `src/profile/update-operating-mode.e2e.test.ts:55,78`
- `src/advisory/reconciliation-correction.e2e.test.ts:64,93`
- `src/account/circuit-breaker-lifecycle.e2e.test.ts:151`

## Cheapest next step

For each read, either add the justification comment (if the DDB read is genuinely necessary — e.g. cross-domain read models not exposed via any GraphQL query) or replace it with the equivalent BFF GraphQL query where one already exists (`go-live-switch`'s `executionMode` case).
