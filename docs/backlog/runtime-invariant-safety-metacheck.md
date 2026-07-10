---
id: runtime-invariant-safety-metacheck
status: parking
type: refactor
epic: runtime-self-hosting-debt
epic_role: core
topic_memory: [project_runtime_realization.md]
notes: "Backward-edge lesson from runtime-check-migration-completion (2026-07-06): mint an [invariant]-safety meta-check — a registry guard that runs every ACTIVE [invariant] CheckEntry's evaluator against the CLEAN working tree and fails if any returns a finding, because an invariant that isn't clean bricks EVERY commit (fail-closed gate). meta-check.mjs today checks registry integrity (schemas, unique ids, module existence) but NOT invariant-cleanliness. Captured (orthogonal to the epic done_when: the migration is complete + checks run on a cadence regardless; clause-2 'â‰¥1 mint' already satisfied)."
---

# Mint an [invariant]-safety meta-check (invariant checks must be clean on a clean tree)

A CheckEntry with `contexts` including `invariant` runs on **every** commit (via the runtime gate's
unconditional invariant selection) and **fails the commit** if it returns any finding. So any active
`[invariant]` check that is *not* clean on the current tree **bricks every commit** until fixed —
there is no diff-scoping to save you.

This workstream (`runtime-check-migration-completion`) hit that risk **twice**:

- **typed-subjects** — the tool full-scans and reports 2 pre-existing (parked) broker-ctrl
  subject-suffix violations, so it had to be demoted from `[invariant, gate]` to `[gate]` +
  `scope: services/**` (Decision D6). As an invariant it would have blocked every commit.
- **index-matches** — the `module:` core resolved `DIR`/`INDEX` relative, so `ruleIndexMatches`'s
  absolute-path-keyed git-date map mismatched and it returned a false-positive "BACKLOG.md out of
  date" on the clean backlog (fixed at 98abd909). As an `[invariant]` check that false positive
  would have bricked every commit.

Both were caught by hand (the Task-4 sweep + the final-review reproduction). The recurring,
mechanizable guard: a registry meta-check that, for **every active check whose `contexts` include
`invariant`**, runs its evaluator against the clean working tree and asserts **zero findings** —
failing the registry if any invariant is dirty. This turns "did we accidentally register a
commit-bricking invariant?" from a manual review step into a checked invariant of the registry
itself. Complements `meta-check.mjs` (which validates schema/ids/module-existence but never runs the
evaluators).

**Sketch:** a `cmd:node runtime/…/invariant-safety.mjs` check (or an extension of `meta-check.mjs`)
that loads all active CheckEntries, filters `contexts.includes('invariant')`, resolves each
evaluator via the existing `resolve-evaluator` seam, invokes it against the clean tree, and reports a
`gap`/`inconsistency` finding for any that return non-empty. Needs an `eval_scenario` (a fixture
invariant that is deliberately dirty ⇒ the meta-check flags it; all-clean ⇒ passes) + a test, i.e.
full mint guarantees — hence a standalone item, not an inline addition to the pure-migration PR.

**Provenance:** surfaced at the `runtime-check-migration-completion` ship via the backward-edge mint
consideration (6.4b); user chose *file-as-follow-up* over inline mint (net-new check authoring is
that workstream's declared `out_of_scope`). Relates to [[project_runtime_realization]].
