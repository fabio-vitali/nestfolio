---
id: agent-pipeline-backlog-trap-impl
status: shipped
type: refactor
rank: null
notes: "Implementation of the agent-pipeline-backlog-trap-architectural design spec. Added agentProfile() synth-time invariant helper, extended LambdaProfile with visibilityTimeout, wired Ingress fallback rung, replaced agentProps at PE+AN call sites, threaded per-agent UX budget into DWC's two agent-invoke SF states. SHIPPED 2026-05-18: scenarios 11+12 3/3 green on deployed dev."
references:
  - docs/superpowers/specs/2026-05-18-agent-pipeline-backlog-trap-architectural-design.md
  - libs/cdk-constructs/src/utils/lambda-profiles.ts
  - libs/cdk-constructs/src/core/ingress.ts
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - services/advisory/portfolio-engine-ctrl/src/service.stack.ts
  - services/advisory/advisory-narrative-ctrl/src/service.stack.ts
out_of_scope:
  - Bedrock TPS quota tracking (concurrency × callRate ≤ modelRpm) — not the binding constraint per current evidence; file separately if observed.
  - Pre-warming / reserved Lambda concurrency — only justified under sustained load.
  - AN p90 tail reduction (compressing α/γ retry paths) — separate workstream that would lower AN's planned concurrency.
  - Automated p90 drift CI check — future improvement.
  - Backfill of agentProfile to non-agent services — no current matching SF→SQS→Lambda+deadline shape outside PE+AN.
  - Runtime CloudWatch alarms on visibility-vs-deadline — synth-time guard is sufficient.
  - Inter-agent state handoff redesign (Phase A/B is correct).
  - Long-term Memory write latency on PE/AN.
  - Re-introducing IP/MI to the per-cycle path (precomputation 2026-05-17 stays).
  - Test-harness changes (EventBusTrap, AgentTraceTrap, fixture polling budgets).
  - Compliance-ctrl or AssemblePacket state changes.
  - The publisher-side bug tracked in `update-operating-mode-cdc-silent`.
  - F1/F3 test-gating heuristics.
spec: docs/superpowers/specs/2026-05-18-agent-pipeline-backlog-trap-architectural-design.md
plan: docs/superpowers/plans/2026-05-18-agent-pipeline-backlog-trap-impl.md
topic_memory:
  - project_e2e_feature_tests.md
  - project_lambda_profile_system.md
validation_gate: |
  cdk-constructs unit tests green (lambda-profiles 48 tests + ingress 28 tests + agentProfile invariant) — commits 807ece42, dc5b6a0f, fadf35b3.
  decision-state-machine.test.ts green (TimeoutSeconds=120 assertions on InvokePortfolioEngine + InvokeAdvisoryNarrative) — commit 58522164.
  portfolio-engine-ctrl service.stack.test.ts green (VisibilityTimeout=196 / Timeout=49 / MaximumConcurrency=10) — commit 2d84bf51.
  advisory-narrative-ctrl service.stack.test.ts green (VisibilityTimeout=232 / Timeout=58 / MaximumConcurrency=12) — commit aee84363.
  eslint @nx/enforce-module-boundaries allow-list extended for @nestfolio/.+/agent-budgets — commit 4822d902.
  pnpm nx affected -t test,lint --base=origin/main: 47 projects green / 0 fail.
  Deployed to dev 2026-05-18 via deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl (61.35s / 137.26s / 137.35s) — log /tmp/agent-pipeline-trap-deploy.log.
  PE IngressQueue purged post-deploy to clear stale task-token-dead messages.
  e2e scenario 11 (first-decision): 3/3 consecutive PASS — durations 173s, 147s, 157s.
  e2e scenario 12 (rebalance-on-drift): 3/3 consecutive PASS — durations 267s, 221s, 189s.
  No TaskTimedOut / Lambda timeout events surfaced during the 6 e2e runs (e2e would have failed the AgentTraceTrap timeout otherwise).
---

# Agent-pipeline backlog trap — implementation

Executes the design spec at `docs/superpowers/specs/2026-05-18-agent-pipeline-backlog-trap-architectural-design.md`.

## Scope (mirrors spec §4)

1. Extend `LambdaProfile` interface with optional `visibilityTimeout: Duration`.
2. Add fallback rung to `Ingress` at `libs/cdk-constructs/src/core/ingress.ts:116` so `props.visibilityTimeout ?? profile?.visibilityTimeout ?? 6×lambdaTimeout`.
3. Add `agentProfile(inputs: AgentProfileInputs): LambdaProfile` helper to `libs/cdk-constructs/src/utils/lambda-profiles.ts` with the math from spec §5 and the invariant assert (visibility ≤ ux×2).
4. Delete `agentProps` constant (no shim, per `feedback_no_deprecation`).
5. Create the shared budget constants module owned by DWC (resolves spec §10 open question #1).
6. Update `decision-workflow-ctrl` SF: pass explicit `timeout` to both `createAgentInvocationState` calls (`InvokePortfolioEngine`, `InvokeAdvisoryNarrative`).
7. Update PE + AN service stacks to call `agentProfile({ ... })` with the values from spec §6.
8. Resolve spec §10 open question #2: AN p99 (53.7s) > planned Lambda timeout (50s). Choose raise-p90-to-35_000 vs accept-p99-tail-as-signal.

## Tests (mirrors spec §7)

- Unit: `libs/cdk-constructs/test/utils/lambda-profiles.test.ts` covers derivations, input guards, invariant violation, multiplier override.
- Snapshot: PE + AN `service.stack.test.ts` confirm CloudFormation outputs match spec §6 table.
- Integration: existing PE + AN integration suites stay green.
- E2e gate: 3 consecutive passes of scenarios 11 + 12 (per `feedback_flake_means_broken`).
- Deploy: `--services=portfolio-engine-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl` + any cdk-constructs consumer redeploys.

## Validation gate (what must be true to ship)

- All tests green.
- 3 consecutive passes of e2e scenarios 11 + 12 against deployed dev.
- No `TaskTimedOut` SF events on `CONSTRUCT_PORTFOLIO` / `GENERATE_NARRATIVE` states in CloudWatch.
- No Lambda timeouts on PE / AN IngressHandler.
- PE IngressQueue depth during e2e peaks ≤ planned burst (40).
