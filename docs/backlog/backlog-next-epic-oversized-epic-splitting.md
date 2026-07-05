---
id: backlog-next-epic-oversized-epic-splitting
status: parking
type: tooling
notes: "backlog-next-epic can't run phased/soak-gated epics; evolve the family: split oversized epics (agile-style), declare/honor a draining mode."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# backlog-next-epic cannot manage oversized/phased epics as epics — add splitting + draining-mode support

**Evidence (2026-07-05, `runtime-operationalization` orchestrator run, wound down in PR#33):**
the user launched `/backlog-next-epic runtime-operationalization --auto`; the orchestrator promoted the
epic and started the one-branch/one-PR model, and the mode mismatch only surfaced at the first member
boundary — via human review, not mechanically. "Having an epic I can't manage as *epic* doesn't make
sense" (user, at the wind-down fork). Decision trail: `runtime-operationalization` Decision log D1.

**Root cause — the one-branch/one-PR model fits only one epic shape:**

- **Merged-main-dependent `done_when` clauses deadlock.** `runtime-operationalization` clause (5)
  requires the work-driver re-platform to soak over ≥5 *real* workstreams — which run on merged
  `main`. Under one-PR-at-full-drain, the soak can never start before the merge it blocks.
- **Multi-session-sized members** (parity oracle, ~23-surface check migration, operator surface)
  grow an enormous long-lived branch with compounding `docs/backlog` conflicts.
- **Rule-11 slot starvation** — the single active-epic slot is held for the weeks the branch lives.
- **The epic's own `scope:` declared per-member-PR draining** ("Each a standalone /backlog-next
  member PR, drained individually"), but nothing mechanical reads that at launch —
  `.claude/skills/backlog-next-epic/SKILL.md` E1 promotes unconditionally.

**Directions to explore (brainstorm before picking):**

- **(a) Declared draining mode.** Epic frontmatter (e.g. `draining: one-pr | per-member-pr`) that
  `/backlog-next-epic` honors at E1 — refuse/redirect (or run a per-member-PR loop) instead of
  silently starting the one-PR model. Cheapest; makes the existing prose scope machine-readable.
- **(b) Epic-splitting ritual (agile decomposition).** When an epic is oversized (heuristics: member
  count/size, merged-main-dependent `done_when` clauses, phase structure), a sanctioned ritual mints
  per-phase child delivery epics sized for the orchestrator, parent becomes a theme/tracking epic.
  Needs a story for rule 10's 1-level tree (parent/child epics are currently unrepresentable).
- **(c) Per-member-PR orchestrator mode.** Keep the epic-loop UX (auto-pick next member, E4.5
  checkpoints, resume gate, decision log) but open/stop-at a PR per member; batched e2e becomes
  per-phase. Preserves fire-and-forget for exactly the "multi-session same-topic" use-case the user
  wants epics for.

Related surfaces to touch when picked up: `backlog-next-epic` (E1 promotion, E4 loop, E8 close),
`backlog-next` (epic-member deltas), `backlog-lint` (rule 10 single-level tree, rule 11),
`epic-members.mjs`, `resume-gate.mjs`/`runstate.mjs` (per-member-PR run-state shape), and the
bef scenarios that grade the orchestrator.
