---
id: new-investor-happy-path-pending-at-decision-confirm
status: parking
type: bug
notes: "new-investor-happy-path.spec.ts fails at decision-confirm: badge stuck at PENDING (expected AWAITING_CONFIRMATION). Surfaced 2026-05-24 during agentcore-maxvms ship validation — phase-1 SSE 402 is GONE, failure has shifted downstream to decision-workflow SF / compliance."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_decision_workflow_stuck.md
validation_gate: null
---

# new-investor-happy-path stalls at decision-confirm (PENDING, Confirm never appears)

## Evidence

- `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:15:5` fails at `advisory.page.confirm()` after 4.3 min total runtime.
- Error: "Confirm button never appeared after 120s. Decision status badge = 'PENDING'. Expected AWAITING_CONFIRMATION (set by USER_CONFIRMATION_REQUESTED). If status='PENDING' the SF is stuck in agents/compliance."
- Trace: `apps/nestfolio-e2e/test-results/journeys-new-investor-happ-19a09-deposit-→-decision-→-logout-chromium/`
- Playwright `trace.zip` shows **9 successful copilotkit calls, 0 × 402** during onboarding — the phase-1 maxVms 402 that motivated the agentcore-maxvms workstream is GONE, and the spec proceeds through onboarding + deposit cleanly. The new failure is downstream at decision-workflow SF / compliance.
- `apps/nestfolio-e2e/src/journeys/deposit-reload-mid-flight.spec.ts` PASSES (1.9 min) on the same dev deploy.

## Hypothesis

Same symptom family as the now-`dropped` `decision-workflow-ctrl-sf-stuck-waitforcompliance`. Its 2026-05-09 superseder `non-investor-profile-trigger-operating-mode-lookup` was meant to eliminate it, but the symptom is back on the browser-driven Playwright path that this workstream exercises (vs the Jest e2e path that originally surfaced it).

Likely candidates:
1. The Step Functions execution never starts (no `decision-workflow-ctrl` SF history for this decisionId).
2. SF starts but a child stage (agents pipeline or compliance callback) silently times out — same `States.Runtime`-is-uncatchable family as the 2026-05-17 finding.
3. Compliance task-token never resolved — the `WaitForCompliance` callback path, recurring.

## Cheapest next step

Pull the most recent `dev-decision-workflow-ctrl` SF execution history for the tenant created by the failing Playwright run, plus advisory-ctrl + compliance-ctrl CloudWatch logs in the same 4-min window. Determine whether SF started, where it stalled, and whether any agent emitted an envelope.

## Related

- topic memory: `project_decision_workflow_stuck.md`
- dropped predecessor: `decision-workflow-ctrl-sf-stuck-waitforcompliance`
- e2e flake feedback: `feedback_flake_means_broken.md` — this is the inverse of the dropped premise; we now have a Playwright run where the SF demonstrably did NOT progress to AWAITING_CONFIRMATION within 2 minutes after the user-blocking step.
