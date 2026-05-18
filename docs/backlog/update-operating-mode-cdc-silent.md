---
id: update-operating-mode-cdc-silent
status: queued
type: bug
rank: 2
notes: "updateOperatingMode mutation succeeds (DDB UpdateItem returns AGGRESSIVE row) but neither INVESTOR_PROFILE_UPDATED (carrier) nor OPERATING_MODE_CHANGED (semantic) reach the investor bus within 60s — empty EventBusTrap buffer. Blocks update-operating-mode.e2e.test.ts which is the only e2e covering the mode re-derivation chain."
references:
  - services/investor/investor-bff/src/schema.graphql
  - services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js
  - apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts
  - services/investor/investor-bff/CLAUDE.md
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_operating_mode.md
  - project_investor_profile_collapse.md
validation_gate: null
---

# updateOperatingMode CDC silent on mode-only change

## Surfacing run

E2e run 2026-05-18: `apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts:182` failed with `EventBusTrap: timeout waiting for event INVESTOR_PROFILE_UPDATED after 60000ms. Captured-but-unmatched buffer: []`. Buffer was empty for the full 60s window — no other event types either.

## Evidence

- Mutation **exists**: `services/investor/investor-bff/src/schema.graphql:11` — `updateOperatingMode(mode: OperatingMode!): InvestorProfile!`.
- Resolver **exists and looks correct**: `services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js` — `UpdateItem SET operatingMode = :mode, updatedAt = :now, #ts = :now` with `attribute_exists(pk)` condition. No region/auth issue visible.
- Mutation **returned the new mode**: test passed `expect(result.updateOperatingMode.operatingMode).toBe('AGGRESSIVE')` (line 168) before the trap timeout at line 182. DDB write therefore happened.
- Trap was armed BEFORE onboarding on `bus: investor`, `detailType: [OPERATING_MODE_CHANGED, INVESTOR_PROFILE_UPDATED]`, drained after onboarding, then waited for new events. **Neither event ever arrived** in 60s.
- `services/investor/investor-bff/CLAUDE.md:36` states the contract: "updateOperatingMode resolver writes operatingMode onto the composite InvestorProfile row — CDC emits INVESTOR_PROFILE_UPDATED (carrier) + OPERATING_MODE_CHANGED (semantic)." The contract is violated.

## Hypothesis

The Egress `eventTypes` declarative map on investor-bff's composite InvestorProfile row likely either:
1. Does not include `operatingMode` in the `onFieldChange` semantic-event mapping for `OPERATING_MODE_CHANGED`, AND
2. The carrier `INVESTOR_PROFILE_UPDATED` MODIFY trigger has a field-set filter that excludes the operatingMode-only update (which only mutates `operatingMode`, `updatedAt`, `timestamp`).

Alternative: the CDC pipe is broken entirely for this row's MODIFY path (no events would fire on ANY mutation, which would also break revokeMandate/updateGoal). To distinguish: re-run `revoke-mandate.e2e.test.ts` or `update-goal.e2e.test.ts` against the same deployed dev. Both passed in this run, so the pipe is working — narrowing the bug to operatingMode-specific filtering in the Egress eventTypes map.

## Related history

A prior entry `update-operating-mode-mutation-rederivation-gap.md` was DROPPED 2026-05-08 ("superseded by investor-profile-domain-resplit"). The resplit added the mutation + resolver, but the publisher contract (CDC eventTypes wiring) regressed or was never completed. This dossier covers the publisher half specifically.

## Cheapest next step

Read the investor-bff `service.stack.ts` Egress construct, find the `eventTypes` map for the composite InvestorProfile row, check whether `operatingMode` change → `OPERATING_MODE_CHANGED` is declared and whether the carrier `INVESTOR_PROFILE_UPDATED` fires unconditionally on MODIFY. ~30-45 minute fix once the gap is identified. Add a regression unit test asserting both events fire on mode-only update.

## Why queued (not parking)

Per `feedback_e2e_gaps_queued_not_parking.md` — anything required to make `apps/e2e-feature-tests` green is queued. This is currently blocking 1 e2e scenario.
