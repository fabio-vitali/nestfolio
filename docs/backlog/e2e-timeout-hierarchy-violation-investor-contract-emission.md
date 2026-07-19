---
id: e2e-timeout-hierarchy-violation-investor-contract-emission
status: parking
type: tooling
notes: "investor-contract-emission.e2e.test.ts beforeEach hook sets a 30s timeout, below the documented 120s floor for this hook."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# investor-contract-emission E2E test violates the beforeEach timeout floor

`apps/e2e-feature-tests/src/investor/investor-contract-emission.e2e.test.ts:195-198` sets a
`beforeEach` timeout of `30_000`ms, below the documented `120_000`ms floor for this hook — a
convention violation distinct from the already-shipped [[e2e-jest-timeout-convention-drift]]
(which fixed the *documented* convention value itself, not an individual test's violation of it).
