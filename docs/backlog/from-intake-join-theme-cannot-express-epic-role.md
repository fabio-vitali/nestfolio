---
id: from-intake-join-theme-cannot-express-epic-role
type: bug
status: shipped
closed: 2026-07-10
validation_gate: "Fixed on feat/epic-backlog-item-frontmatter-integrity (a8f18a79): shapeItems collapses the fold/join-theme/mint-aggregation arms to write epic_role route-agnostically (epicRole ?? 'core'); renderIntakePrompt now requests epicRole for every epic-attaching route so the judge fills it in. Regression tests all green: intake.test.mjs D8/D9/D10 (ring-1 shapeItems threading + core default), run-intake.test.mjs join-theme write-path (epic_role lands in the file), intake-context.test.mjs route-agnostic epicRole prompt. Gate: nx run-many -t test,lint -p runtime,tools → 425 pass / 0 fail; runtime:typecheck green; deploy=false (all Tier 0). Batched e2e runs once at epic pre-done (E6)."
out_of_scope:
  - "The lint element-shape validation half of the epic (its sibling member, already shipped) — this member is the write-side (intake) half only."
  - "The closure-predicate semantics themselves / which epic the judge picks — this threads the judge's already-emitted epicRole through the write, it does not change the judgment."
  - "Retro-fixing backlog items already filed with a silently-dropped role (no data migration) — the fix is forward-only for new intakes."
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

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-10
- **Decision:** How much of the intake contract to touch to make epicRole route-agnostic
- **Options:** Patch only the join-theme/mint-aggregation arms of shapeItems (minimal write-side fix) | Collapse the three epic-attaching arms in shapeItems AND update renderIntakePrompt to request epicRole for every epic-attaching route (complete contract)
- **Chosen:** Collapse the three epic-attaching arms + update renderIntakePrompt
- **Rationale:** Cleanest + most reusable: fold/join-theme/mint-aggregation produce an identical item shape (epic pointer + role), so collapsing removes duplication and makes role expression route-agnostic by construction; updating the prompt closes the latent gap where the judge is told to emit epicRole only for fold. Blast-radius gate exit 0 on both symbols; sibling member already shipped, so no downstream ripple. Reusability breaks the tie over the minimal write-only patch.
- **Rejected:** shapeItems-only patch — leaves the judge instructed to emit epicRole only for fold, so join-theme/mint-aggregation decisions can still omit the role and default to core: a latent re-occurrence of the same silent-core bug.
