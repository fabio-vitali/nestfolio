---
id: from-intake-join-theme-cannot-express-epic-role
type: bug
status: parking
done_when: "resolve: shapeItems' join-theme and mint-aggregation routes cannot
  write epic_role — only the fold route accepts epicRole — so every intake-filed
  theme-epic member silently defaults to core (the CLAUDE.md epic_role default).
  A finding filed with captured intent becomes a rule-9 ship blocker:
  from-run-themes-intake-bare-capabilities-conformance-gap was narrated as
  captured at filing (2026-07-08) but landed de-facto core and would have
  blocked the runtime-operationalization epic ship. Fix direction: thread
  epicRole through the IntakeDecision contract and the
  join-theme/mint-aggregation arms of shapeItems (route-agnostic role
  expression), with the closure-predicate instruction already present in
  renderIntakePrompt guiding the judge's core-vs-captured call."
provenance:
  from_finding: intake-join-theme-cannot-express-epic-role
epic: backlog-item-frontmatter-integrity
epic_role: core
---

# from-intake-join-theme-cannot-express-epic-role

shapeItems' join-theme and mint-aggregation routes cannot write epic_role — only the fold route accepts epicRole — so every intake-filed theme-epic member silently defaults to core (the CLAUDE.md epic_role default). A finding filed with captured intent becomes a rule-9 ship blocker: from-run-themes-intake-bare-capabilities-conformance-gap was narrated as captured at filing (2026-07-08) but landed de-facto core and would have blocked the runtime-operationalization epic ship. Fix direction: thread epicRole through the IntakeDecision contract and the join-theme/mint-aggregation arms of shapeItems (route-agnostic role expression), with the closure-predicate instruction already present in renderIntakePrompt guiding the judge's core-vs-captured call.

**Self-demonstrating filing (2026-07-09).** THIS item was filed through `run-intake.mjs` with the
route decision `{route: "join-theme", epic: "runtime-operationalization", epicRole: "captured"}` —
and landed WITHOUT `epic_role:` exactly as described (the judge's rendered contract even names
`epicRole` in its return shape; `shapeItems` drops it on this arm). The `epic_role: captured` above
was hand-set post-write as the documented workaround; the fix makes that hand-step unnecessary.
Captured per the closure-predicate: no `runtime-operationalization` done_when clause covers intake
route expressiveness.
