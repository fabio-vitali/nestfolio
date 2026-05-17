---
id: bedrock-cost-reduction-may-2026
status: shipped
rank: 2
type: refactor
notes: "5-lever Bedrock cost-reduction package — Phase B MemoryStrategies + Opus downgrades; ~$100/mo savings"
references: []
out_of_scope:
  - "Lever D (portfolio-construction Opus→Sonnet) — Phase 2, gated on a stable week of Lever C in dev"
  - "AGENT_MODEL_OVERRIDE Haiku-floor exemption logic in libs/agent-orchestrator/src/agent-factory.ts — already shipped (project_agentcore_cost_safeguards.md), not touched here"
  - "AgentTracer token-extraction bug for ChatBedrockConverse (parking item agent-tracer-bedrock-converse-token-extraction) — observability gap, distinct from cost reduction"
  - "Cost Explorer dashboards / alerts / budgets — out-of-scope; validation reads CloudWatch Bedrock metrics directly"
  - "P2 cost safeguards deferred in project_agentcore_cost_safeguards.md — separate workstream"
spec: null
plan: docs/superpowers/plans/2026-05-17-bedrock-cost-reduction-phase-1.md
topic_memory:
  - project_agentcore_cost_safeguards.md
  - project_inter_agent_state_handoff.md
  - project_agent_runtime_structured_output.md
