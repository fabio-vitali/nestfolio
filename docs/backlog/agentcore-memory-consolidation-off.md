---
id: agentcore-memory-consolidation-off
status: queued
rank: 2
type: refactor
notes: "Disable Haiku consolidation on 3 of 4 Phase B MemoryStrategies; ~$30/mo savings"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_agentcore_cost_safeguards.md
  - project_inter_agent_state_handoff.md
validation_gate: null
---

# Disable consolidation on 3 of 4 Phase B MemoryStrategies

## Evidence

The 4 MemoryStrategies added in Phase B (commit `1e1e23d4`, 2026-05-14) at `services/advisory/decision-workflow-ctrl/src/service.stack.ts:43-141` use Haiku for both extraction AND consolidation. Consolidation re-reads a sliding window of prior records and rewrites them — cost scales super-linearly with accumulated history.

Cost evidence: Bedrock Haiku spend jumped from ~$0.1/day → $8 on May 14 → **$40 on May 15** (5× growth in one day matches consolidation re-reading more records). One full advisory cycle = ~7 Haiku invocations (4 extractions + 3 consolidations).

## Change

Remove the `consolidation:` block on:
- `InvestorPreferenceLearner` — `service.stack.ts:74-83`
- `PortfolioRationaleArchivist` — `service.stack.ts:108-117`
- `NarrativeRationaleArchivist` — `service.stack.ts:125-134`

Keep extraction. `MarketSignalExtractor` has no consolidation today — no change.

## Expected impact

- Cuts ~3 Haiku invocations per advisory cycle (the consolidation passes).
- Eliminates the super-linear growth term.
- Estimated savings ~$30/mo at current burn.
- Reassess after a week to decide whether to re-enable any.

## Risk

Low. Extraction still runs per event → long-term recall semantics unchanged for the current cycle. Loss is only the cross-record summary AgentCore would have maintained — not currently consumed by any agent (verified: no MemoryClient retrieval calls reference the consolidated summary records).
