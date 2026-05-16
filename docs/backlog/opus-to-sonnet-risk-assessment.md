---
id: opus-to-sonnet-risk-assessment
status: queued
rank: 4
type: refactor
notes: "Flip investor-profile-ctrl risk-assessment Opus → Sonnet; ~$50/mo savings"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_agentcore_cost_safeguards.md
  - project_agent_runtime_structured_output.md
validation_gate: null
---

# Flip risk-assessment from Opus to Sonnet

## Evidence

`services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts:6` hardcodes `modelId: 'us.anthropic.claude-opus-4-6-v1'`. This is one of only 2 steady-state Opus consumers in the system.

CloudWatch 7-day window (2026-05-09 → 2026-05-16):

| Model | Invocations | Input tokens | Output tokens | Est. $ |
|---|---:|---:|---:|---:|
| Opus 4.6 | 1,544 | 3.5M | 790K | **~$112** |
| Sonnet 4.6 | 2,268 | 5.8M | 2.4M | ~$54 |
| Haiku 4.5 | 13,311 | 25M | 3.8M | ~$25 |

Opus carries ~30% of total Bedrock spend with the highest per-call token cost (~2.3k in / 511 out avg). Opus is explicitly exempted from the `AGENT_MODEL_OVERRIDE` Haiku-floor downgrade in `libs/agent-orchestrator/src/agent-factory.ts:37` (`applyOverride`), so the cost-safeguards already shipped don't help here.

## Change

In `services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts:6`:

```diff
-  modelId: 'us.anthropic.claude-opus-4-6-v1',
+  modelId: 'us.anthropic.claude-sonnet-4-6',
```

Verify integration test still passes against the `RiskEvaluationSchema` structured output.

## Expected impact

Sonnet is ~5× cheaper per token than Opus. Risk-assessment is one of two Opus calls per advisory cycle (the other is `portfolio-construction`). Cutting just this one should reduce Opus line by roughly half.

Estimated savings: **~$50/mo** at current burn.

## Risk

Low. Spec 4 (`project_agent_runtime_structured_output.md`) shipped α prompt-discipline + β withFallback + γ assertOrchestratorOutput + retry. The named-tool retry guard in `agent-factory.ts:113-128` covers Sonnet structured-output reliability. `RiskEvaluationSchema` is moderate-complexity — well within Sonnet capability. "Regulatory specialist" framing is prompt-driven, not model-driven.

The companion [[opus-to-sonnet-portfolio-construction]] (parked) covers the other Opus site; that one waits until this lands and is measured for a week before promoting.
