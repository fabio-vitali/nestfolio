---
id: backlog-skills-hardening
status: shipped
closed: 2026-06-22
type: epic
notes: "Bulletproof the /backlog-next-epic orchestrator + /backlog-next worker workflows. Theme epic aggregating the confirmed weaknesses from the 2026-06-22 skills audit (docs/reviews/2026-06-22-backlog-skills-audit.md), surfaced by the first real --auto epic run (order-execution-money-path, merge #20). 6 core members."
done_when: "Every confirmed weakness from the 2026-06-22 backlog-skills audit is fixed in the skill prose/scripts (or consciously dropped) and an --auto epic runs end-to-end with: no improvised workaround on the orchestrator->worker drive, no opaque backlog-lint crash on malformed frontmatter, durable resumable run-state, and a user-owned merge (close stops at an open PR, never self-merges). All core members shipped or dropped."
scope: "Design + script defects in the /backlog-next-epic and /backlog-next workflows and their backlog-skill helpers (backlog-lint lib, epic-members.mjs, preflight/postflight): frontmatter-parse fragility + non-total lint render; --auto decision discipline + merge ownership; run-state write-contract + resume durability; E6/E7/E8 ship+merge mechanics; orchestrator-worker seam + context growth; plus low-severity perf/prose polish."
out_of_scope:
  - "detect-deploy-needed.mjs / detect-doc-derivation.mjs gating correctness (F-1, F-2/F-3) — homed in deploy-tooling-integrity (shared deploy tooling, not skill-workflow logic)"
  - "The backlog data-model redesign itself (backlog-redesign) — this epic hardens the skills that operate the model, not the model"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: "All 6 core members shipped on feat/epic-backlog-skills-hardening (tip 0c0ffd00): lint-library-total-and-located + auto-decision-discipline-and-merge-ownership (pre-shipped), orchestrator-worker-seam-prose (split out from the parked Tier-2 subagent-isolation item; F-26/27/28/4/10), backlog-skills-misc-polish (F-29/30/31/9/32), runstate-write-contract-and-recovery (F-11..F-14 + new runstate.mjs helper), ship-and-merge-mechanics (F-21..F-25). done_when met: orchestrator->worker drive now names the Skill-tool inline mechanism (no improvised workaround); backlog-lint render is total + sub-second (lint-library + F-29); run-state is durable/resumable via the closed-schema runstate.mjs helper; merge ownership stops at a user-merged open PR (auto-decision + ship-and-merge, never gh pr merge). Conscious carve-outs: Tier-2 subagent-dispatch refactor (backlog-next-epic-member-subagent-isolation, standalone parking) and e2e-spec typecheckability (e2e-apps-typecheck-target, parking) — both out of skill-workflow scope. E6 (no-deployable-code epic; only .claude/ + docs/ touched): app Jest-e2e/Playwright N/A; cumulative gate green on tip SHA — skill suite 104/104 (node --test), backlog-lint 342 files 11/11, detect-deploy no-op, affected-projects empty, all epic-member postflights green. Decision log (2 entries) in run-state → PR body."
---

# Backlog skills hardening (epic)

Theme epic that aggregates the confirmed findings from the 2026-06-22 audit of the backlog
orchestration skills. Full evidence + per-finding fixes: `docs/reviews/2026-06-22-backlog-skills-audit.md`
(33 confirmed findings, 11 refuted). The audit replayed the first real `--auto` epic run
(`order-execution-money-path`, merge #20) across its compacted sessions plus the build session.

The detect-deploy / detect-doc-derivation findings (F-1, F-2/F-3) are NOT here — they share the
root cause of the existing `deploy-tooling-integrity` theme epic and were filed there.

Members (derived from `epic:` pointers) — each is a homogeneous root-cause cluster:

1. `lint-library-total-and-located` — frontmatter-parse fragility: backlog-lint render crashes
   opaquely on non-string / duplicate-key frontmatter; 4 fragmented parsers. (F-15, F-16-read,
   F-18, F-19, F-20, backlog-add non-string write-side.) **Biggest single win.**
2. `auto-decision-discipline-and-merge-ownership` — `--auto` floor is prose-only/over-broad and
   the close self-merged on a bare "go". (F-33 HIGH, F-5, F-6, F-7, F-8.)
3. `runstate-write-contract-and-recovery` — the crash-recovery backbone is fragile (no write
   convention, schema drift, path ambiguity, stale-evidence on member re-open). (F-11..F-14.)
4. `ship-and-merge-mechanics` — E6/E7/E8 ship+merge brittle (manual merge, postflight cwd crash,
   cross-member type break, e2e false-green, conflict scope). (F-22, F-23, F-21, F-24, F-25.)
5. `orchestrator-worker-seam-prose` — seam-clarity prose residuals on the orchestrator<->worker
   drive (F-26, F-27, F-28, and F-4/F-10's Tier-1 prose residual). Split out 2026-06-22 from the
   parked Tier-2 `backlog-next-epic-member-subagent-isolation` (the subagent-dispatch refactor — a
   non-audit enhancement orthogonal to `done_when`, carved back out to standalone parking) so the
   cheap audit-required prose ships while Tier-2 stays deferred. (Atomicity split.)
6. `backlog-skills-misc-polish` — low-severity perf/prose singletons (F-29, F-30, F-31, F-9, F-32).
