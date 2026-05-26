---
id: playwright-rebalance-real-agents-maxvms-remediation
status: active
rank: 6
type: infra
notes: "Playwright rebalance-trades-on-drift.spec.ts must run real agents per [[feedback-e2e-no-external-mocks]] (no stub allowed) but is structurally blocked by AgentCore maxVms saturation timing out PE at 120s. Already-shipped resilience (retryable + SQS redrive + idleTimeout tuning) does not help because SF TimeoutSeconds=120s ages out before retry can resolve. Dev-cost constraint (2026-05-26): a maxVms quota increase is acceptable ONLY if it net-lowers spend by eliminating retry storms / TaskTimedOut waste; pure quota bump that raises bills is rejected."
references:
  - path: apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts
  - path: apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts
  - path: services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - path: services/advisory/decision-workflow-ctrl/src/agent-budgets.ts
  - path: docs/backlog/agentcore-maxvms-prod-quota-increase.md
  - path: docs/backlog/agentcore-invocation-resilience.md
  - path: docs/backlog/agentcore-maxvms-browser-path-resilience.md
  - path: docs/backlog/dwc-integration-agent-mock-for-sf-packet-shape.md
out_of_scope:
  - "Production-account maxVms quota increase — tracked separately in agentcore-maxvms-prod-quota-increase. This workstream is sandbox-only."
  - "Integration-side agent stub for SF packet-shape coverage — already shipped (as deletion) in dwc-integration-agent-mock-for-sf-packet-shape. The integration layer is closed."
  - "Onboarding browser-path 402/429 SSE retry — already shipped in agentcore-maxvms-browser-path-resilience. This workstream targets the rebalance Playwright scenario only."
  - "Any other Playwright scenario (new-investor-happy-path, deposit-reload-mid-flight, etc.). The rebalance scenario is the sole gate; cross-scenario hardening is filed separately if it surfaces."
  - "Broad Lambda concurrency overhaul — only the agent-ingress concurrency knobs (Candidate A scope: PE-ctrl / AN-ctrl ESM or reservedConcurrency in sandbox config) are in play. Other services' concurrency is untouched."
  - "Rewriting the rebalance UI itself. Candidate D may replace synthetic injections with a deeper user journey but does not redesign /advisory page rendering."
  - "Building a maxVms admission-controller / job-queue inside the app. If concurrency capping is needed, it lives at AWS-native knobs (ESM maxConcurrency, Lambda reservedConcurrency) — no application-level queue."
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Playwright rebalance-trades-on-drift — real-agents path under maxVms saturation

## Why this is queued (not parking)

Per [[feedback-e2e-gaps-queued-not-parking]]: this directly blocks an existing e2e scenario from running deterministically. Litmus: does it affect whether the e2e suite passes today? Yes — `rebalance-trades-on-drift.spec.ts` cannot be relied on as a gate while PE/AN intermittently TaskTimedOut at 120s.

## Origin

Spun off 2026-05-26 from `dwc-integration-agent-mock-for-sf-packet-shape` during brainstorming. The original dossier proposed one agent-stub design for 3 blocked artifacts. User policy forbids that mechanism for the Playwright scenario: [[feedback-e2e-no-external-mocks]] says e2e runs "real APIs, real LLMs, real keys, real rate limits." Integration kept the stub (allowed by [[feedback-mock-all-external-apis]]); this Playwright item is the e2e-side problem the stub can't address.

## What the user wants

> "With PW tests I want to trigger actions from UI and to assert also with UI!! Investigate if it's possible. I don't want to mock anything, specially the agents! If the problem is the maxVms, let's find together a solution for it."

So the canonical shape is **UI-driven**: real user actions in the browser (e.g., complete onboarding → deposit → watch real agent chain produce trades), real assertions on the rendered UI. The current scenario's `injectPortfolioUpdated` + `PORTFOLIO_DRIFT_DETECTED` PutEvents are placeholders that bypass the natural drift-detection chain — the e2e ideal replaces them with a real flow.

## Why it can't run today

