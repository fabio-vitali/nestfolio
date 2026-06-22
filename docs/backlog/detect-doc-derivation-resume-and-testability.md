---
id: detect-doc-derivation-resume-and-testability
status: shipped
type: tooling
notes: "detect-doc-derivation.mjs diffs whole-branch-vs-origin/main so it reports derivation=true on every epic resume (no signal whether derivation is actually outstanding), and it has no import-meta-main guard / no exports so it runs main() at import and is untestable (unlike its detect-deploy-needed sibling)."
references: []
out_of_scope:
  - "Deep 'derived-doc freshness' detection (diffing source vs the committed derived artifact's content) — the member deliberately chose the simpler member-base delta; a content-freshness check is a separate future concern."
  - "Generalizing detect-deploy-needed (Step 6.3) to also pass member-start --base — it already accepts --base and was used manually for member-3 isolation; only Step 6.1 / detect-doc-derivation is in scope here."
  - "Actually executing the derivation skills (generate-c4-diagrams / audit-service / validate-flow) — the detector only identifies WHICH skills to run; that behavior is unchanged."
spec: null
plan: null
topic_memory: []
validation_gate: "Commit f96caf02. F-3 (testability): extracted `export function classifyDerivation(changedFiles, { baseExists })` behind an `import.meta.main` guard (mirrors detect-deploy-needed.mjs:classifyChanges); git access injected as a `baseExists` predicate so the classifier is pure/import-safe — verified `import()` no longer runs main()/git/exit. +11 unit tests (classify-derivation.test.mjs) covering infra→C4, events→flow-spec, event-listener→flow-spec, other-src→card, adapter→audit-domain, new-service sweep, test/+project.json skip, flows, MFE, empty, docs-only-no-derivation. F-2 (resume signal): the detector already accepted --base; wired it via a new /backlog-next epic-member Step 6.1 delta that passes the member-start HEAD (captured at Step 4 adoption). Dogfood: `detect-doc-derivation --base=503568d2` (this member's start) → derivation=false, reporting only the member delta instead of the cumulative branch-vs-origin/main union. Full suite `node --test .claude/skills/backlog-next/test/*.test.mjs` → 40/40 pass. No deploy/integration: contribution is 100% .claude/** Tier-0 (scoped 6.1/6.2/6.3 all empty/false)."
closed: 2026-06-22
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