validation_gate: |
  Phase 1 levers A+B+C+E shipped on branch worktree-bedrock-cost-reduction-may-2026, deployed to dev 2026-05-18.

  Commits (worktree-bedrock-cost-reduction-may-2026):
    f007a0b7  chore(backlog): adopt → active
    0828b7ee  docs(plans): Phase 1 plan
    0e63fa7e  feat(agent-orchestrator): namespacePrefix
    ed5f3439  refactor(DWC): Lever A drop consolidation
    c2c6b3a6  refactor(DWC): Lever B merge rationale strategies
    944020ca  refactor(advisory): Lever B PE+AN MemoryClient
    3b1045f8  refactor(DWC): Lever E MarketSignals managed (renamed for CFN rebuild)
    86be7795  refactor(IP-ctrl): Lever C Opus→Sonnet risk-assessment
    fcb98f45  docs: regen service cards + SYSTEM-ARCHITECTURE + C4
    2e37d41e  fix(DWC): rename MarketSignalExtractor → MarketSignals (CFN type-change rebuild)
    e09b2393  fix(IP-ctrl): Bedrock IAM grant Sonnet (Lever C IAM hardening, surfaced by e2e #1-2)

  Deploys (dev sandbox, 2026-05-18 ~00:11-00:37 CEST = ~22:11-22:37 UTC):
    dev-decision-workflow-ctrl  Memory rebuild (3 strategies, RationaleArchivist shared namespace, MarketSignals managed) — Stack ARN 0ebbddc0-2f9d-11f1-876e-0eddb6105365
    dev-portfolio-engine-ctrl   no changes (deployed in orphan parallel run; same code already live)
    dev-advisory-narrative-ctrl no changes (same)
    dev-investor-profile-ctrl   Sonnet IAM hardening — Stack ARN 24ec3f00-302d-11f1-8a5a-12e72919f029

  Validation:
    nx affected -t test,lint           PASS  11 projects (full unit + lint sweep)
    nx affected -t test-integration    PASS  8 projects, 5 tests (advisory pipeline + onboarding-bff)
    first-decision e2e (rerun #4)      PASS  205s, non-empty proposedTrades materialised, full SF cycle through AgentCore
    CloudWatch IP-ctrl IngressHandler  16s cold-start invocation completed successfully with Sonnet (response 3777 bytes); confirms Lever C IAM grant works end-to-end

  Known limitations (filed):
    e2e-cold-deploy-an-trace-flake (queued rank 4) — first-decision e2e fails on the very first run after a fresh deploy when all advisory Lambdas are cold; AgentTraceTrap.waitFor times out for advisoryNarrative trace. Rerun on warm Lambdas is green. Test-infrastructure timing race; independent of Phase 1 cost reduction.

  CloudWatch Bedrock cost validation (Haiku ≥50% drop / Opus ~50% drop) deferred to weekly observation; Phase 1 ship gate is the green e2e + integration suite + clean deploys.
---

# Bedrock cost-reduction package (May 2026)

## Why

Solo-dev sandbox went from $0 (Feb–Apr, credits) to $225 in the first 16 days of May 2026. **Bedrock LLM = 65% of bill.** On May 14–15, daily spend jumped from ~$8/day → $76/day after Phase B (commit `1e1e23d4`) added 4 AgentCore MemoryStrategies driven by Haiku, and the underlying Opus calls in the advisory pipeline are the largest single line item.

CloudWatch 7-day window (2026-05-09 → 2026-05-16):

| Model | Invocations | Input tokens | Output tokens | Est. $ |
|---|---:|---:|---:|---:|
| Opus 4.6 | 1,544 | 3.5M | 790K | **~$112** |
| Sonnet 4.6 | 2,268 | 5.8M | 2.4M | ~$54 |
| Haiku 4.5 | 13,311 | 25M | 3.8M | ~$25 |

Without intervention, projected monthly burn ~$2,300. Target: **~$1,200/mo with Phase 1, ~$1,150/mo with Phase 2.**

## Phase 1 — actions to execute now

Execute in this order:

### Lever A — Disable Haiku consolidation on 3 of 4 MemoryStrategies (~$30/mo)

Phase B added 4 strategies in `services/advisory/decision-workflow-ctrl/src/service.stack.ts:43-141`, three of which use Haiku for both extraction AND consolidation. Consolidation re-reads a sliding window of prior records each pass — cost scales super-linearly, which is why May 15 was 5× May 14.

Remove the `consolidation:` block on:
- `InvestorPreferenceLearner` — `service.stack.ts:74-83`
- `PortfolioRationaleArchivist` — `service.stack.ts:108-117`
- `NarrativeRationaleArchivist` — `service.stack.ts:125-134`

Keep extraction. Risk: low — no MemoryClient retrieval calls reference the consolidated summary records today.

### Lever B — Merge duplicate rationale strategies (~$15/mo)

`PortfolioRationaleArchivist` and `NarrativeRationaleArchivist` have identical extraction prompts and schemas; they exist as two strategies only because AgentCore enforces one namespace per strategy.

Either merge under `/rationale/{actorId}/{producerService}` (keeping producer attribution as a record attribute), or drop one strategy if a single rationale source suffices for downstream recall. Update `MemoryClient.emitLongTermEvent` callers in `portfolio-engine-ctrl/src/agent-service.ts` and `advisory-narrative-ctrl/src/agent-service.ts` for the merge path.

Do together with Lever A so the consolidation removal applies cleanly to the merged namespace.

### Lever C — Flip `risk-assessment` Opus → Sonnet (~$50/mo)

`services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts:6` hardcodes `modelId: 'us.anthropic.claude-opus-4-6-v1'`. Flip to `'us.anthropic.claude-sonnet-4-6'`.

Opus is explicitly exempted from the `AGENT_MODEL_OVERRIDE` Haiku-floor downgrade in `libs/agent-orchestrator/src/agent-factory.ts:37` (`applyOverride`), so the existing cost-safeguards don't help here. Spec 4 (`project_agent_runtime_structured_output.md`) shipped α prompt-discipline + β withFallback + γ assertOrchestratorOutput + named-tool retry guard in `agent-factory.ts:113-128`, which covers Sonnet structured-output reliability. `RiskEvaluationSchema` is moderate-complexity and well within Sonnet capability.

### Lever E — Swap `MarketSignalExtractor` to managed SEMANTIC (~$5/mo)

In `service.stack.ts:84-97`, replace the `usingSemantic` CUSTOM config (which invokes Haiku per event) with a managed `SEMANTIC` strategy. The prompt is short and generic; managed default extraction is likely sufficient. Lowest dollar impact but trivially safe.

## Phase 2 — gated on Phase 1 measurement

### Lever D — Flip `portfolio-construction` Opus → Sonnet (additional ~$50/mo)

`services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts:9` is the second of two steady-state Opus consumers — ~half of weekly Opus calls. Schema is `PortfolioConstructionSchema` (mode-aware allocations + trade list) — highest-stakes structured output, gated by Spec 4 γ retry.

This lever is **deliberately deferred**. Portfolio-construction is more sensitive to model capability than risk-assessment because the output drives downstream trade composition. The decision to execute Lever D is contingent on Lever C running cleanly for one stable advisory cycle in dev — if Sonnet handles risk-assessment well, the confidence to flip portfolio-construction goes up. If Lever C shows quality regressions, hold Lever D and consider a different mitigation (e.g., Opus only for AGGRESSIVE mode).

## Expected impact

| Phase | Levers | Est. savings |
|---|---|---:|
| 1 (this workstream) | A + B + C + E | ~$100/mo |
| 2 (follow-up decision) | D | ~$50/mo |
| **Combined** | **A–E** | **~$150/mo** |

Drops projected monthly Bedrock burn from ~$2,300 toward ~$1,150 once both phases complete.

## Validation

After Phase 1:
- All advisory-pipeline integration tests pass.
- One full e2e advisory cycle completes in dev and emits non-empty `proposedTrades`.
- CloudWatch shows Haiku Invocations dropped by at least 50% per advisory cycle.
- CloudWatch shows Opus Invocations dropped by ~50% (one of two sites flipped).
- AWS Cost Explorer 7-day rolling Bedrock spend trends toward target.

Before promoting Lever D in Phase 2: review one stable week of `risk-assessment` Sonnet performance (no integration-test regressions, no e2e flakes attributable to risk-assessment output quality).
