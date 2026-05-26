---
id: update-operating-mode-cdc-silent
status: shipped
type: bug
notes: "CLOSED 2026-05-26 as no-repro after 3 consecutive runs against deployed dev with the diagnostic observer live — INVESTOR_PROFILE_UPDATED + OPERATING_MODE_CHANGED arrived together on every run with identical detail.id. The 2026-05-21 recurrence is now untestable retroactively; the dossier's surviving 'intermittent carrier loss' hypothesis is unfalsifiable from clean traces. Test still red, but at line 224 (compliance-ctrl rejects injected RECOMMENDATION_PROPOSED with portfolioValueCents schema mismatch) — distinct bug filed as update-operating-mode-e2e-portfolio-value-cents-mismatch."
references:
  - services/investor/investor-bff/src/service.stack.ts
  - libs/event-processor/src/pipelines/change-data-capture.ts
  - libs/event-processor/src/util/event-bridge-publisher.ts
  - libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts
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
  3 consecutive runs of apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts against deployed dev (2026-05-26 12:39 / 12:44 / 12:48 UTC). Carrier (INVESTOR_PROFILE_UPDATED) + semantic (OPERATING_MODE_CHANGED) arrived together on every run per the dev-investor-cdc-observer CloudWatch Logs trail at /aws/events/dev-investor-cdc-observer (tenants: e2e-1779799127433-6398a994, e2e-1779799476190-c0eda41f, e2e-1779799672045-42c418a5; identical detail.id per pair). Test still RED — fails at line 224 with `ComplianceCheck row for decisionId=... not found within 120 s` because compliance-ctrl rejects the directly-injected RECOMMENDATION_PROPOSED with `Missing fields: portfolioValueCents` (3/3 runs in compliance-ctrl Ingress logs). That distinct schema-mismatch bug is filed at [[update-operating-mode-e2e-portfolio-value-cents-mismatch]]. Observer torn down post-ship (4 AWS resources removed).
---

# updateOperatingMode CDC silent on mode-only change

## REOPENED 2026-05-21 — the 2026-05-18 resolution is falsified

The full feature e2e suite on 2026-05-21 reproduced this bug with the **identical signature**: `update-operating-mode.e2e.test.ts:182` timed out waiting for `INVESTOR_PROFILE_UPDATED` after 60 000 ms, empty captured-but-unmatched buffer; line 176 (`OPERATING_MODE_CHANGED`) passed. 32/33 scenarios green — this the lone failure.

**The "stale Lambda bundle" root cause is disproven:**

- `git log --since=2026-05-18 -- services/investor/investor-bff/` is **empty** — zero source commits since the redeploy.
- The `dev-investor-bff-EgressPublisher…` Lambda's `LastModified` is **2026-05-18T13:09:42** — unchanged since the 2026-05-18 redeploy.
- Therefore today's deployed CDC publisher bundle is **byte-identical** to the one that passed 7/7 on 2026-05-18. A bundle that was never re-deployed cannot acquire a "staleness" defect. The stale-bundle theory is falsified — and with it the premise of [[cdk-bundle-staleness-deploy-integrity]].

**Surviving hypothesis: intermittent single-event (carrier) loss.** Static re-analysis confirms there is **no deterministic code path** that drops the carrier while keeping the semantic:

- `change-data-capture.ts:95-107` — the `always` carrier is pushed unconditionally; both emissions go into one `publisher.publish([carrier, semantic])` call.
- `event-bridge-publisher.ts` — partial `PutEvents` failure is handled: retryable codes retry only the failed entries; exhaustion throws (→ record-level Lambda retry, i.e. duplication, never a silent drop).
- `buildEntry` (`change-data-capture.ts:123-133`) — both events' `detail.context` is built from the same `record`, so the EventBusTrap rule (`detail.context.tenantId` + `detail-type`) matches both or neither. `OPERATING_MODE_CHANGED` arrived ⇒ the carrier would route identically **if published**.
- `event-bus-trap.fixture.ts` — dedups by SQS `MessageId` (unique per message), not `detail.id`; once a message lands in the trap queue it is received + buffered, never dropped.

So the carrier intermittently never reaches the trap's SQS queue despite identical routing — environmental/timing, not yet pinned to publisher-side vs. EB→SQS-target-side loss.

## Diagnostic observer — LIVE since 2026-05-22

A non-perturbing EventBridge → CloudWatch Logs observer is deployed on dev (account 771924376645, us-east-1). `console.log` instrumentation on the Lambda perturbs timing and masks the bug (the false 7/7 on 2026-05-18); this observer adds zero load to the publish path.

**Resources:**
- EB rule `dev-investor-cdc-observer` on bus `dev-investor-event-bus` — pattern `{"detail-type":["INVESTOR_PROFILE_UPDATED","OPERATING_MODE_CHANGED"]}` (no tenant filter — dev is low-volume; scope at read time).
- Target → CW Logs group `/aws/events/dev-investor-cdc-observer` (14-day retention).
- CW Logs resource policy `EventBridgeToCWLogs-cdc-observer`.

Verified end-to-end 2026-05-22 with a synthetic event (`detail.id=canary-verify`).

**On the next failing `update-operating-mode.e2e.test.ts` run**, note the test's `e2e-…` tenantId, then:

```
AWS_PROFILE=nestfolio-dev aws logs filter-log-events --region us-east-1 \
  --log-group-name /aws/events/dev-investor-cdc-observer \
  --filter-pattern '"<tenantId>"'
```

