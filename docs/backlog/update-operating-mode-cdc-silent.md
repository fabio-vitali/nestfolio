---
id: update-operating-mode-cdc-silent
status: active
type: bug
rank: null
notes: "updateOperatingMode mutation succeeds (DDB UpdateItem returns AGGRESSIVE row) but neither INVESTOR_PROFILE_UPDATED (carrier) nor OPERATING_MODE_CHANGED (semantic) reach the investor bus within 60s — empty EventBusTrap buffer. Blocks update-operating-mode.e2e.test.ts which is the only e2e covering the mode re-derivation chain."
references:
  - services/investor/investor-bff/src/schema.graphql
  - services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js
  - services/investor/investor-bff/src/service.stack.ts
  - services/investor/investor-bff/CLAUDE.md
  - apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts
out_of_scope:
  - Rewriting the CDC publisher's general `always`+`onFieldChange` semantics. Fix the operatingMode-specific gap; don't redesign event-processor's CDC pipe wholesale.
  - Re-litigating the 2026-05-08 InvestorProfile resplit topology (3-tier carrier+semantic+lifecycle stays).
  - Adding a new e2e scenario. Re-greening the existing `update-operating-mode.e2e.test.ts` is the gate.
  - Backfilling integration coverage on other `onFieldChange` keys (goal) — distinct workstream if needed.
  - Compliance-ctrl downstream re-derivation (the chain past the publisher boundary).
  - Frontend/MFE consumer of OPERATING_MODE_CHANGED.
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

## Hypothesis (original — FALSIFIED 2026-05-18 adoption)

The dossier originally hypothesised the Egress `eventTypes` declarative map was missing the `operatingMode` entry. **Falsified by reading the code at adoption:** `services/investor/investor-bff/src/service.stack.ts:64-74` declares the full 3-tier topology correctly:

```ts
'InvestorProfile': {
  insert: InvestorBffEventTypes.INVESTOR_PROFILE_CREATED,
  modify: {
    always: InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
    onFieldChange: {
      operatingMode: InvestorBffEventTypes.OPERATING_MODE_CHANGED,
      goal: InvestorBffEventTypes.GOAL_UPDATED,
    },
  },
},
```

The `always: INVESTOR_PROFILE_UPDATED` on modify SHOULD fire unconditionally on every InvestorProfile row update (including operatingMode-only). The `onFieldChange.operatingMode: OPERATING_MODE_CHANGED` SHOULD fire because `operatingMode` IS the field being mutated. The CDC map is correct.

## New hypothesis (post-adoption)

The wiring at the CDK construct level is correct, but **something between "DDB row updated" and "events on InvestorBus" is broken**. Cheapest investigation order:

1. **Deploy skew.** Is the deployed dev investor-bff stack actually running the 2026-05-08 resplit code? If `dev-investor-bff` was last deployed before the resplit shipped, the running `event-publisher.ts` Lambda still has the carrier-only topology and the `onFieldChange.operatingMode` clause never reaches it. Check: `aws cloudformation describe-stacks --stack-name dev-investor-bff` and compare the `Egress/EventPublisher` Lambda `LastModified` timestamp to the resplit commit date (2026-05-08).
2. **Event-publisher Lambda implementation.** Read `services/investor/investor-bff/src/handlers/event-publisher.ts` (or `libs/event-processor/src/cdc/...` — wherever the CDC pipe lives) and trace what it actually does with the `always`+`onFieldChange` shape. Does it emit the carrier `always` event unconditionally? Does the `onFieldChange` check OldImage vs NewImage correctly (`OldImage.operatingMode.S !== NewImage.operatingMode.S`)?
3. **CloudWatch evidence.** Hit `aws logs tail /aws/lambda/dev-investor-bff-Egress... --since 1h` after a manual `updateOperatingMode` mutation on dev. If the Lambda fires but emits nothing, look for "no eventType matched" or similar log lines. If the Lambda does NOT fire, the DDB Stream → Lambda EventSourceMapping is broken (rare; check the ESM enabled flag and the stream ARN).
4. **Trap-side regression.** Does the e2e EventBusTrap filter on `source` AND `detailType`? If it filters on the wrong source (e.g. `investor-bff` vs `investor-bff@${SERVICE_NAME}`), events would arrive on the bus but the trap wouldn't see them. `revoke-mandate.e2e.test.ts` + `update-goal.e2e.test.ts` passing rules out a TOTAL trap-side break but not a per-event filter mismatch.

The fix is whichever of (1)–(4) the investigation surfaces — could be a redeploy, a 1-line fix in the publisher, or a trap-side filter correction.

## Validation gate

- `apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts` passes 3 consecutive runs against deployed dev (per [[feedback-flake-means-broken]]).
- No regression in `revoke-mandate.e2e.test.ts` or `update-goal.e2e.test.ts` (same Egress map covers all three).
- CloudWatch evidence (Logs Insights query saved into validation_gate) showing the egress Lambda emits both events on a mode-only mutation.

## Related history

A prior entry `update-operating-mode-mutation-rederivation-gap.md` was DROPPED 2026-05-08 ("superseded by investor-profile-domain-resplit"). The resplit added the mutation + resolver, but the publisher contract (CDC eventTypes wiring) regressed or was never completed. This dossier covers the publisher half specifically.

## Cheapest next step

Read the investor-bff `service.stack.ts` Egress construct, find the `eventTypes` map for the composite InvestorProfile row, check whether `operatingMode` change → `OPERATING_MODE_CHANGED` is declared and whether the carrier `INVESTOR_PROFILE_UPDATED` fires unconditionally on MODIFY. ~30-45 minute fix once the gap is identified. Add a regression unit test asserting both events fire on mode-only update.

## Why queued (not parking)

Per `feedback_e2e_gaps_queued_not_parking.md` — anything required to make `apps/e2e-feature-tests` green is queued. This is currently blocking 1 e2e scenario.
