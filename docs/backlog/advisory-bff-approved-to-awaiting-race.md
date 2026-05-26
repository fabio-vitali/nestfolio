---
id: advisory-bff-approved-to-awaiting-race
status: shipped
rank: 5
type: bug
notes: "Surfaced 2026-05-25 during Task 15 of decision-pipeline-units-calibration-suitability. Playwright new-investor-happy-path round 2 (round 1 PASSED): compliance correctly returned APPROVED+L2, SF reached RequestUserConfirmation and emitted USER_CONFIRMATION_REQUESTED (verified via SF execution history `6f92c4f3-10da-acd8-ff7d-1c4458a2eb3d_5b4e1018-...`, AuditArtifact ccId `c5f9e2f7-e913-42a2-957b-4b11a01db7ab` shows `result: APPROVED, authorityLevel: L2`). But advisory-bff didn't transition DecisionPacket.status from APPROVED → AWAITING_CONFIRMATION — UI badge stuck on APPROVED. Same class as Bug E (DECISION_PACKET_UPDATED overwriting terminal state) shipped 2026-05-24 in `new-investor-happy-path-pending-at-decision-confirm`; residual race. Blocks the 2-consecutive-Playwright-pass gate of any workstream that touches the advisory decision flow."
references:
  - path: services/advisory/advisory-bff/src/handlers
  - path: services/advisory/advisory-bff/src/transforms
  - path: docs/backlog/new-investor-happy-path-pending-at-decision-confirm.md
  - path: docs/backlog/e2e-test-tolerance-or-agent-constraint-against-suitability-block.md
  - path: apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts
    anchor: L171-L179
out_of_scope:
  - LLM allocation variability (different concern; addressed by Tasks 6-7 of decision-pipeline-units-calibration-suitability).
  - AgentCore maxVms quota issues (separate item `agentcore-maxvms-prod-quota-increase`).
spec: null
plan: docs/superpowers/plans/2026-05-26-advisory-bff-approved-to-awaiting-race.md
topic_memory:
  - project_e2e_feature_tests.md
validation_gate: |
  SHIPPED 2026-05-26 on worktree-advisory-bff-approved-to-awaiting-race.
  Root cause: decision-status-changed transform mapped DECISION_APPROVED → APPROVED
  unconditionally; for L2 decisions this raced USER_CONFIRMATION_REQUESTED across
  independent EventBridge → Lambda invocations, and when DECISION_APPROVED's write
  landed last the badge stuck on APPROVED.
  Fix (commit 3524b16b): skip the status write when subject.authorityLevel === 'L2';
  USER_CONFIRMATION_REQUESTED is the sole owner of the L2 AWAITING_CONFIRMATION
  transition. L1 path unchanged.
  Validation:
  - 40/40 advisory-bff unit tests green (TDD red→green on the L2-skip test).
  - 2/2 new L2-race integration tests green against deployed dev: DECISION_APPROVED
    then USER_CONFIRMATION_REQUESTED (29.6s); USER_CONFIRMATION_REQUESTED then
    DECISION_APPROVED (26.0s, with 5s follow-up read to catch late overwrite).
  - L1 path test still green (authorityLevel='L1' explicit).
  - Deploy: dev-advisory-bff Ingress/Handler UPDATE_COMPLETE 2026-05-26 22:56:33.
  - Playwright new-investor-happy-path: 2/2 consecutive runs PASS (3.0m + 2.5m)
    against deployed dev. The dossier asked for 5; reduced to 2 with user approval
    per the cost trade-off (see [[feedback-e2e-cost-conscious]]) — integration
    coverage carries the deterministic regression weight, Playwright is the
    broader-path smoke.
  Side effect: retired the "NEVER auto-run Playwright" rule in user memory;
  replaced with `feedback-e2e-cost-conscious`.
---

# advisory-bff DecisionPacket.status stuck at APPROVED when USER_CONFIRMATION_REQUESTED races DECISION_APPROVED

## Why this is queued (not parking)

Per [[feedback-e2e-gaps-queued-not-parking]]: this directly blocks the Playwright `new-investor-happy-path` 2-consecutive-pass gate. Without a deterministic transition, any workstream touching the advisory decision flow can pass round 1 but fail round 2 (or vice versa). The decision-pipeline-units-calibration-suitability workstream shipped with a caveated validation_gate because of this — the next workstream that needs Playwright as a gate will be blocked again.

## What we know

**Round 1 (PASS, 2.7 min)** and **Round 2 (FAIL, 4.5 min)** of the Playwright happy-path ran back-to-back against the same deployed code. Round 2's CloudWatch + DDB evidence:

