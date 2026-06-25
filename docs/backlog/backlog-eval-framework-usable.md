---
id: backlog-eval-framework-usable
status: shipped
closed: 2026-06-25
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
validation_gate: "All 3 parts landed + live-validated on opus (CLI subscription). (1) Gates hardened: next-lane-complex (rubricGate:4 + branchCreated adoption proxy + dedicated no-active-item fixture) and e8-conflict (no-pre-ship setup → skill ships+resolves a real same-line conflict; portable resolveSuperpowersSkills helper; rubricGate:4) — commits 9eea34e5/a6a63a1d. (2) baseline.json committed (cd665759): regression x3 over all 6 exemplars, every gatePassRate:1 + anyGateFlip:false, token-denominated. (3) oracle-teeth (31df7893, scripts/benchmark-backlog/test/oracle-teeth.md): quality teeth flipped a gate 1.0→0.5 on an injected merge-ownership prose regression lint cannot catch; value teeth moved tokens.total +53,831 on a ~2k-token injection (quality unchanged). Unit suite 46/46. Four framework bugs de-flaked en route: e8 judge last-commit-diff noise, themes ambiguous-decoy fixture, judge-no-json crash, 300s epic timeout."
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

## Shipped 2026-06-25

All three parts landed. The framework is now **regression/compare-usable** with a committed,
token-denominated `baseline.json` and a recorded oracle-teeth proof.

- **Hardening.** `next-lane-complex`: the `active-epic` fixture's active member tripped the
  active-in-flight guard so the run paused *before* classifying (the 1/5) — moved to a dedicated
  no-active-item fixture; the `status:active` golden was unreliable (the model adopts inside the
  worktree it creates) so the proxy is now `state.branchCreated` (location-robust) + `rubricGate:4`.
  `e8-conflict`: the old setup pre-shipped the branch AND edited a non-overlapping region (body title)
  so git auto-merged with **no conflict at all** (the 2/5) — redesigned to a no-pre-ship setup where
  the skill ships and resolves a real same-line `active`→`shipped` conflict; the baked host
  `SUPERPOWERS` path is now `resolveSuperpowersSkills()` (env override → highest `~/.claude` version,
  unit-tested).
- **Baseline.** `regression --iterations=3` over all 6 exemplars, 6/6 `gatePassRate:1`,
  `anyGateFlip:false`. Metrics are token-first (`tokens.{input,output,cacheRead,cacheWrite,total}`);
  `costUsd` retained as an API-equivalent weighted-token normalization (these runs spend Max
  subscription **quota**, not dollars).
- **Oracle-teeth.** Self-consistency (6/6, no flips) + quality teeth (a prose-only merge-ownership
  break → gate 1.0→0.5, lint-invisible) + value teeth (~2k-token injection → `tokens.total` +53,831).
  A `compare main feat/epic-backlog-skills-simplification` verdict is therefore trustworthy.
- **Framework bugs fixed with tests** (suite 36→46): e8 judge last-commit-diff noise → full
  `origin/main...HEAD` delta; themes ambiguous-decoy fixture → clean root-cause cluster vs
  cost-symptom-only decoy; judge-no-json crash that aborted a whole sweep → lenient parse + retry +
  never-throw + per-scenario isolation; 300s epic timeout → 600s (+ per-scenario override).
- **Follow-ups filed (parking orphans):** `bef-prose-token-proxy-miscalibrated` (firstTurnProseTokens
  reads a hardcoded turn), `bef-unit-tests-leak-tmpdirs`, `detect-deploy-scripts-tier0`.
