---
id: bedrock-cost-reduction-may-2026
status: active
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
plan: null
topic_memory:
  - project_agentcore_cost_safeguards.md
  - project_inter_agent_state_handoff.md
  - project_agent_runtime_structured_output.md
validation_gate: null
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
