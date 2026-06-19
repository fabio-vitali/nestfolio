---
id: flow-docs-generator-rich-diagrams
status: parking
type: design
notes: "Extend tools/generate-flow-docs.mjs + flows/SCHEMA.md so .flow.yaml can express the rich sequence diagrams currently only achievable via hand-edits to the generated .md."
references:
  - tools/generate-flow-docs.mjs
  - flows/SCHEMA.md
  - flows/advisory-cycle.flow.yaml
  - docs/data-flows/advisory-cycle.md
  - docs/data-flows/README.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: diagram-generator-gaps
epic_role: core
---

# Flow-docs generator — rich sequence-diagram support

## Why

`docs/data-flows/*.md` is auto-generated from `flows/*.flow.yaml` via `tools/generate-flow-docs.mjs`. For most flows the generated output is adequate, but `advisory-cycle.md` was hand-edited (commit `ec96a0dc` restored round-trip but at the cost of dropping the rich content) because the generator cannot express:

1. `autonumber` directive
2. External actors outside domain boxes (`Trigger`, `Bus`)
3. Multiple participants per service (`SF`, `AP`, `CB` all on `decision-workflow-ctrl`)
4. Per-participant aliases + multi-line labels
5. Reply arrows (`-->>`) for `SendTaskSuccess` returns
6. Bus as an intermediate hop (`SF->>Bus`, `Bus->>IP`)
7. Arrow labels that carry mechanism + timeout (`(waitForTaskToken, 600s)`)
8. `Note over <participant>` for state-side-effects (not just `action`)
9. `alt`/`else` branching (L1 vs L2 path)
10. `par`/`and` blocks for explicit parallelism
11. Opt-out of the auto-flowchart

If the team wants this expressive power across other flows too (likely candidates: `broker-circuit-breaker`, `order-execution`, `investor-onboarding`), the generator needs extending.

## Two paths to choose between

### Path A — full schema expansion (round-trip preserved)

Add to `flows/SCHEMA.md`:

```yaml
diagram:
  autonumber: true
  skip_flowchart: true
  mermaid_sequence: source        # source | auto | raw

participants:                     # external actors outside domain boxes
  - id: Trigger
    label: "Trigger event<br/>(AdvisoryBus)"

participant_aliases:              # short codes + custom labels for service constructs
  SF:  { service: decision-workflow-ctrl, label: "decision-workflow-ctrl<br/>DecisionStateMachine" }

sequence:                         # explicit ordered interactions (separate from steps:)
  - { from: SF, to: Bus, label: "ANALYZE_INVESTOR_PROFILE (waitForTaskToken, 600s)" }
  - { from: IP, to: SF, style: reply, label: "SendTaskSuccess({...})" }
  - note: { over: AP, text: "writes DecisionPacket row → CDC emits DECISION_PACKET_CREATED" }
  - alt:
      branches:
        - { label: "L1 auto-approved", sequence: [ ... ] }
        - { label: "L2 needs user",     sequence: [ ... ] }
```

Generator changes (in `tools/generate-flow-docs.mjs`, currently 510 lines):

1. `buildMermaid` rewrite (~120 lines added): autonumber emission, dual participant pools (external + aliased), recursive walk of `sequence:` with leaves `{from,to,style,label}` / `note` / `alt` / `par`.
2. `generateMarkdown`: gate the `## Flowchart` block on `!diagram.skip_flowchart`.
3. `buildMermaid` fallback: when `diagram.mermaid_sequence === 'raw'`, emit `raw_mermaid_sequence` verbatim.
4. `flows/SCHEMA.md`: document the new keys.

Validation cost: `sequence:` becomes a second source of truth alongside `steps:`. Mitigations:
- linter: every `from`/`to` resolves to a known alias/participant; every event-name in labels appears in some step's `emits:`.
- default to `mermaid_sequence: auto` so existing flows keep current behaviour; opt in to `source` per flow.

### Path B — escape hatch only (~20–30 LOC change)

Just add two keys:

```yaml
diagram:
  skip_flowchart: true
  mermaid_sequence: raw
raw_mermaid_sequence: |
  sequenceDiagram
      autonumber
      ...verbatim Mermaid...
```

Generator change: gate flowchart, branch on `mermaid_sequence: raw`, emit string. Trades round-trip purity for cheap delivery. The advisory-cycle.md hand-crafted diagram could go straight in.

## Recommended sequencing

- **If only `advisory-cycle` needs this:** Path B. Ship the escape hatch, paste the hand-crafted diagram in, done.
- **If 3+ flows want it:** Path A. The schema work pays back across flows; linting prevents `sequence:` from drifting from `steps:`.

Decide by surveying which other flows in `docs/data-flows/` would benefit from `alt`/`else`, multi-participant-per-service, bus-hops, or reply arrows. Quick audit before promoting.

## Promote when

- A second flow needs the rich shape (then prefer Path A), OR
- The team decides advisory-cycle's hand-edits should ship now even at the cost of round-trip (then ship Path B).

Either way the entry can move from `parking` to `queued` with a `rank:`.

## Open questions to answer in the spec

1. Should `sequence:` default to derived-from-steps when absent, or require explicit opt-in?
2. Does Mermaid `par`/`and`/`end` render cleanly with `box`-grouped participants? (Need to verify.)
3. Where do the new fields validate — at generator time only, or also via a pre-commit script?
4. Survey: which other flows need any of the 11 gap items above?
