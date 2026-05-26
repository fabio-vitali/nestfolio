---
id: operating-mode-changed-compliance-mandate-snapshot-e2e
status: shipped
type: design
rank: 3
notes: "Closed 2026-05-26 as already-covered. Verify-before-writing during /backlog-next brainstorming revealed the e2e assertion the dossier reserved was committed 2026-05-08 in de0d87aa, three days BEFORE the it.skip placeholder that motivated this dossier was deleted (2026-05-11). The dossier was promoted to QUEUED 2026-05-24 carrying a stale 'no coverage' claim. apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts:44-66 (waitForMandateSnapshotMode helper) is invoked at :137 (initial CONSERVATIVE materialization) and :190 (post-mutation AGGRESSIVE patch) — both direct field-level assertions on compliance-ctrl MandateSnapshot.operatingMode after the full CDC→adapter→handler chain."
references:
  - "services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js"
  - "services/investor/investor-bff/CLAUDE.md"
  - "apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts"
out_of_scope:
  - "Adding a new scenario file. The existing test already covers the happy-path chain assertion the dossier reserved."
  - "Strengthening with negative-direction coverage (AGGRESSIVE→CONSERVATIVE) or 6-pair transition matrix. Considered and rejected during brainstorming — handler is mode-agnostic, marginal value doesn't justify e2e wall-clock + Bedrock spend."
  - "Investigating why the 2026-05-11 it.skip deletion didn't catch that the e2e was already in place. Process retrospective, not a code change."
spec: null
plan: null
topic_memory:
  - project_operating_mode.md
validation_gate: "Existing e2e assertions in apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts (commit de0d87aa, 2026-05-08) directly poll compliance-ctrl MandateSnapshot.operatingMode at lines 137 (CONSERVATIVE post-onboarding) and 190 (AGGRESSIVE post-updateOperatingMode mutation) via waitForMandateSnapshotMode (lines 44-66). The full chain investor-bff CDC OPERATING_MODE_CHANGED → advisory-adpt forward → AdvisoryBus → compliance-ctrl handler → MandateSnapshot patch is asserted end-to-end. No new test required."
---

# Cross-service E2E: `OPERATING_MODE_CHANGED` → compliance-ctrl `MandateSnapshot` patch

**Origin:** former `it.skip('should propagate OPERATING_MODE_CHANGED to compliance-ctrl MandateSnapshot', …)` placeholder in `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts` (removed 2026-05-11 along with the parent investor-bff workstreams to take the suite to a true 18/18 green; this dossier preserves the coverage gap).

## What's currently covered
- investor-bff unit + integration: `updateOperatingMode` mutation writes `operatingMode` onto the composite InvestorProfile row.
- investor-bff CDC: `INVESTOR_PROFILE_UPDATED` (carrier) + `OPERATING_MODE_CHANGED` (semantic) emit on the field change (declarative `onFieldChange`, post-resplit).

## What's NOT covered end-to-end
The downstream chain:

```
investor-bff CDC OPERATING_MODE_CHANGED
  → advisory-adpt EventBridge rule (cross-domain forward)
  → AdvisoryBus
  → compliance-ctrl subscription handler
  → compliance-ctrl table: MandateSnapshot row patch (operatingMode)
```

No test asserts the MandateSnapshot row actually receives the patch when the investor flips operating mode.

## Why this matters
`MandateSnapshot` is the compliance authority resolver's read source for mode-aware policy evaluation (see `project_operating_mode.md`). A silent break in this chain would mean compliance decisions continue applying the stale mode without anyone noticing until the user files a "why was my conservative trade rejected as aggressive" ticket.

## Resolution path

Belongs in `apps/e2e-feature-tests`, not the investor-bff integration suite — the assertion crosses two services + two domains. Sketch:

1. Use `e2e-feature-tests` scaffolding (see `create-e2e-test` skill).
2. Drive: `updateOperatingMode` mutation via the AppSync client.
3. Assert: compliance-ctrl `MandateSnapshot` row's `operatingMode` field flips to the new value within a bounded wait (waitForItem with `operatingMode: 'X'` predicate).
4. Treat as test-passes-when-chain-completes; no assertion on intermediate hops (events are an implementation detail).

Out-of-scope for now: simulating compliance-ctrl latency, error-path testing (adapter rule mismatch, compliance handler failure).

## Promoted to QUEUED 2026-05-24

The "evidence of intent to ship" trigger is satisfied by an explicit prioritisation decision: this coverage gap is real (a silent break in the propagation chain would not be caught today) and lands in the e2e-blocking-items-go-queued discipline (`feedback_e2e_gaps_queued_not_parking.md`).

## Closed as already-covered 2026-05-26

Adopted to ACTIVE 2026-05-26 via `/backlog-next`. Verify-before-writing (CLAUDE.md § "Backlog Discipline" / [[feedback-verify-before-documenting]]) during brainstorming revealed the coverage gap doesn't exist.

**Evidence.** `apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts` (committed 2026-05-08 in `de0d87aa`, three days BEFORE the `it.skip` that this dossier preserved was deleted on 2026-05-11):

- Lines 44-66 — `waitForMandateSnapshotMode(ddbDoc, tableName, tenantId, userId, expectedMode)` helper. Polls compliance-ctrl DDB at `pk = GuardrailPolicy#{tenantId}#{userId}, sk = MandateSnapshot` until `operatingMode === expectedMode` (90s deadline, 3s interval).
- Line 137 — invoked in `beforeEach` to assert the initial CONSERVATIVE materialization after onboarding (chain: onboarding-completed → investor-bff CDC MANDATE_ISSUED → compliance-ctrl ingress → putMandateSnapshot).
- Line 190 — invoked in the scenario body to assert the post-mutation AGGRESSIVE patch (chain: updateOperatingMode mutation → investor-bff CDC OPERATING_MODE_CHANGED → advisory-adpt forward → compliance-ctrl handler `processOperatingModeChanged` at `services/advisory/compliance-ctrl/src/handlers/event-listener.ts:193-219` → MandateSnapshot patch).

The dossier's framing — "No test asserts the MandateSnapshot row actually receives the patch when the investor flips operating mode" — was true on 2026-05-11 only by accident: the e2e had already been written three days earlier in a separate workstream and the deletion didn't notice. The 2026-05-24 promotion to QUEUED carried the stale claim forward another 13 days.

**Considered and rejected.** Negative-direction coverage (AGGRESSIVE→CONSERVATIVE) and the full 6-pair transition matrix were considered during brainstorming and rejected — the compliance-ctrl handler is mode-agnostic (it patches whatever `event.detail.operatingMode` says), so marginal value doesn't justify the wall-clock + Bedrock spend.

**Same shape as `update-operating-mode-cdc-silent`** (closed no-repro 2026-05-26). Two dossiers in the same operating-mode topic, both shipped on the same day, both with no code change — a signal worth noting for the boundary review at the next workstream.
