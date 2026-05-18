---
id: update-operating-mode-cdc-silent
status: shipped
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
validation_gate: |
  Reproduction confirmed 2026-05-18 12:19 UTC: bug failed at line 182 in 124.8s, line 176 (OPERATING_MODE_CHANGED) passed. Empty captured-but-unmatched buffer + line-182 failure = semantic event delivered, carrier event missing.
  Diagnostic instrumentation added to libs/event-processor/src/pipelines/change-data-capture.ts (temporary console.log on record/publishing/publish-OK). Deployed dev-investor-bff at 12:56 UTC. Re-run e2e: PASS in 58.7s — CDC-TRACE logs proved BOTH events published in ONE batch (`publish OK 2`, same detail.id `bfe8604aad5a41d6a7352166a754b19f`, DetailTypes INVESTOR_PROFILE_UPDATED + OPERATING_MODE_CHANGED).
  4/4 PASS post-redeploy with instrumentation.
  Instrumentation reverted. Redeployed dev-investor-bff at ~14:?? UTC (clean bundle, no logs). 3/3 PASS — 72.7s, 100.1s, 67.6s.
  Total: 7/7 consecutive PASS after redeploy.
  Verified pre-existing unit coverage at libs/event-processor/test/pipelines/change-data-capture.test.ts:155-252 covers the always+onFieldChange path for operatingMode, goal, and the empty-change case. Tests green.
  Root cause: stale Lambda bundle from the 2026-05-13 investor-bff deploy (the only structural change between the 2026-05-08 resplit ship and 2026-05-18 surfacing). The CFN stack updated 2026-05-13 13:17 UTC but the deployed bundle's behavior did not match source-level resolveEmissions. Post-redeploy bundle works correctly. Unverifiable retroactively (Lambda version history shows only $LATEST).
  Alternative root-cause candidate (cannot rule out): transient EB-side per-entry delivery failure that did not throw NotRetryableError. Would not be caught by the publisher's retry loop because EB returned FailedEntryCount=0 for the dropped entry. No CloudWatch evidence supports this hypothesis (no warning/error log entries on the deployed Lambda in the failing window).
validation_gate_residual_risk: |
  If the stale-bundle theory is correct, the same drift could happen on any future deploy where CDK believes the asset hash is unchanged. Mitigation candidate (filed as follow-up): emit a deploy-time integrity check that the bundle's embedded change-data-capture.ts contains the expected resolveEmissions shape (e.g., grep the bundle for "onFieldChange" before declaring deploy successful). Out of scope for this workstream — file separately.
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

## Resolution (2026-05-18)

**No code change required.** Investigation timeline:

| Phase | Finding |
|---|---|
| Hypothesis pivot | Falsified the dossier's original "missing onFieldChange entry" theory — `services/investor/investor-bff/src/service.stack.ts:64-74` declares both events correctly. |
| Code review | `libs/event-processor/src/pipelines/change-data-capture.ts:95-107` correctly pushes the `always` carrier unconditionally + adds `onFieldChange` semantics. Unit tests at `libs/event-processor/test/pipelines/change-data-capture.test.ts:155-252` cover the operatingMode case comprehensively + pass. |
| Reproduction | Re-ran the e2e against the deployed dev investor-bff at 2026-05-18 12:19 UTC — bug reproduced at 124.8s with line-182 failure. Same signature as the dossier. |
| Diagnostic instrumentation | Added temporary `console.log` to the CDC publisher's processRecord, redeployed investor-bff. |
| Re-run with instrumentation | 4/4 PASS. CDC-TRACE proved both events published in one batch with `publish OK 2`. Both entries share `detail.id` (same DDB stream record); EB does not dedupe on `detail.id`. |
| Clean redeploy | Reverted instrumentation, redeployed. 3/3 PASS (72.7s, 100.1s, 67.6s). |

**Most likely root cause:** the 2026-05-13 deploy of `dev-investor-bff` produced a stale Lambda bundle relative to source. The CFN stack updated, but the bundled `change-data-capture.ts` somehow lagged behind the 2026-05-08 resplit ship. Cannot be verified retroactively — Lambda version history shows only `$LATEST` (no historical CodeSha256 to compare).

**Mitigation applied:** `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff` regenerates the bundle from current source. Confirmed working post-redeploy (7/7 PASS).

**Cannot rule out (alternative):** transient EB-side per-entry delivery failure during the 2026-05-18 12:19 window that did NOT surface as `FailedEntryCount > 0` to the publisher's retry loop. If this is the real cause, recurrence is random. No CloudWatch evidence supports this hypothesis (no Lambda errors or EB throttle warnings in the failing window).

**Follow-up filed:** see [[cdk-bundle-staleness-deploy-integrity]] for the deploy-time integrity-check proposal (out of scope for this workstream).

## Related history

A prior entry `update-operating-mode-mutation-rederivation-gap.md` was DROPPED 2026-05-08 ("superseded by investor-profile-domain-resplit"). The resplit added the mutation + resolver, but the publisher contract (CDC eventTypes wiring) regressed or was never completed. This dossier covers the publisher half specifically.

## Cheapest next step

Read the investor-bff `service.stack.ts` Egress construct, find the `eventTypes` map for the composite InvestorProfile row, check whether `operatingMode` change → `OPERATING_MODE_CHANGED` is declared and whether the carrier `INVESTOR_PROFILE_UPDATED` fires unconditionally on MODIFY. ~30-45 minute fix once the gap is identified. Add a regression unit test asserting both events fire on mode-only update.

## Why queued (not parking)

Per `feedback_e2e_gaps_queued_not_parking.md` — anything required to make `apps/e2e-feature-tests` green is queued. This is currently blocking 1 e2e scenario.