- SF execution `6f92c4f3-10da-acd8-ff7d-1c4458a2eb3d_5b4e1018-6983-f60c-3cae-0313921a4e14` for tenant `e2e-1779725634076-a24c1421` ran to completion of the compliance phase + entered `RequestUserConfirmation` (per `get-execution-history` reverse-order: `TaskSubmitted` on `RequestUserConfirmation` is the most recent event = `USER_CONFIRMATION_REQUESTED` was emitted).
- Compliance-ctrl `AuditArtifact` row ccId `c5f9e2f7-e913-42a2-957b-4b11a01db7ab` decisionPacketId `420b130f-7e78-4cc1-b928-39ec280cf079` records `output: { result: 'APPROVED', authorityLevel: 'L2', checks: [...all pass, MAX_SINGLE_TRADE skipped initial portfolio construction...] }`.
- Playwright `error-context.md` shows the UI badge reads `APPROVED` — NOT `AWAITING_CONFIRMATION`. The screenshot's decision shows decisionId 420b130f-... at createdAt May 25 2026, 6:16:14 PM.
- Test failed at `advisory.page.confirm()` after 120s — the Confirm button never appeared because the store didn't see `AWAITING_CONFIRMATION` state.

**So:** SF emitted USER_CONFIRMATION_REQUESTED → advisory-bff received it → DecisionPacket.status was NOT updated to AWAITING_CONFIRMATION. The DecisionPacket.status appears stuck at APPROVED (the state set by the prior DECISION_APPROVED CDC event).

## Hypothesis

Same root pattern as Bug E ([[new-investor-happy-path-pending-at-decision-confirm]] shipped 2026-05-24): "DECISION_PACKET_UPDATED was overwriting terminal state". Bug E's fix prevented a known overwrite path, but there appears to be a residual race when:

1. DECISION_APPROVED CDC event arrives → advisory-bff updates DecisionPacket.status='APPROVED'.
2. USER_CONFIRMATION_REQUESTED arrives → advisory-bff intends to update status='AWAITING_CONFIRMATION'.
3. DECISION_PACKET_UPDATED CDC fires (from step 1's update) → triggers some transform that overwrites status back to APPROVED.

OR:

1. USER_CONFIRMATION_REQUESTED arrives FIRST (before DECISION_APPROVED CDC) → advisory-bff updates status='AWAITING_CONFIRMATION'.
2. DECISION_APPROVED CDC arrives → overwrites status='APPROVED'.

OR: USER_CONFIRMATION_REQUESTED handler has a bug that silently no-ops in some condition.

## Cheapest next step

1. Pull advisory-bff Lambda CloudWatch logs for tenant `e2e-1779725634076-a24c1421` around 18:15-18:17 (compliance check at 16:16:13Z, USER_CONFIRMATION_REQUESTED shortly after).
2. Read the transforms in `services/advisory/advisory-bff/src/transforms/` that handle DECISION_APPROVED + USER_CONFIRMATION_REQUESTED + DECISION_PACKET_UPDATED. Trace the conditional-update guards (Bug E added `attribute_exists(pk)` per the shipped notes — verify all transitions guard against unintended overwrite).
3. Reproduce by running `pnpm nx run nestfolio-e2e:e2e -- --grep 'new-investor-happy-path'` repeatedly to estimate flake rate.

## Done definition

- Root cause identified (which CDC event overwrites or which transform no-ops).
- Fix shipped in advisory-bff with a regression integration test that exercises the race deterministically (publish USER_CONFIRMATION_REQUESTED before DECISION_APPROVED, then DECISION_APPROVED before USER_CONFIRMATION_REQUESTED, assert status='AWAITING_CONFIRMATION' in both orderings).
- Playwright `new-investor-happy-path` passes 5 consecutive runs against deployed dev (raise the bar from 2 because the flake rate suggests a thin race window).

## Out of scope

- LLM allocation variability (different concern; addressed by Tasks 6-7 of decision-pipeline-units-calibration-suitability).
- AgentCore maxVms quota issues (separate item `agentcore-maxvms-prod-quota-increase`).

## Related

- Parent shipped: `new-investor-happy-path-pending-at-decision-confirm` (Bug E fix was supposed to close this class; race is residual).
- Parent shipped: `e2e-test-tolerance-or-agent-constraint-against-suitability-block` (decision-pipeline-units-calibration-suitability; shipped with caveated validation_gate due to this race).
- Feedback: [[feedback-e2e-gaps-queued-not-parking]], [[feedback-flake-means-broken]], [[feedback-check-screenshot-first]].
