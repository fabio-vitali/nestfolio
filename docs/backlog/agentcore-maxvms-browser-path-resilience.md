---
id: agentcore-maxvms-browser-path-resilience
status: shipped
type: spec
rank: null
notes: "Make AgentCore maxVms saturation non-fatal for the browser/onboarding path. Two independent fixes: (1) shorten idleTimeout/maxLifetime to 2 min / 30 min on the 4 advisory/investor agent runtimes (IP/PE/MI/AN-ctrl) so finished sessions free their micro-VMs before the next decision cycle starts; (2) onboarding-chat.component.ts auto-retries a 402/429 SSE error with backoff [2s,4s,8s] and surfaces a 'reconnecting' state, plus an accurate quota-exhausted terminal message. NO concurrency caps. Root-caused from 2026-05-22 apps/nestfolio-e2e 2/4 failure (new-investor-happy-path + deposit-reload-mid-flight both dead-end on phase-1 SSE 402)."
references:
  - docs/superpowers/specs/2026-05-22-agentcore-maxvms-browser-path-resilience-design.md
  - libs/cdk-constructs/src/extensions/agent-runtime.ts
  - services/advisory/investor-profile-ctrl/src/service.stack.ts
  - services/advisory/portfolio-engine-ctrl/src/service.stack.ts
  - services/advisory/market-intelligence-ctrl/src/service.stack.ts
  - services/advisory/advisory-narrative-ctrl/src/service.stack.ts
  - apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts
out_of_scope:
  - Concurrency caps on agent-invoking ingress handlers (Option D from agentcore-invocation-resilience) — explicitly excluded by the user.
  - Production maxVms Service Quotas increase — tracked by agentcore-maxvms-prod-quota-increase.
  - Server-side proxy retry for the onboarding path — proxying an SSE stream through Lambda adds latency/cost and duplicates the design spec's already-rejected in-handler retry.
  - The onboarding runtime's own idle/lifetime values — already tightened to 5 min/1 h after the 2026-04-21 cost spike.
  - The backend SQS-driven resilience path — shipped and working (agentcore-invocation-resilience, agentcore-quota-retry-stale-lock).
  - onboarded() e2e fixture decoupling from synchronous AgentCore materialisation — shipped as e2e-fixture-agentcore-synchronous-coupling.
spec: docs/superpowers/specs/2026-05-22-agentcore-maxvms-browser-path-resilience-design.md
plan: docs/superpowers/plans/2026-05-24-agentcore-maxvms-browser-path-resilience.md
topic_memory: []
validation_gate: |
  Task 1 (4 advisory CDK stacks): tightened lifecycleConfiguration to {idleRuntimeSessionTimeout: 120, maxLifetime: 1800} on IP/PE/MI/AN agent runtimes. CDK stack tests + lint clean (commit 7727836c).
  Task 2 (onboarding-mfe browser auto-retry): onboarding-chat.component.ts now retries 402/429 SSE errors with backoff [2s, 4s, 8s] and surfaces reconnecting/quota-exhausted UI states. Component spec suite green including 6 new auto-retry tests (commit 4d7ab9d0).
  Deploy to dev sandbox: SUCCESS — all 4 stacks updated in ~70s. CFN performed an **in-place update** of AWS::BedrockAgentCore::Runtime (UPDATE_COMPLETE, no resource replacement) — the runtime ARN was preserved, so the SF orchestration's SSM-resolved ARN did not need to be re-published.
  Per-runtime confirmation via `aws bedrock-agentcore-control get-agent-runtime`:
    - investor_profile_agents (uVgFTqH5Wv): idleRuntimeSessionTimeout=120, maxLifetime=1800, status=READY
    - portfolio_engine_agents (DIbHQa6EdW): idleRuntimeSessionTimeout=120, maxLifetime=1800, status=READY
    - market_intelligence_agents (nm6TH0AV0s): idleRuntimeSessionTimeout=120, maxLifetime=1800, status=READY
    - advisory_narrative_agents (8ECL3C324H): idleRuntimeSessionTimeout=120, maxLifetime=1800, status=READY
  Onboarding runtime unchanged at 300/3600 (out of scope, verified).
  Playwright apps/nestfolio-e2e against deployed dev:
    - deposit-reload-mid-flight: **PASS in 1.9m** (previously dead-ended at phase-1 SSE 402).
    - new-investor-happy-path: **FAIL in 4.3m** — but NOT at phase-1 SSE 402. Spec progressed cleanly through all 6 onboarding phases + deposit (9 successful copilotkit calls, 0 × 402 in trace) and failed downstream at `advisory.page.confirm()` with the decision status badge stuck at PENDING. This is a **different bug** — the decision-workflow SF / compliance stall, same symptom family as the dropped `decision-workflow-ctrl-sf-stuck-waitforcompliance`. Filed as `new-investor-happy-path-pending-at-decision-confirm` (parking).
  Auto-retry path **not exercised** in this run — the idle-timeout headroom alone gave enough VM-pool capacity to avoid the 402 entirely (0 × 402 across 9 copilotkit calls in the happy-path trace, and the deposit-reload spec passed without retaining a trace). The auto-retry code path remains unit-proven by the 6 new component-spec tests (Task 2). Per spec §5, "a real maxVms 402 cannot be deterministically forced end-to-end" — same posture as `agentcore-quota-retry-stale-lock`.
  Worktree-init friction surfaced: `apps/nestfolio-host/public/assets/config.json` is gitignored and Playwright produced a misleading "renderer-render_options" timeout until `pnpm nx run nestfolio-host:config --prefix=dev` was run. Filed as `worktree-missing-host-runtime-config` (parking).
---

# AgentCore `maxVms` resilience for the browser/onboarding path

The shipped `agentcore-invocation-resilience` makes `maxVms` non-fatal only for
the backend SQS-driven agent path (event-processor classifies the 402 retryable
→ SQS native redrive). The onboarding path is a browser-direct streaming SSE
POST → CloudFront → AgentCore, with no queue behind it, so the 402 dead-ends
at the user with "Connessione interrotta".

This workstream closes that gap with two independent levers, neither of which
adds new infrastructure:

1. **Idle-timeout headroom** on the 4 advisory/investor agent runtimes — they
   currently inherit the 15 min/4 h construct defaults despite running headless
   burst sessions that are never re-invoked. Tightening to 2 min/30 min reclaims
   micro-VMs well before the 240 s SQS redrive window, so the account stops
   accumulating dead micro-VMs across an e2e run.
2. **Browser auto-retry** on the onboarding path — `@ag-ui/client` surfaces
   `error.status` on a non-OK SSE response, so a 402/429 can be retried in
   the browser with backoff `[2s, 4s, 8s]` and a `reconnecting` UI state, with
   accurate copy on terminal failure.

See the spec for the full evidence chain, code-level detail, validation gate,
and the runtime-replacement risk note.
