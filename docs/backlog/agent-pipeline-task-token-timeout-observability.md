---
id: agent-pipeline-task-token-timeout-observability
status: shipped
type: spec
notes: "Code: PR #13 (03d05b6f) on main, deployed to dev 2026-05-15 21:29 UTC. Validation 2026-05-16: e2e scenario 12 re-run failed at 240s timeout as expected; CloudWatch Logs Insights returned 1 TaskTimedOut ERROR at 22:05 UTC on dev-investor-profile-ctrl IngressHandler with processingLagMs=1,800,450 (~30min, 3× SF TimeoutSeconds=600s) — confirms backlog-trap hypothesis. Scenario 11 unexpectedly passed (122s, backlog partially drained on that path). Architectural fix tracked separately as agent-pipeline-backlog-trap-architectural."
references:
  - libs/event-processor/src/pipelines/resume-state-machine.ts
  - libs/event-processor/test/pipelines/resume-state-machine.test.ts
  - docs/superpowers/specs/2026-05-15-agent-pipeline-task-token-timeout-observability-design.md
out_of_scope:
  - "Queue purge / one-shot remediation"
  - "VisibilityTimeout, concurrency, SF TimeoutSeconds tuning"
  - "Moving agent invocation off SQS→Lambda→AgentCore hop"
  - "Phase A/B Memory-write latency reduction"
  - "Changing skip() to retry (behaviour change requires new-log evidence first)"
spec: docs/superpowers/specs/2026-05-15-agent-pipeline-task-token-timeout-observability-design.md
plan: null
topic_memory:
  - project_e2e_feature_tests.md
  - project_inter_agent_state_handoff.md
validation_gate: "Deploy: 4 agent-ctrl IngressHandler Lambdas + decision-workflow-ctrl on dev (commit 03d05b6f). e2e re-run 2026-05-16: scenario 12 (rebalance-on-drift) failed at 240s timeout — getDecisionHistory still PENDING. CloudWatch Logs Insights query from spec produced 1 ERROR with sfnErrorName=TaskTimedOut + processingLagMs=1,800,450 (>> 600,000 SF window), confirming backlog-trap. Spec's pass criterion (≥1 ERROR per failed test, lag >> 600,000) met. ERROR-log distribution now visible to inform agent-pipeline-backlog-trap-architectural."
---

# Agent-pipeline TaskTimedOut observability

## Context

The 2026-05-15 e2e run produced two failures:

- `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` (scenario 11) — `waitForGraphQL` 180s timeout on `getDecisionHistory`
- `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` (scenario 12) — 240s timeout, same shape

Trace through SF `dev-decision-workflow-ctrl-decisionstatemachine`: every execution times out at 600s inside `ParallelProfiling` (`InvokeInvestorProfile` + `InvokeMarketIntelligence` both `TaskTimedOut`).

Lambda logs (last 30 min): 40/40 `"SF task already resolved, treating duplicate as success"` lines on investor-profile-ctrl Ingress with `sfnErrorName: TaskTimedOut`; same on market-intelligence-ctrl.

Queue depth at investigation time:

- `dev-investor-profile-ctrl-IngressQueue`: 0 visible, **414 inflight**
- `dev-market-intelligence-ctrl-IngressQueue`: **386 visible**, 5 inflight
- VisibilityTimeout 1800s, Lambda maxConc 5, batchSize 1

The system is in a backlog-trap pathology where messages process after their SF task token has timed out, and the swallow path at `libs/event-processor/src/pipelines/resume-state-machine.ts:47–61` masks 100% of failures as `INFO`-level duplicate logs.

## This workstream

Single-file change to make the failure mode observable. No behaviour change — only log level and added context. See linked spec for full design + validation gate.

## Ship validation (2026-05-16)

Code shipped via PR #13 (commit `03d05b6f`) — single-file change in `libs/event-processor/src/pipelines/resume-state-machine.ts`:

- `TaskDoesNotExist` → `logger.info('SF task already resolved (genuine duplicate)', ...)` (unchanged behaviour, INFO log)
- `TaskTimedOut` / `InvalidToken` → `logger.error('SF task token unresolvable — agent-pipeline backlog or token regression', { sfnErrorName, processingLagMs, eventCreatedAt, ... })` — control flow unchanged (still `skip()`)
- All other SFN errors re-thrown

Three tests added/renamed in `libs/event-processor/test/pipelines/resume-state-machine.test.ts` covering the three branches.

### Validation gate execution

1. **Deploy.** Lambda timestamp shows 4 agent-ctrl IngressHandler functions were deployed 2026-05-15 21:29 UTC, ~18 min before PR #13 merge — the user had deployed from the feature branch first. Re-running `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl` produced `(no changes)` on all five — same code already live.
2. **e2e re-run.** Scenarios 11+12 only against deployed dev (`NESTFOLIO_INTEG_PREFIX=dev`):
   - Scenario 11 (`first-decision`): **passed** in 122s. Backlog has partially drained since the spec's investigation window; the architectural pathology no longer reproduces on this code path consistently.
   - Scenario 12 (`rebalance-on-drift`): **failed at 240s** as expected. `getDecisionHistory` still showed only the MANDATE_SNAPSHOT_CREATED row in PENDING — the drift-triggered second decision never landed.
3. **CloudWatch query.** Spec's pass-criterion query (filter `level = "ERROR" and message like /agent-pipeline backlog/`) returned 2 `TaskTimedOut` ERRORs in the past hour:
   - **2026-05-15 22:05:12 UTC** — `dev-investor-profile-ctrl-IngressHandler`, `eventType=ANALYZE_INVESTOR_PROFILE`, **`processingLagMs=1,800,450`** (≈30 min). This is the scenario 12 ERROR. `1,800,450 >> 600,000` (SF `TimeoutSeconds`), confirming the backlog-trap hypothesis: the message arrived at the Lambda 30 min after the original SF task token had already timed out.
   - 2026-05-15 21:35:36 UTC — `dev-market-intelligence-ctr-IngressHandler`, `eventType=ANALYZE_MARKET`, `processingLagMs=24,355`. Predates the e2e re-run; different pattern (lag < SF window) — not backlog-trap, possibly a partition-eval race or short-window race. Worth tracking as a follow-up signal but does not invalidate the gate.

The spec's stated pass criterion ("≥ 1 ERROR per failed test, with `processingLagMs >> 600000` for the `TaskTimedOut` lines, confirming the backlog-trap hypothesis") is **met** by the 22:05 line alone.

### Follow-ups unlocked

The architectural workstream `agent-pipeline-backlog-trap-architectural` can now redesign the SF→EB→SQS→Lambda→AgentCore hop with empirical ERROR-log evidence; the observability split converts what was 100% silent failure into countable, time-stamped signal.
