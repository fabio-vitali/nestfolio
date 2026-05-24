---
id: new-investor-happy-path-pending-at-decision-confirm
status: shipped
rank: 3
type: bug
notes: "Badge transitions PENDING → BLOCKED/APPROVED/AWAITING_CONFIRMATION end-to-end. Three layered fixes shipped: Bug A (silent dedup, updateOrRetry+RetryablePreconditionError), Bug D (compliance-ctrl wrote decisionPacketId not decisionId), Bug E (DECISION_PACKET_UPDATED was overwriting terminal state). Playwright shows correct PENDING→BLOCKED transition; remaining BLOCKED-vs-AWAITING_CONFIRMATION discrepancy is Bug C (LLM non-determinism, filed separately)."
references:
  - path: services/advisory/advisory-bff/src/transforms/decision-status-changed.ts
    anchor: L11-L42
  - path: libs/event-processor/src/engine/intent-executor.ts
    anchor: L166-L188
  - path: libs/event-processor/src/intents/update-or-retry.ts
  - path: libs/event-processor/src/internal/errors.ts
    anchor: L14-L33
  - path: services/advisory/compliance-ctrl/src/handlers/event-listener.ts
    anchor: L63-L141
  - path: services/advisory/advisory-bff/src/transforms/decision-packet-created.ts
    anchor: L19-L52
out_of_scope:
  - "Bug B: services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts:83-87 reads narrative.explainability.rationale but advisory-narrative-ctrl returns narrative with rationale spread at top level — placeholder explanation always fires. Filed as `assemble-packet-narrative-explainability-key-mismatch`."
  - "Bug C: SuitabilityChecker can legitimately BLOCK when LLM produces equity allocations exceeding the risk-score cap (e.g. equity 55% > 50% for riskScore=5). The Playwright test's AWAITING_CONFIRMATION expectation is non-deterministic against agent output. Filed as `e2e-test-tolerance-or-agent-constraint-against-suitability-block`."
  - "Defensive root-cause sweep of other event-processor update() callers that use condition: 'attribute_exists(pk)' as a 'wait for row' guard — same anti-pattern may exist elsewhere. Filed as `update-or-retry-call-site-audit`."
spec: docs/superpowers/specs/2026-05-24-event-processor-update-or-retry-design.md
plan: docs/superpowers/plans/2026-05-24-event-processor-update-or-retry.md
topic_memory:
  - project_decision_workflow_stuck.md
validation_gate: |
  - unit: `pnpm nx affected -t test,lint --base=origin/main` → PASS (28 projects)
  - integration: `pnpm nx run advisory-bff:test-integration` → 11/11 PASS on dev incl. new out-of-order BLOCKED scenario (200s through SQS 180s visibility + redrive). Bundle SHA verified: dev-advisory-bff Lambda LastModified 2026-05-24T19:46:48 → 23:16 → 23:21 (3 deploys, each picked up).
  - manual Playwright: `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts` reached the badge BLOCKED transition on 2026-05-24 — confirms the PENDING→COMPLIANCE_REVIEW→BLOCKED chain now propagates end-to-end through EB → SQS → Lambda → DDB → AppSync → UI. Test still fails because spec expects AWAITING_CONFIRMATION (Bug C, out_of_scope).
  - commit range on worktree branch `worktree-advisory-bff-status-update-silent-dedup-fix`:
    * 9c854989 feat(event-processor): add onConditionFail discriminant
    * 99ab3cbc feat(event-processor): add updateOrRetry() factory
    * 9ee333df feat(event-processor): branch executeUpdate on policy
    * ffb35d09 fix(advisory-bff): use updateOrRetry for status transitions
    * e0681e61 test(advisory-bff): out-of-order BLOCKED integration scenario
    * ad1877a5 fix(event-processor): wrap retry-policy CCF as RetryablePreconditionError
    * 1795d75e test(advisory-bff): widen out-of-order BLOCKED test for actual SQS visibility
    * a52f98a3 fix(compliance-ctrl): write decisionId alongside decisionPacketId on ComplianceCheck
    * 18ad163d fix(advisory-bff): drop DECISION_PACKET_UPDATED status mapping (Bug E)
---

