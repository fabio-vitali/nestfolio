---
id: e2e-cold-deploy-an-trace-flake
status: queued
rank: 4
type: bug
notes: "first-decision e2e flakes on the first run after a fresh deploy when all advisory-pipeline Lambdas are cold; AgentTraceTrap times out at 240s for advisoryNarrative trace (CloudWatch shows AN handler ran in 500ms, trace seems to land after the trap stopped collecting)"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_e2e_feature_tests.md
validation_gate: null
---

# first-decision e2e: AgentTraceTrap times out on cold-deploy first run

## Evidence

Surfaced during `bedrock-cost-reduction-may-2026` validation (2026-05-18). Sequence on `dev`:

1. Lever C IP-ctrl IAM fix landed (commit `e09b2393`); IP-ctrl redeployed; Lambdas cold.
2. `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` rerun #3: **FAILED** at 374s with `AgentTraceTrap.waitFor timed out after 240000ms. agent=advisoryNarrative correlationId=86ff3fdb-... expected>=1 got=0`.
3. CloudWatch (`/aws/lambda/dev-advisory-narrative-ctrl-IngressHandler...`): AN handler **did** run at 22:38:45 UTC with the failing correlationId `86ff3fdb-a7f1-4cdf-8cc3-10b0ad68f950`, durationMs=554, `intents produced count:2 tags:[record,record]`. So the handler completed successfully but the trap collected zero trace events.
4. Rerun #4 with all Lambdas warm: **PASSED** in 205s.

The framework error message itself names the suspect: *"Common cause: .arm() was called AFTER the trigger that invokes the agent. Move .arm() earlier in beforeEach (before applyFixtures or any agent-triggering mutation)."* — implying a race when the agent finishes its trace emission before the test's trap is armed.

On the cold path the IP→MI→PE→AN cascade is several minutes; the EB→trap polling window probably misses the trace emission either because (a) `.arm()` runs after the trace fires on a particularly fast AN cold-warm sequence, or (b) the trap's filter resolves the correlationId from a deep payload field that the AN-side detail envelope omits in some paths.

This issue is **independent of the Phase 1 cost-reduction changes** — the Lever C IAM fix removed an upstream blocker but did not change AN's behavior. Surfaced on cold-deploy because every Lambda was forced into a fresh INIT in the validation window.

## Cheapest next step

Read `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` around `arm()` and `waitFor()` to confirm: does `.arm()` capture pre-existing events, or only events emitted after arming? If it's the latter, the fix is to either (a) move `.arm()` before any agent-triggering mutation in `first-decision.e2e.test.ts:64`, or (b) add a `since:` lookback so a trace emitted between `.arm()` and the wait still counts.

Adjacent reference: `docs/backlog/advisory-narrative-ctrl-tightening-cold-start-flake.md` covers a different cold-start path but lives in the same area.

## Why queued (not parking)

Per `feedback-e2e-gaps-queued-not-parking`: any issue that affects whether `apps/e2e-feature-tests` is reliably green is queued. The cold-deploy run of `first-decision.e2e.test.ts` failed twice in the bedrock-cost-reduction validation window (once because of the IAM gap — fixed — and once because of the AgentTraceTrap race on freshly-cold Lambdas). The warm-Lambda rerun was green and proves the system is correct, but the e2e suite cannot be trusted post-deploy without a "warm-up" run — that's a real test-infrastructure gap. Ranked 4 because the bedrock-cost-reduction workstream shipped on the warm-Lambda evidence and active-blocking is limited to first-after-deploy validation.
