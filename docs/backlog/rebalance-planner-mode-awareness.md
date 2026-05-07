---
id: rebalance-planner-mode-awareness
status: parking
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "rebalance-planner stays mode-blind; promote on mode-correlated gap."
---

# rebalance-planner mode-awareness

Filed 2026-05-06 during α-tune brainstorm. The α-tune workstream changes `portfolio-construction` to be mode-aware via per-mode prompt + cached orchestrator; `rebalance-planner` (the parallel agent in the same orchestrator) stays mode-blind because turnover minimization is structurally orthogonal to allocation philosophy. No current failure observed. Promote if a mode-correlated rebalance behavior gap surfaces (e.g. AGGRESSIVE producing low-turnover plans that under-deliver on the equity-weight target).