# new-investor-happy-path stalls at decision-confirm — three-layer fix shipped

## Final outcome

Badge transitions correctly end-to-end on the deployed dev pipeline: `PENDING` (set on DECISION_PACKET_CREATED) → `BLOCKED` / `APPROVED` / `AWAITING_CONFIRMATION` (terminal). Playwright trace on 2026-05-24 confirmed the chain works. Remaining test failure is Bug C — orthogonal to this workstream.

## Three bugs shipped

### Bug A — silent dedup of guarded updates (defensive)

`advisory-bff/decision-status-changed.ts` issued `update({condition: 'attribute_exists(pk)'})`. event-processor's executor treats `ConditionalCheckFailedException` on a condition-bearing update as `{success: true, deduplicated: true}` — correct for "skip-if-not-X" dedup, wrong for "wait-until-X" preconditions. Fixed via a new `updateOrRetry()` factory that sets `onConditionFail: 'retry'` on the intent; executor throws `RetryablePreconditionError` (a wrapper that isRetryable() correctly classifies as retryable, unlike the raw SDK exception which `$fault: 'client'` marks as terminal). SQS now redrives until the precondition holds.

Was this race actually manifesting in production? Inconclusive — Bug D was masking it. But the fix is defensive against a real possibility (CDC streams from two different services racing into one consumer).

### Bug D — compliance-ctrl emitted DECISION_BLOCKED without decisionId

`compliance-ctrl/event-listener.ts:43` reads `subject.decisionId` from RECOMMENDATION_PROPOSED but renames it to `decisionPacketId` when writing the ComplianceCheck row. CDC emits DECISION_APPROVED/BLOCKED with subject populated from the row, so the emitted subject lacked `decisionId`. advisory-bff's transform addresses pk via `Decision#${tenantId}#${decisionId}` → undefined → wrong pk → CCF on every (re)try → eventual DLQ after maxReceiveCount=10. The badge never transitioned out of PENDING.

Fix: write both `decisionPacketId` AND `decisionId` (same value) on every ComplianceCheck record. execution-ctrl / ledger-ctrl consumers keep reading `decisionPacketId`; advisory-bff reads `decisionId`.

### Bug E — DECISION_PACKET_UPDATED overwrote terminal state

sfn-callback in decision-workflow-ctrl writes a DecisionPacket update AFTER compliance returns DECISION_APPROVED/BLOCKED. CDC on that update emits DECISION_PACKET_UPDATED. Both events fan out to advisory-bff. The old EVENT_TO_STATUS mapping included `DECISION_PACKET_UPDATED → 'COMPLIANCE_REVIEW'` — a last-write-wins overwrite that clobbered the terminal BLOCKED/APPROVED with an intermediate state. Confirmed on dev tenant `e2e-1779655130235-d4ff048a`: 3 rows landed at COMPLIANCE_REVIEW with `updatedAt > createdAt` (terminal applied, then UPDATED overwrote).

Fix: drop the DECISION_PACKET_UPDATED mapping. PENDING → terminal direct. No COMPLIANCE_REVIEW intermediate in UI.

## Architectural reflection

Per `superpowers:systematic-debugging` Phase 4.5, the layered failure pattern (silent dedup → field mismatch → state-machine ordering) is a signal that advisory-bff's status materialization treats each event as "last-write-wins on status" without modeling the state machine. A follow-up to formalize the status transitions (terminal vs intermediate, allowed transitions, ordering invariants) could prevent this whole class of bug. Not done in this workstream — the three concrete fixes were sufficient to meet the stated goal.

## References

- topic memory: `project_decision_workflow_stuck.md`
- spec: `docs/superpowers/specs/2026-05-24-event-processor-update-or-retry-design.md`
- plan: `docs/superpowers/plans/2026-05-24-event-processor-update-or-retry.md`
- dropped predecessor: `decision-workflow-ctrl-sf-stuck-waitforcompliance`
- anti-pattern family: `feedback_no_silent_fallback_in_agent_results.md`
- e2e flake feedback: `feedback_flake_means_broken.md`
- worktree CWD discipline: `feedback_worktree_first_no_commits_on_main.md` (re-surfaced via subagent CWD drift, recovered via `git reset --hard origin/main`)
