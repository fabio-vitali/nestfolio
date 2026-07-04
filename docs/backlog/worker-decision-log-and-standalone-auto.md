---
id: worker-decision-log-and-standalone-auto
status: active
type: tooling
notes: "Add --auto to standalone /backlog-next (mirroring /backlog-next-epic's decision policy + hard floor) AND unify the decision-log machinery into the worker: new append-only decision-log.mjs in backlog-next writing to the workstream's docs/backlog/<id>.md body; runstate.mjs drops decisions[] (ephemeral, .git-local, deleted post-merge) so the trail becomes committed+durable; E8 renders the PR body by aggregating file sections."
references: []
out_of_scope:
  - "Tier-2 subagent isolation of epic members (parked: backlog-next-epic-member-subagent-isolation) — the Skill-tool inline seam is unchanged."
  - "Mechanical floor enforcement via deny-hooks (parked: epic-member-floor-deny-hook) — the floor stays advisory prose + harness gates."
  - "Auto-resolving superpowers:brainstorming design approvals — permanently out of --auto's reach by design (epic E5.1 precedent), not a gap this workstream may close."
  - "Resume-gate / e8 / e2e-freshness mechanics beyond deleting the decisions[] key from the closed run-state schema."
  - "Retro-fitting decision logs into already-shipped workstream files or past PR bodies."
  - "bne-* eval scenario expansion beyond what the runstate schema change forces — new coverage is the 4 next-auto-* scenarios only."
spec: null
plan: docs/superpowers/plans/2026-07-04-worker-decision-log-and-standalone-auto.md
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
---

# Worker-owned decision log + standalone /backlog-next --auto

User-requested 2026-07-04: `/backlog-next-epic` has `--auto` (auto-resolve decisions with a
decision log and a hard floor); `/backlog-next` standalone has nothing — an unattended single
workstream is impossible without the epic wrapper.

Investigation findings that shaped the design (AskUserQuestion-resolved 2026-07-04):

- **Decisions arise in the worker.** Epic E5 itself states most forks are raised inside
  downstream sub-skills driven by the worker; the hard floor was already duplicated into the
  worker (backlog-next-epic LESSONS F-8). The log machinery is the last epic-only piece.
- **The current trail is ephemeral.** `runstate.mjs` writes `decisions[]` to
  `<git-common-dir>/backlog-next-epic-<id>.json` — inside `.git/`, never committed, deleted by
  the post-merge tail. The only durable trace is the PR body.
- **No eval grader asserts on `decisions[]` contents** (only run-state presence/absence), so the
  schema migration is bounded.

## Scope

1. **`decision-log.mjs`** (new, in `.claude/skills/backlog-next/`): append-only helper writing
   validated entries `{decision, options, chosen, rationale, rejected}` into a
   `## Decision log` section of `docs/backlog/<id>.md`. Append-only by construction (F-6).
2. **`/backlog-next --auto` (standalone).** New § in backlog-next SKILL.md mirroring epic E5:
   design approvals ALWAYS pause; finishing menu → PR route + STOP at open PR (never
   self-merge/local-merge, F-33); in-workstream forks → `detect-fork-blast-radius.mjs` gate then
   pick `(Recommended)`; catch-all → pause; identical hard floor (restated, self-contained);
   ≤3 debug cycles; e2e cost gate and 6.4b curate always pause; mint consideration stays an
   AskUserQuestion. Without `<id>`, --auto AUTO-LAUNCHES the top-ranked QUEUED item (rank is a
   hand-set rule-6-unique user decision, unlike the epic's computed ordering) and logs the pick
   as the first decision entry; resume-of-active proceeds; a conflicting `<id>` vs a different
   active item pauses.
3. **Epic migration.** Worker (epic-member mode) logs member-scoped decisions to the member's
   file via the helper; the orchestrator logs its own decisions (selection confirm, e2e repeat
   count, curate, E6 recovery forks) to the epic's file; `runstate.mjs` drops `decisions[]`
   (schema `{epic, branch, worktree, auto, e2e}` + optional `e8`); E8 composes the PR body by
   aggregating the epic + member files' Decision-log sections. Run-state keeps resume marker,
   `auto`, e2e evidence/freshness, `e8`.
4. **Tests.** RED→GREEN: 4 new eval scenarios (`next-auto-design-pause`, `next-auto-fork-resolve`,
   `next-auto-floor-pause`, `next-auto-finishing-pr-stop`) run on pre-edit HEAD (baseline fail)
   then post-edit (green), ≈1 iteration each. Deterministic: `node --test` suites for
   `decision-log.mjs` + updated `runstate.mjs`/structural-lint fixtures; existing suites stay
   green.

## Out of scope

Mirrors frontmatter: Tier-2 member isolation; deny-hook floor enforcement; auto-approving
brainstorming designs; resume-gate/e8 mechanics beyond the `decisions[]` key removal;
retro-fitting old logs; bne-* scenario expansion beyond schema-forced edits.
