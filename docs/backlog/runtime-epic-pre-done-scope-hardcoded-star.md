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
