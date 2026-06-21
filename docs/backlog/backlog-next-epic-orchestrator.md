---
id: backlog-next-epic-orchestrator
status: shipped
type: tooling
notes: "Split /backlog-next into a pure member worker + a new /backlog-next-epic orchestrator that runs a whole epic as one branch/one PR, batches expensive e2e at epic pre-done, and offers an --auto mode (auto-resolve+log, hard floor)."
references: []
out_of_scope:
  - "No change to the epic MODEL (frontmatter, the 11 lint rules, core/captured semantics) — those stay exactly as 2026-06-16-backlog-epics-design.md froze them. This is orchestration only."
  - "No new lint invariant. backlog-lint is reused as-is; the orchestrator calls it, does not extend it."
  - "No parallel member execution — members run sequentially on the single epic branch (deterministic ordering, no shared-state hazard)."
  - "No nested/multi-level epics; no multiple concurrent delivery epics (rule 11 unchanged)."
  - "No CI integration / scheduled-cron autonomy. --auto runs in-session (resumable via run-state), not as an unattended background cron."
spec: docs/superpowers/specs/2026-06-21-backlog-next-epic-orchestrator-design.md
plan: null
topic_memory: []
validation_gate: "Shipped 2026-06-21 on feat/backlog-next-epic-orchestrator. (1) /backlog-next stripped of epic dispatch (Step 1a gone), redirects type:epic ids, gained an Epic-member mode section (commit 4bfd3b39). (2) preflight/postflight --lane=epic-member added behind a main() guard; epic-member preflight skips on-main/main-ahead/stale-worktree+snapshot/daemon, epic-member postflight runs checks 1-3 only (375e0d5d). (3) /backlog-next-epic orchestrator skill + tested epic-members.mjs resolver (222def28). (4) CLAUDE.md names the epic entry point (5d3274bb). Tests: node --test across backlog-next + backlog-next-epic = 22/22 pass (lane-classification 4, classify-changes 8, epic-members 9, +1 suite). backlog-lint: 329 files, all 11 rules pass. detect-deploy-needed=Tier0/no-deploy, detect-doc-derivation=none, affected-projects=[] (docs/.claude only, no service code). epic-members.mjs live-smoke on typecheck-diagnostics-masking returned the correct next core member."
requires_deploy: false
---

# /backlog-next-epic orchestrator

## Why

`/backlog-next` does two jobs in one 216-line skill: it **executes one workstream** and it
**dispatches epics** (Step 1a — promote the epic, pick the next core member, run it, offer to
ship the epic when the last core member lands). Epic dispatch advances **one member per
invocation**, so a human re-invokes `/backlog-next <epic-id>` once per member. Two gaps:

1. **No epic-level expensive-e2e gate.** SKILL.md forbids the full suite and Playwright
   per-workstream ("NEVER the full e2e suite. NEVER Playwright."), so the expensive real-LLM
   e2e runs *nowhere* in the flow. The epic boundary is the right granularity to justify it.
2. **No "run a whole epic as one unit" path.** Goal: launch an epic, walk away, review a single
   detailed PR covering all member workstreams.

## What

- **`/backlog-next` → pure worker.** Remove Step 1a + the two epic-detection entry checks.
  Redirect a `type: epic` id to `/backlog-next-epic`. Add an **epic-member execution mode**:
  works inside the already-active epic worktree, commits to the epic branch, and skips the
  expensive e2e / `finishing-a-development-branch` / worktree cleanup / push — all hoisted to
  the epic level. Lighter `--lane=epic-member` pre/postflight variants.
- **`/backlog-next-epic` (new orchestrator).** Epic-start (preflight, rule-11 guard, promote,
  one worktree+branch, resumable run-state) → member loop via the worker in epic-member mode →
  epic pre-done batched e2e (scoped Jest e2e **and** Playwright across the cumulative state) →
  captured audit → epic ship → **one PR**.
- **`--auto` mode.** Auto-resolve normal decisions by picking the project-recommended (= most
  reusable/generalizable) option and **logging each** {decision, chosen, rationale, rejected}
  to an epic decision log surfaced in the PR body. **Hard floor still pauses** for
  irreversible/outward-facing actions (real-money, staging/prod, force-push, destructive
  deletes) and any fork with no defensible recommended option.

## Done when

- `/backlog-next` carries no epic-dispatch logic (Step 1a gone), redirects `type: epic` ids, and
  has a documented epic-member execution mode + `--lane=epic-member` pre/postflight.
- `/backlog-next-epic` exists with epic-start, member loop, batched epic e2e, captured audit,
  single-PR close, and `--auto` (with the hard floor + decision log).
- Member-selection ordering is extracted to a tested pure helper (`epic-members.mjs`).
- `CLAUDE.md` Skill-Routing + Backlog-Discipline name `/backlog-next-epic` as the epic entry.
- `backlog-lint` green; gate-script lane unit tests + member-selection tests pass.

## Out of scope

See `out_of_scope:` frontmatter above (epic model, lint invariants, parallelism, nesting, CI/cron).

## Plan

Approved plan: `~/.claude/plans/let-s-investigate-about-a-whimsical-breeze.md` (this session).
Design: `docs/superpowers/specs/2026-06-21-backlog-next-epic-orchestrator-design.md`.
