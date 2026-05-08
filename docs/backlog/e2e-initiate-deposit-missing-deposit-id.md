---
id: e2e-initiate-deposit-missing-deposit-id
status: shipped
type: bug
notes: "fund-account + circuit-breaker e2e fail: initiateDeposit missing depositId (ID!)"
references:
  - apps/e2e-feature-tests/src/funding/fund-account.e2e.test.ts#L49-L62
  - apps/e2e-feature-tests/src/account/circuit-breaker-lifecycle.e2e.test.ts#L60-L67
  - services/investor/investor-bff/src/schema.graphql#L182-L186
out_of_scope:
  - Schema change to make depositId server-generated (Option 2 in backlog) — keep production schema strict.
  - Touching withdrawal call sites or any other GraphQL mutation that does not currently fail.
  - Rerunning the full e2e suite — only the two affected suites (fund-account + circuit-breaker-lifecycle) need to gate.
spec: null
plan: null
topic_memory: []
validation_gate: |
  Against deployed dev (NESTFOLIO_INTEG_PREFIX=dev), both touched e2e suites pass:
  - apps/e2e-feature-tests/src/funding/fund-account.e2e.test.ts — 1/1 PASS (79.7s, 2026-05-08)
  - apps/e2e-feature-tests/src/account/circuit-breaker-lifecycle.e2e.test.ts — 2/2 PASS (48.4s, 2026-05-08)
  Lint: pnpm nx run e2e-feature-tests:lint — 0 errors (warnings pre-existing in unrelated helpers).
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