Interpretation:
- **both** event types present for that tenant ⇒ the carrier reached EventBridge; the loss is EB→SQS target delivery to the trap (or trap-side). Investigate the trap rule/SQS path — not the publisher.
- **only** `OPERATING_MODE_CHANGED` present ⇒ publisher-side loss — the carrier never reached EB. Revisit `EgestionEngine` batching / `bisectBatchOnError` and the `PutEvents` result handling in `event-bridge-publisher.ts`.

**Teardown** (run after the root cause is pinned and the observer is no longer needed):

```
AWS_PROFILE=nestfolio-dev aws events remove-targets --region us-east-1 --rule dev-investor-cdc-observer --event-bus-name dev-investor-event-bus --ids cw-logs
AWS_PROFILE=nestfolio-dev aws events delete-rule --region us-east-1 --name dev-investor-cdc-observer --event-bus-name dev-investor-event-bus
AWS_PROFILE=nestfolio-dev aws logs delete-log-group --region us-east-1 --log-group-name /aws/events/dev-investor-cdc-observer
AWS_PROFILE=nestfolio-dev aws logs delete-resource-policy --region us-east-1 --policy-name EventBridgeToCWLogs-cdc-observer
```

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

## Resolution (2026-05-18) — FALSIFIED, see "REOPENED 2026-05-21" above

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

## Promoted to QUEUED 2026-05-24

Originally re-parked 2026-05-22 on the rationale that the actionable next step was gated on the diagnostic observer first capturing a fresh failing run. Promoted per the e2e-blocking-items-go-queued discipline (`feedback_e2e_gaps_queued_not_parking.md`): the test is RED and the observer is live, so an investigator picking this up can drive a failing run themselves and read the trail in `/aws/events/dev-investor-cdc-observer` as the first concrete step — no further external signal required.

## Closed no-repro 2026-05-26

Three consecutive runs of `update-operating-mode.e2e.test.ts` against deployed dev, with the diagnostic observer live, all delivered both events cleanly:

| Run | Time (UTC) | Tenant | OPERATING_MODE_CHANGED | INVESTOR_PROFILE_UPDATED | shared detail.id |
|---|---|---|---|---|---|
| 1 | 12:39:10 | `e2e-1779799127433-6398a994` | ✓ | ✓ | `faa572996ac43b8cfc2f3c4b1b477376` |
| 2 | 12:44:59 | `e2e-1779799476190-c0eda41f` | ✓ | ✓ | `b47411d4cf9d1f6d4fe393333905e057` |
| 3 | 12:48:35 | `e2e-1779799672045-42c418a5` | ✓ | ✓ | `986d4924c04c33b45c85e6c2cc8206c2` |

The identical `detail.id` per pair confirms both events came from the SAME DDB stream record's emission batch (see `libs/event-processor/src/pipelines/change-data-capture.ts:123-148` — `buildEntry` derives `detail.id` from `ctx.record.eventID`). The observer is on the EventBridge bus itself (rule pattern `{"detail-type":["INVESTOR_PROFILE_UPDATED","OPERATING_MODE_CHANGED"]}`, no tenant filter), so it sees every event that reaches the bus regardless of downstream rules. Empirically, the publisher is not losing the carrier today.

**Why this closes the workstream:**

- The 2026-05-21 reproduction is now untestable. The bundle is the same (Lambda `LastModified` unchanged since 2026-05-18T13:09:42), the source is the same (zero investor-bff source commits since), and 3 fresh runs against this stable state show consistent emissions. If the bug is intermittent at a rate below ~1-in-3, the next investigator needs either (a) a sustained failure-rate baseline (multi-day observer capture) or (b) a different reproduction trigger to make progress.
- The dossier's investigation cost (instrument → reproduce → diagnose) far exceeds the residual signal. Re-opening is justified only on a fresh failing capture at `update-operating-mode.e2e.test.ts:182` with empty trap buffer.

**Why the test stays RED (filed separately):**

3/3 runs the test reaches line 224 and times out on `ComplianceCheck row for decisionId=... not found within 120 s`. Compliance-ctrl `/aws/lambda/dev-compliance-ctrl-IngressHandler...` logs from the 3 runs (12:39:16, 12:45:06, 12:48:45) all show:

```
{"level":"ERROR","message":"record processing failed",
 "eventType":"RECOMMENDATION_PROPOSED",
 "errorMessage":"Missing fields: portfolioValueCents", "retryable":false}
```

The test publishes `portfolioValue: CAPITAL_AMOUNT` (line 218) but compliance-ctrl validates `portfolioValueCents`. Schema-contract drift, separate from CDC. Filed at [[update-operating-mode-e2e-portfolio-value-cents-mismatch]] (queued, rank 2).

**Observer teardown** — diagnostic infrastructure no longer needed, removed in this ship:

```
aws events remove-targets --rule dev-investor-cdc-observer --event-bus-name dev-investor-event-bus --ids cw-logs
aws events delete-rule --name dev-investor-cdc-observer --event-bus-name dev-investor-event-bus
aws logs delete-log-group --log-group-name /aws/events/dev-investor-cdc-observer
aws logs delete-resource-policy --policy-name EventBridgeToCWLogs-cdc-observer
```

**Reopen criteria:** a fresh failing capture at `update-operating-mode.e2e.test.ts:182` (or any other consumer) with carrier missing but semantic present, OR an integration test for the publisher that hits the same code path under simulated EB partial-delivery and demonstrates a silent drop.
