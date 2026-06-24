---
id: backlog-eval-framework-usable
status: parking
type: tooling
notes: "Finish backlog-eval-framework so it can actually guard backlog-skills-simplification: harden next-lane+e8-conflict (rubricGate + deterministic proxies; e8 no-pre-ship setup + portable SUPERPOWERS path), commit a baseline.json, run the oracle-teeth (Task 14). Core harness shipped in PR #24."
references:
  - docs/superpowers/specs/2026-06-24-backlog-eval-framework-design.md
  - docs/superpowers/plans/2026-06-24-backlog-eval-framework.md
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
---

# Make backlog-eval-framework usable to guard the simplification

The proven core harness shipped in **PR #24** (Phases 0–5: sandbox + per-op stubs + headless runner
+ 3-layer grader + suite/run + report; 36 unit tests; 4/6 exemplars validated live on opus). It is
**not yet usable in regression/compare mode** until these land:

1. **Harden `next-lane-complex` + `e8-conflict`.** Both gate-pass but the judge flagged them (1/5,
   2/5) — their thin deterministic gates don't verify the judgment they test. Apply the new opt-in
   `rubricGate` + add deterministic proxies. `e8-conflict` additionally needs a **no-pre-ship `setup`**
   (so `status: shipped` reflects the skill's conflict resolution, not the fixture) and a **portable
   `SUPERPOWERS` path** (currently a baked host path, `existsSync`-guarded; resolve from `~/.claude`
   with version discovery or an env override).
2. **Commit `scripts/benchmark-backlog/baseline.json`** — regression mode diffs against it; without a
   baseline the framework can't detect drift.
3. **Oracle-teeth (plan Task 14)** — prove the oracle detects a known *injected* regression (quality:
   a prose-only mutation flips a gate; value: a known token block moves the cost proxy) before any
   "no regression" verdict on the real simplification is trusted.

Then a clean baseline on current `main` → the framework can run `compare main feat/epic-backlog-skills-simplification`.

Gated on PR #24 merging (the harness code must be on `main`). Promote to queued/active when picking
up the deferred work.
