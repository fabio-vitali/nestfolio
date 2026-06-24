---
id: backlog-eval-framework-usable
status: active
type: tooling
notes: "Finish backlog-eval-framework so it can actually guard backlog-skills-simplification: harden next-lane+e8-conflict (rubricGate + deterministic proxies; e8 no-pre-ship setup + portable SUPERPOWERS path), commit a baseline.json, run the oracle-teeth (Task 14). Core harness shipped in PR #24."
out_of_scope:
  - The remaining ~45-scenario full corpus + the /benchmark-backlog skill surface (Phase 6) — that is the sibling backlog-eval-framework-full-corpus item.
  - Re-validating the 4 already-green exemplars (add-fold-captured, bne-auto-design-pause, bne-resume-merged-tail-only, themes-discrimination) — proven in PR #24.
  - Actually running compare main feat/epic-backlog-skills-simplification — that is the backlog-skills-simplification epic's job; this item only makes the framework capable of it.
  - CI / scheduled-run wiring — separate workstream.
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

**Promoted to active 2026-06-24:** both triggers fired — PR #24 is merged (commit `4ed16dbd`), so the
harness code is on `main`, and this deferred work is now being picked up.
