---
id: backlog-eval-framework-full-corpus
status: shipped
closed: 2026-06-25
type: tooling
notes: "Phase 6 of backlog-eval-framework: the /benchmark-backlog skill surface + the full ~50-scenario corpus (per-skill coverage enumerated in the spec). Builds on the proven core (PR #24) and the backlog-eval-framework-usable milestone."
references:
  - docs/superpowers/specs/2026-06-24-backlog-eval-framework-design.md
  - docs/superpowers/plans/2026-06-24-backlog-eval-framework.md
out_of_scope:
  - "Task 17 — the full 3-iteration ~50-scenario baseline RUN on main (~15-20M token budgeted spend). Deferred per user decision (cost floor, AskUserQuestion 2026-06-25); to be run later via the /benchmark-backlog rebaseline mode this member builds. Tracked as a separate queued follow-up."
  - "The backlog skills the harness GRADES (backlog-skills-simplification) — downstream consumer epic, not part of the harness build-out."
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: "Phase 6 shipped (deterministic gate; live runs deferred per cost-floor decision). Task 15: /benchmark-backlog skill (.claude/skills/benchmark-backlog/SKILL.md, regression|compare|rebaseline, token cost-gate, deterministic-suite hook). Task 16: corpus scaled 6→52 scenarios matching spec §Scenario corpus exactly (backlog-next-epic 35, backlog-add 9, backlog-next 6, backlog-themes 2) + 6 new fixtures (parking-epic, multi-epic-parking, no-epics, active-plus-parking-epic, epic-drainable, next-lanes). Harness hardened: worker-fork stub knob (blast-radius scenarios) + strengthened structural-lint (unknown-key/worker-knob guards + fs-aware fixture-existence). Deterministic gate GREEN: node --test scripts/benchmark-backlog/test/*.test.mjs = 54/54 (was 46); structural-lint + fixture-existence over all 52 scenarios pass; no dup ids; backlog-next tests 40/40. Also fixed: detect-deploy-needed classifies root scripts/** as Tier-0 no-deploy. Task 17 (full 3-iteration baseline RUN, ~tens of M tokens) DEFERRED to a user-triggered /benchmark-backlog rebaseline — filed as queued follow-up backlog-eval-framework-baseline-run. Branch feat/epic-backlog-eval-framework-remaining."
epic: backlog-eval-framework-remaining
epic_role: core
---

# backlog-eval-framework — full corpus + skill surface (Phase 6)

The core harness (PR #24) ships with 6 exemplar scenarios. Phase 6 scales it to the full coverage the
spec enumerates:

- **`/benchmark-backlog` skill** (`disable-model-invocation`, user-triggered): `regression | compare
  <refA> <refB> | rebaseline` modes, cost-conscious gating, and a hook that also runs the existing
  `node --test .claude/skills/backlog-*/test/*.test.mjs` deterministic suites so one invocation reports
  the whole system.
- **Full ~50-scenario corpus** (spec §"Scenario corpus"): `backlog-next-epic` ≈35 (resume gate,
  selection, rule-11/promote, `--auto` decisions, member-loop/F-21/debug-budget, ship/captured audit,
  E6 false-green, merge-ownership, merge-conflict + sub-gaps), `backlog-add` ≈9, `backlog-next` ≈6,
  `backlog-themes` ≈2. Each authored from the proven exemplar template, outcomes-only, passing
  `structural-lint`, with `rubricGate` on the judgment-heavy ones.
- **Full baseline** on `main` over the whole corpus.

Note the per-opus-run cost (`backlog-next-epic` ≈ $5–8 each) — a full 3-iteration corpus baseline is a
deliberate, budgeted spend. Builds on backlog-eval-framework-usable (the gate/baseline/teeth
hardening) being done first.
