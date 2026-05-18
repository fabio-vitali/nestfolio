---
id: agent-pipeline-backlog-trap-impl
status: queued
type: refactor
rank: 1
notes: "Implementation of the agent-pipeline-backlog-trap-architectural design spec. Adds agentProfile() synth-time invariant helper, extends LambdaProfile with visibilityTimeout, wires Ingress fallback rung, replaces agentProps at PE+AN call sites, threads per-agent UX budget into DWC's two agent-invoke SF states. Unblocks e2e scenarios 11 (first-decision) + 12 (rebalance-on-drift). Complex-lane (worktree + PR)."
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
plan: null
topic_memory:
  - project_e2e_feature_tests.md
  - project_lambda_profile_system.md
validation_gate: null
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
