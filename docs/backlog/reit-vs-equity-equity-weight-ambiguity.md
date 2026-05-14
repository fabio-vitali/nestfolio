---
id: reit-vs-equity-equity-weight-ambiguity
status: dropped
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "Resolved 2026-05-13 — verification: prompts.ts:200 rule is strict EQUITY-only; e2e filter at operating-mode-recommendation-shape.e2e.test.ts:138 is consistent."
notes: "Dropped — premise stale; per-mode prompt rewrite (aa334179) removed the optional-REIT clause."
---

# REIT-vs-EQUITY equity-weight ambiguity

Filed 2026-05-06 during α-tune brainstorm. Original premise: `prompts.ts` rule read "equityWeight MUST be the sum of targetWeight across allocations whose assetClass is EQUITY (or REIT if interpreted as equity-like)" — the "or REIT" clause was optional, and the e2e test filtered strictly on `=== 'EQUITY'`, so a REIT-heavy BALANCED allocation could under-count equity weight and push it below the 0.50 floor.

**Dropped 2026-05-13.** Commit `aa334179` (per-mode prompt builder) replaced the loose rule with a strict version: "equityWeight MUST be the sum of targetWeight across allocations whose assetClass is EQUITY. riskMetrics.largestPositionWeight MUST be the maximum targetWeight across allocations whose assetClass is EQUITY (NOT across all allocations — bond and cash positions are excluded from this metric)." Prompt and test filter (`assetClass === 'EQUITY'` at `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts:138`) are now consistent. The "first observed flake" promotion trigger never fired.

Latent residual: the agent could still emit REIT allocations (REIT remains a valid `assetClass` enum value at prompts.ts:198) and would need to pad EQUITY separately to reach the mode floor. If it disobeys, the test correctly fails — that's a real agent-discipline bug, not a test bug. Re-file under a different id if observed.
