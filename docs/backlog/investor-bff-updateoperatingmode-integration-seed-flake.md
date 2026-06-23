---
id: investor-bff-updateoperatingmode-integration-seed-flake
status: parking
type: bug
notes: "investor-bff integration updateOperatingMode test flakes (InvalidState: mandate inactive) — fires the mutation with no wait-for-Mandate-ACTIVE guard; depends on a prior test's eventually-consistent seed"
references:
  - services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: integration-test-timing-fragility
epic_role: core
---

# investor-bff integration `updateOperatingMode` eventual-consistency seed flake

Surfaced 2026-06-17 during `onboarding-mandatelevel-contract-gap` validation. The integration
test `updateOperatingMode bumps Mandate __version and emits OPERATING_MODE_CHANGED`
(`investor-bff.integration.test.ts:693`) FAILED on first run with
`InvalidState: "Cannot change operating mode (mandate inactive or profile missing)"` (8 s), then
PASSED on rerun (33 s). Flake = the test does sometimes fail; not dismissable as noise.

## Root cause (hypothesis)
The test relies on the Mandate row seeded ~500 lines earlier by the
`should atomically write composite InvestorProfile + Mandate row on ONBOARDING_COMPLETED` test
(via the async ONBOARDING_COMPLETED → SQS → event-listener → transactWrite path), but fires the
`updateOperatingMode` mutation with NO explicit wait for the Mandate row to be present + `status =
ACTIVE`. The resolver's TransactWrite preconditions are `attribute_exists(pk)` (profile) and
`attribute_exists(pk) AND #status = :active` (Mandate) (see
`test/unit/graphql/update-operating-mode.test.ts:25,35`); under eventual-consistency lag the
Mandate isn't visible/ACTIVE yet → the transaction is cancelled → clean InvalidState. The much
longer rerun duration (33 s vs 8 s) is consistent with the write settling on the slower path.

NOT caused by the mandateLevel change: that only alters the mandate `level` VALUE (DISCRETIONARY
for `integ-` tenants, identical before/after); `status: 'ACTIVE'` is hardcoded in the transform
and the resolver/preconditions are untouched — so it cannot produce "mandate inactive."

## Cheapest fix
Add a `table.waitForItem({ sk: 'Mandate', … })` (or a poll asserting `status === 'ACTIVE'`)
before the `updateOperatingMode` mutation, instead of depending on a prior test's implicit
side-effect across an async CDC hop. Likely shares a root-cause theme with
[[integration-deep-coldstart-flakes-post-trap-hardening]] (integration-test timing fragility);
candidate for clustering into a theme epic on the next `/backlog-themes` sweep.
