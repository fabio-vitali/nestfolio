---
id: runtime-epic-pre-done-scope-hardcoded-star
type: bug
status: queued
rank: 5
done_when: "resolve: `runOrchestrator` (runtime/engine/loop/orchestrator.mjs) hardcodes `changedScope: ['**/*']` for the epic-pre-done `preShipBatch`, so `selectChecks` picks EVERY expensive audit/gate check regardless of what the branch actually changed (34 vs 23 checks for a runtime-tooling-only epic). Consequences: (a) it runs headless-Opus audits of `services/**`,`libs/**`,`apps/**` surfaces the epic never touched — cost, plus the risk of blocking a ship on pre-existing drift unrelated to the branch; (b) it is inconsistent with the sibling `runWorker` (runtime/engine/loop/worker.mjs) which scopes item-pre-ship to `changedScope ?? toGlobs(item.scope)`. Fix: scope the epic-pre-done batch to the REAL branch delta (`git diff origin/main...HEAD --name-only`) so it validates the cumulative CHANGES, not the whole repo. NB: the epic's `scope:` is prose (not path globs), so `toGlobs(epic.scope)` is unusable here — derive the scope from the branch diff (git is already an orchestrator options param via `headSha`)."
topic_memory: [project_runtime_realization.md]
---

# runtime-epic-pre-done-scope-hardcoded-star

**Surfaced 2026-07-10** during the `backlog-item-frontmatter-integrity` epic ship (E6 epic-pre-done gate),
agent-observed.

`orchestrator.mjs:30` calls `preShipBatch({ ..., changedScope: ['**/*'], contexts: ['audit','gate'],
cost_ceiling: 'expensive', on: 'epic-pre-done' })`. Because `selectChecks` intersects each check's
`scope.paths` against `changedScope`, a literal `['**/*']` matches every check — the epic-pre-done batch
becomes a whole-repo gate rather than a gate on the branch's actual changes. Measured on this epic's
13-file branch diff (`runtime/**` + `.claude/skills/**` + `docs/backlog/**` only): `['**/*']` selects **34**
checks (incl. 4 headless-Opus audits + the unmapped-procedure hard-fail), whereas the real branch diff
selects **23** (deterministic checks + 1 arch-docs audit, no unmapped hard-fail).

The sibling `runWorker` already does the right thing (`changedScope ?? toGlobs(item.scope)`), so this is an
orchestrator-only inconsistency. Whether the epic gate is *intended* to be broader than a single item is a
design call — but `['**/*']` (the entire repo) is almost certainly too broad; the branch delta is the
natural "cumulative epic change" scope.

Shares a root cause with [[runtime-epic-gate-unmapped-audit-integration-test-procedure]] (both are
epic-pre-done gate defects surfaced together); `backlog-themes` may cluster them into a runtime-epic-gate
theme epic.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-10
- **Decision:** How to scope the epic-pre-done batch to the real branch delta (fix shape)
- **Options:** Add a `changedScope` param to runOrchestrator + compute the branch delta in the adapter (run-epic.mjs), mirroring runWorker/run-next.mjs; extract the shared branchDelta helper (git-delta.mjs) so both adapters use ONE implementation | Compute `git diff origin/main...HEAD` directly inside runOrchestrator (ring-1) | Copy run-next.mjs's inline diffOf one-liner into run-epic.mjs (duplicate)
- **Chosen:** Add a `changedScope` param to runOrchestrator + adapter computes the delta via a shared branchDelta helper
- **Rationale:** Mirrors the already-correct sibling (runWorker takes `changedScope`; run-next.mjs injects `diffOf('origin/main')`), keeping the engine project-agnostic re: the origin/main base (SPEC-1 constraint) — the reusable/cleanest option (primary objective, CLAUDE.md Hard Constraints). Extracting branchDelta removes the copy-paste. Fail-broad (`changedScope?.length ? … : ['**/*']`) so an empty/failed diff never under-scopes a ship gate. detect-fork-blast-radius(runOrchestrator) = exit 0 (no shared-surface ripple).
- **Rejected:** Computing the diff in ring-1 hardcodes the `origin/main` host convention into the project-agnostic engine; copy-pasting diffOf duplicates a git primitive across two adapters.
