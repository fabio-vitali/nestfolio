---
id: e2e-initiate-deposit-missing-deposit-id
status: parking
type: bug
notes: "fund-account + circuit-breaker e2e fail: initiateDeposit missing depositId (ID!)"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# E2E initiateDeposit tests missing required depositId field

## Evidence

- `apps/e2e-feature-tests/src/funding/fund-account.e2e.test.ts:49` — passes `{ input: { amountCents: 500_000, currency: 'USD' } }` with no `depositId`.
- `apps/e2e-feature-tests/src/account/circuit-breaker-lifecycle.e2e.test.ts:60` — same pattern, three separate `initiateDeposit` calls in the lifecycle test (Phase 1, Phase 2 block-check, Phase 3 re-enable).
- `services/investor/investor-bff/src/schema.graphql` — `input DepositInput { depositId: ID! … }` — field is NonNull.
- Both tests fail with: `GraphQL errors: [{"message":"Variable 'input' has coerced Null value for NonNull type 'ID!'"}]`

## Status

Pre-existing on `main` before the investor-profile-domain-resplit branch. Not introduced by the resplit. Confirmed by diffing test files: no change to the `initiateDeposit` call sites on the branch.

## Cheapest fix

Either:
1. Generate a UUID v4 in the test call site: `{ input: { depositId: crypto.randomUUID(), amountCents: ..., currency: 'USD' } }` (test-side, 3 edits).
2. Make `depositId` optional in `DepositInput` and generate it server-side in `initiate-deposit.fn.js` — schema change, requires redeployment.

Option 1 is cheapest and keeps the production schema strict. Apply to both test files.
