---
id: from-classify-lane-runtime-code-misclassified-doc-layer
type: bug
status: shipped
closed: 2026-07-08
validation_gate: "classifyLane CODE_OR_INFRA extended with runtime/, tools/, .claude/skills/**/*.mjs (commit 93b3821a; CL10-CL13 TDD red→green, 13/13 lane tests, full runtime suite + typecheck green). Proven live: this drive itself computed lane=simple and its item-pre-ship batch fired — first selecting audit-system and fail-closing on the missing judge (the un-masked gap), then green after the floor-curate audit-system → audit-system-arch-docs (commit 44293b73, journal curate:audit-system:g1:supersede, scope docs/** → docs/architecture/**; weekly runAudit cadence unaffected — changedScope **/*). Judge gap filed via runtime intake: from-run-next-pre-ship-judge-binding-gap (commit 99a3e78d, epic core). ship-recheck clean (journaled gate-clean); mint consideration recorded --none. SEVENTH runtime-driven workstream, fallback-free (run-next 3→1→3→0)."
out_of_scope:
  - "scripts/** classification — same fall-through, deliberately not in this item's done_when (observed by epic-clean-fixture-twin-id-typo); file separately if wanted."
  - "Wiring the audit-procedures judge into run-next/run-epic — the pre-ship gap this fix un-masks is filed as its own core member (user decision 2026-07-08: curate audit-system scope at the floor + file the judge gap)."
  - "laneToTrigger semantics / audit-batch cost tuning beyond the floor-curated audit-system scope."
done_when: "resolve: classifyLane's CODE_OR_INFRA set only recognizes services/,
  libs/, apps/, infrastructure/ — a diff touching only runtime/**, tools/**, or
  .claude/skills/**/*.mjs falls through to 'doc-layer' (\"nothing recognizable
  to deploy\"), which nulls laneToTrigger and skips the pre-ship audit batch AND
  mislabels the lane vs backlog-next SKILL.md §3 taxonomy (a code change is
  Simple, not Doc-layer). Behaviorally harmless today (nothing deployable in
  those trees), but the lane name leaks into run-next output/postflight lane
  selection, and a future runtime-code change wanting the audit-context pre-ship
  batch silently skips it. Surfaced while driving
  import-boundary-dynamic-import-gap on the runtime engine (soak run): the drive
  printed lane=doc-layer for a runtime/engine/test code diff."
provenance:
  from_finding: classify-lane-runtime-code-misclassified-doc-layer
epic: runtime-operationalization
---

# from-classify-lane-runtime-code-misclassified-doc-layer

classifyLane's CODE_OR_INFRA set only recognizes services/, libs/, apps/, infrastructure/ — a diff touching only runtime/**, tools/**, or .claude/skills/**/*.mjs falls through to 'doc-layer' ("nothing recognizable to deploy"), which nulls laneToTrigger and skips the pre-ship audit batch AND mislabels the lane vs backlog-next SKILL.md §3 taxonomy (a code change is Simple, not Doc-layer). Behaviorally harmless today (nothing deployable in those trees), but the lane name leaks into run-next output/postflight lane selection, and a future runtime-code change wanting the audit-context pre-ship batch silently skips it. Surfaced while driving import-boundary-dynamic-import-gap on the runtime engine (soak run): the drive printed lane=doc-layer for a runtime/engine/test code diff.
