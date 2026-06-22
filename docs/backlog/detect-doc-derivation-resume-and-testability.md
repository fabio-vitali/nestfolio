---
id: detect-doc-derivation-resume-and-testability
status: parking
type: tooling
notes: "detect-doc-derivation.mjs diffs whole-branch-vs-origin/main so it reports derivation=true on every epic resume (no signal whether derivation is actually outstanding), and it has no import-meta-main guard / no exports so it runs main() at import and is untestable (unlike its detect-deploy-needed sibling)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: deploy-tooling-integrity
epic_role: core
---

# detect-doc-derivation: always-true-on-resume + untestable

Audit findings F-2 / F-3. See `docs/reviews/2026-06-22-backlog-skills-audit.md`.
Distinct from the shipped `detect-doc-derivation-two-level-services-path` (which fixed path-parsing
only) — these are the resume-signal and testability defects, still unfixed.

1. **Always-true-on-resume (F-2).** The detector diffs the whole branch vs `origin/main` (the
   cumulative union), so on an epic resume it always reports `derivation=true` while any source differs
   — no signal about whether the derived docs are *already synced on the branch*. An `--auto` run
   trusting it literally re-runs `generate-c4-diagrams` / `audit-service` / `validate-flow` every
   resume (waste); ignoring it might skip genuinely-pending derivation. Fix: support a `--base=<sha>`
   (member-start HEAD) so it reports only the member's source delta, and add a `/backlog-next`
   Epic-member Step 6.1 delta to pass it.
2. **Untestable (F-3).** Unlike `detect-deploy-needed.mjs` (which has an `import.meta.main` guard +
   `export function classifyChanges`), `detect-doc-derivation.mjs` runs top-level at import with no
   guard and no exports → the path-classification logic (services→C4/audit, events→flow-spec,
   new-service, adapter→audit-domain) drifts untested as services are added/renamed. Fix: mirror
   `detect-deploy-needed.mjs` — extract `export function classifyDerivation(changedFiles, {baseExists})`
   behind an `import.meta.main` guard and add unit tests.

## Done when

The detector reports only outstanding (not cumulative) derivation on a resume given a member base;
its core is an importable pure function behind an `import.meta.main` guard with unit-test coverage.
