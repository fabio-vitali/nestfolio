---
id: agentcore-memory-market-signal-to-managed-semantic
status: queued
rank: 6
type: refactor
notes: "Swap MarketSignalExtractor from CUSTOM Haiku to managed SEMANTIC; ~$5/mo savings"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_agentcore_cost_safeguards.md
  - project_inter_agent_state_handoff.md
validation_gate: null
---

# Switch MarketSignalExtractor to managed SEMANTIC strategy

## Evidence

`MarketSignalExtractor` in `services/advisory/decision-workflow-ctrl/src/service.stack.ts` (~lines 84-97) is configured as `usingSemantic` (AWS type: `SEMANTIC_OVERRIDE`, CUSTOM) with Haiku as extraction model and a short, generic prompt override.

CUSTOM strategies invoke Haiku per event for extraction. Managed (non-CUSTOM) `SEMANTIC` strategies use AgentCore's internal extraction pipeline — no per-event Haiku call billed to our account.

## Change

Replace the `usingSemantic` CUSTOM config with a managed `SEMANTIC` strategy (drop the `extractionConfiguration` override that points at Haiku). The prompt is generic enough that the managed default is likely fine.

## Expected impact

- Eliminates extraction Haiku calls for this strategy.
- Lowest dollar impact of the cost-reduction series (~$5/mo) but trivially safe and one of fewer LOC.
- Estimated savings: ~$5/mo.

## Risk

Very low. Managed SEMANTIC is the AWS default and broadly used. Worst case: if the managed extraction is meaningfully lower quality, we can revert to CUSTOM with a tightened prompt + lower invocation rate. No agent currently retrieves from this namespace, so quality regression is unobservable at the retrieval layer today.
