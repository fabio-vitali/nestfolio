---
id: backlog-redesign
status: shipped
type: refactor
references: []
out_of_scope:
  - "Migrating older shipped work (pre-MEMORY 'Recently Completed Work' cutoff)"
  - "Replacing the auto-memory system or project_*.md topic dossiers"
  - "Unifying project_*.md files into the backlog model"
  - "Adopting Backlog.md (MrLesk) or Linear MCP"
  - "Building a query CLI or web UI"
spec: docs/superpowers/specs/2026-05-07-backlog-redesign-design.md
plan: docs/superpowers/plans/2026-05-07-backlog-redesign-plan.md
topic_memory: []
validation_gate: "16-task plan executed; 7/7 lint rules pass against 55 backlog files; 27/27 unit tests pass; MEMORY.md 32KB → 16KB (well under 24.4KB cap); smoke test of backlog-add procedure (create + lint + delete + lint) GREEN; ~22 topic dossiers gained related_workstreams: frontmatter via dossier sync."
closed: "2026-05-07"
notes: "Per-item backlog files + auto-generated index + backlog-lint enforcement; MEMORY duplication removed."
---

# Backlog redesign — hybrid index + per-item files

See spec at `docs/superpowers/specs/2026-05-07-backlog-redesign-design.md` and plan at `docs/superpowers/plans/2026-05-07-backlog-redesign-plan.md` for full detail.

## Ship narrative — 2026-05-07

Executed via `superpowers:subagent-driven-development` over 16 tasks (commits `bc2ed662..4b52d561`). All 5 phases shipped:

**Phase 0 — backlog-lint skill + skill rewrites** (Tasks 1–11, 11 commits):
- New `.claude/skills/backlog-lint/` skill with `lint.mjs` CLI + `lib/{frontmatter,rules,index-render,dossier-sync}.mjs` + 27 unit tests covering 7 rules + the index renderer + dossier sync.
- Two minor plan deviations during TDD:
  - Slugify in `ruleReferencesValid` keeps `.` (rather than collapsing to `-`) so anchors like `#7.2-portfolio-construction` match real Markdown headings like `## 7.2 Portfolio Construction`. Adopted because the alternative (`72-portfolio-construction`) doesn't match how arch docs are typically referenced.
  - Rule 4/5 violation messages reordered to put the field name before the word "empty" (`— out_of_scope is empty`) so they match the test's regex contracts.
- `.claude/skills/backlog-add/SKILL.md` rewritten to create per-item files + auto-run `backlog-lint --fix` + commit only `docs/backlog/<id>.md` + `docs/BACKLOG.md`.
- `CLAUDE.md` § "Backlog Discipline" rewritten to point at the per-item file model + the 7 invariants + the BACKLOG ↔ MEMORY contract; new "Validate backlog state | backlog-lint" row added to the Skill Routing table.

**Phase 1 — migrate ACTIVE/QUEUED/PARKING** (Task 12, 1 commit `3f5ca4cb`):
- 35 files created in `docs/backlog/`: 1 active (this workstream) + 1 queued (`pr-pipeline-integration-tests`, rank 1) + 1 shipped natural-close (`remaining-agent-orchestrators` — closed by Spec 2 + α/β/γ ship per controller's reading of an uncommitted WIP note) + 32 parking entries.
- `docs/BACKLOG.md` regenerated as auto-generated thin index. Lint passes 7/7.

**Phase 2 — backfill shipped from MEMORY RCW** (Task 13, 1 commit `45f40d83`):
- 17 shipped backlog files added (plan said ~10; actual count was 17 including the "Older: …" aggregate as one record). Each `validation_gate:` populated from the most concrete result line in the MEMORY narrative.
- `## Recently Completed Work` section deleted from MEMORY.md (file outside repo, edit not committed).
- All shipped items typed as `refactor`/`bug`/`tooling`/`infra` to bypass rule 3 (which requires non-empty `references:` for `design`/`spec`).

**Phase 3 — reconcile MEMORY A/PW** (Task 14, 1 commit `fe74f4dd`):
- 3 new backlog files added: `operating-mode-feature` (shipped, covering Phase 1 + Phase 2), `sandbox-pipeline-trigger-gap` (shipped 2026-04-20), `integration-test-mock-resilience` (parking — partly superseded, partly stalled).
- Other 5 A/PW entries either already existed in `docs/backlog/` (BFF resolver region sweep, PR pipeline integration tests, C4 frontend representation, Unified Ingress refactoring) or are subsets of an already-shipped workstream (Onboarding runtime latent bugs ⊂ agent-contract-tests).
- `## Active / Planned Work` section deleted from MEMORY.md.

**Phase 4 — populate `related_workstreams:` in dossiers** (Task 15, 1 fix-commit `4b52d561`):
- First `node lint.mjs --fix` against the real memory dir crashed on a pre-existing topic dossier (`project_event_processor.md` description starts with unquoted `@nestfolio/event-processor`; YAML treats `@` as reserved). A second dossier (`project_playwright_e2e_ui.md`) had a similar issue.
- **In-flight code fix:** hardened `dossier-sync.mjs` to wrap `parseFrontmatter` in try/catch and skip dossiers with malformed YAML frontmatter, with a warning.
- Re-run completed cleanly — ~20 dossiers gained `related_workstreams:` frontmatter; 2 skipped with warnings (those won't auto-update until the user fixes their frontmatter).

**Phase 5 — smoke + ship** (Task 16, this commit):
- 27/27 unit tests pass. `node lint.mjs` (no `--fix`) returns `✓ 55 backlog files; all 7 rules pass`.
- `backlog-add` smoke test: created `smoke-test-entry.md`, ran `--fix`, confirmed it appeared in BACKLOG.md PARKING LOT, deleted the file, ran `--fix`, confirmed it disappeared. ✓
- Status flipped to `shipped` with this `validation_gate:`. `out_of_scope:` retained for historical reference.

## Out-of-scope items filed during execution

None — every gap surfaced was either resolved in-flight (the dossier-sync hardening; the slugify/regex tweaks during TDD) or explicitly out of scope per the plan (e.g., the BACKLOG.md "Recently shipped" table entries that weren't also in MEMORY RCW; Phase 2 only backfilled from MEMORY).

## Boundary review (next workstream pickup)

After this ship, ACTIVE will be empty again. Per CLAUDE.md § "Backlog Discipline", the next ACTIVE candidate is QUEUED slot 1: `pr-pipeline-integration-tests` (`[infra]` — Specs/plans done; implementation pending 2026-04-10). PARKING LOT contains 32+ entries; promote any that have grown teeth at the next session boundary.
