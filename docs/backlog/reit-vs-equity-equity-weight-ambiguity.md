---
id: reit-vs-equity-equity-weight-ambiguity
status: queued
rank: 7
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Test filters EQUITY only; agent prompt allows optional REIT-as-equity."
---

# REIT-vs-EQUITY equity-weight ambiguity

Filed 2026-05-06 during α-tune brainstorm. `services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts:36` rule reads "equityWeight MUST be the sum of targetWeight across allocations whose assetClass is EQUITY (or REIT if interpreted as equity-like)" — the "or REIT" clause is optional. The e2e test at `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts:131` filters strictly on `=== 'EQUITY'` (REIT excluded). If the agent emits a REIT-heavy allocation in BALANCED, the test would under-count equity weight and could push it below the 0.50 floor. Trivial fix when promoted: either tighten the prompt rule to "EQUITY only, classify REIT-like instruments as EQUITY" or extend the test filter to include REIT. Promote on first observed flake.
