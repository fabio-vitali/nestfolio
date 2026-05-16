---
id: opus-to-sonnet-portfolio-construction
status: parking
type: refactor
notes: "Companion to opus-to-sonnet-risk-assessment; promote after risk-assessment proves stable"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_agentcore_cost_safeguards.md
  - project_agent_runtime_structured_output.md
validation_gate: null
---

# Flip portfolio-construction from Opus to Sonnet (companion to risk-assessment)

## Evidence

`services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts:9` is the second of two steady-state Opus consumers in the system. Sees ~half of the 1,544 weekly Opus calls (1.5k in / 0.5k out avg per call).

Schema is `PortfolioConstructionSchema` — mode-aware (CONSERVATIVE/BALANCED/AGGRESSIVE) allocations + trade list. This is the highest-stakes structured output in the pipeline, gated by the Spec 4 γ retry guard.

## Why parking, not queued

This item has an unmet trigger: it should only be promoted after [[opus-to-sonnet-risk-assessment]] has shipped AND been measured for one stable advisory cycle in dev. Per the backlog rule 8 (no trigger language in queued items), it stays parked until that condition fires, at which point promote it (with rank) and document what the measurement showed.

Hold rationale: portfolio-construction is more sensitive to model capability than risk-assessment because the output drives downstream trade composition. If Sonnet handles risk-assessment cleanly for a week, the confidence to flip portfolio-construction goes up.

## Expected impact (when promoted)

Estimated savings: **~$50/mo** (Opus → Sonnet at ~5× ratio on the remaining heavy Opus path).

## Risk

Medium until risk-assessment downgrade is proven. After that, low — same retry-guard protections apply.
