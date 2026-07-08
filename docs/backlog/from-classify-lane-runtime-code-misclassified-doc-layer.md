---
id: from-classify-lane-runtime-code-misclassified-doc-layer
type: bug
status: queued
rank: 4
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