1. **AgentCore maxVms saturation.** Dev sandbox holds a deliberately-low maxVms quota (cost). A single rebalance test triggers ≥2 concurrent SF executions (MANDATE_SNAPSHOT_CREATED orphan + the actual rebalance trigger), each invoking PE + AN agents = up to 4 concurrent micro-VMs. Other in-flight tests pile on. Saturation causes Bedrock to queue or reject.
2. **SF TimeoutSeconds is the binding constraint.** Each agent invocation has `TimeoutSeconds = AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC` / `ADVISORY_NARRATIVE_UX_SEC` (120s) on `waitForTaskToken`. Once that timer fires the SF state errors with TaskTimedOut. The shipped `agentcore-invocation-resilience` retry-with-SQS-redrive works at the Lambda layer but cannot recover an SF state whose timer has already expired.
3. **Prior fixes already applied.** `agentcore-maxvms-browser-path-resilience` (2026-05-24) tightened idleTimeout=2min and maxLifetime=30min on IP/PE/MI/AN runtimes so finished sessions free micro-VMs faster. Reduced (didn't eliminate) saturation.

## User cost constraint (2026-05-26)

The dev account is currently incurring high costs. A maxVms quota increase via AWS Service Quotas is acceptable **only** if it net-lowers dev spend — i.e., if today we are paying for:

- Lambda compute consumed by SF states that subsequently TaskTimedOut at 120s (wasted invocations).
- SQS redrive storms hammering retryable ServiceQuotaExceededException paths.
- Re-runs of test suites that flake on PE timeout.

If those wastes exceed the marginal cost of a higher quota ceiling, the increase pays for itself. Otherwise, the fix has to be on the structural side (concurrency caps, UI-driven flow that reduces fan-out, sandbox-only SF budget widening).

## Solution candidates (informal — full brainstorm at adoption)

- **A — Cap concurrency at the agent ingress.** Set `reservedConcurrency` or ESM `maxConcurrency=1` on PE-ctrl and AN-ctrl ingresses in sandbox config. Forces serial agent invocations across the whole account. Each test still runs real agents, but no two SFs hit Bedrock simultaneously. Cost-positive: no wasted retries, no TaskTimedOut, fewer test reruns. Trades wall-clock latency for determinism — acceptable in test environments.
- **B — Sandbox-only SF TimeoutSeconds widening.** Bump `AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC` and `ADVISORY_NARRATIVE_UX_SEC` to 300s in dev only. Gives Bedrock queueing room. Cost-neutral but masks slow agent flows; loses signal on real UX latency regressions.
- **C — Suppress orphan SF triggers during test setup.** The MANDATE_SNAPSHOT_CREATED→SF chain fires whenever a fresh tenant onboards, even though no deposit/drift has occurred yet. Adding a Choice in the SF that short-circuits MANDATE_SNAPSHOT_CREATED triggers without an active decision halves the concurrent SF count. Cost-positive (eliminates one wasted agent fan-out per onboarding) but production SF change with risk.
- **D — UI-driven test flow.** Replace `injectPortfolioUpdated` + `PORTFOLIO_DRIFT_DETECTED` PutEvents with a real user journey: onboarding wizard → deposit submission → wait for broker fill → wait for organic ledger update → wait for drift detection. Eliminates "synthetic event setup" surface and matches user's stated philosophy. Costs more wall-clock and depends on broker simulator. Cleanest e2e shape but biggest scope.
- **E — maxVms quota increase justified by cost reduction.** If investigation of CloudWatch + Cost Explorer shows the existing retry/timeout churn exceeds the marginal cost of a higher quota tier, request the increase. Combine with B for headroom.

Order recommended at brainstorming: **C → A → D**, with E held as the closer if a-c don't hit the cost-positive bar.

## Done definition

- `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts` runs to completion 2 consecutive times against deployed dev per [[feedback-flake-means-broken]] — real agents end-to-end, no stub.
- The mechanism chosen is documented as cost-positive (or neutral) for the dev account, with the analysis attached in the spec.
- Synthetic injections (`injectPortfolioUpdated`, inline `PORTFOLIO_DRIFT_DETECTED`) are removed or replaced with real user flow where practical.

## Related

- Parent: `dwc-integration-agent-mock-for-sf-packet-shape` (the integration-side fix that does NOT carry to Playwright).
- Cost-context: `agentcore-maxvms-prod-quota-increase` (LATER, prod-scoped).
- Already shipped: `agentcore-invocation-resilience`, `agentcore-maxvms-browser-path-resilience`.
- Feedback: [[feedback-e2e-no-external-mocks]], [[feedback-e2e-gaps-queued-not-parking]], [[feedback-flake-means-broken]].
