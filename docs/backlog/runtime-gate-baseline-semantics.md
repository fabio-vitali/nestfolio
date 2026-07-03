---
id: runtime-gate-baseline-semantics
status: parking
type: design
epic: runtime-operationalization
epic_role: captured
notes: "Probe-surfaced (contract-gap #1): item gates run global invariants whole-scope, so pre-existing tree debt blocks every item's start gate. Interim: baseline-exclusion ratchet (per-file sidecars, blunt at 72-file scale). Design the proper semantics: baseline-relative / diff-aware item gates — 'the item made nothing worse' — mirroring make-it-fire's attribution-not-selection precedent."
references:
  - docs/superpowers/specs/2026-07-03-runtime-gate-diff-scoping-design.md
  - docs/superpowers/specs/2026-07-03-runtime-seam-probe-design.md
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Item-gate baseline semantics — diff-aware gates vs the exclusion ratchet

Surfaced by the FIRST live drive of `runWorker` (runtime-seam-probe, 2026-07-04): the start gate failed
with 5 findings, all pre-existing whole-tree debt (`gate-surfaced-source-debt`) — global invariants ride
every item gate unconditionally and whole-scope, so **no item can start while any known debt exists
anywhere**. Same discovery `runtime-make-it-fire` made at the commit trigger; the item-gate trigger never
got the diff-scoping treatment.

**Interim (shipped with the probe):** baseline-exclusion ratchet — per-file sidecar entries for all 94
current debt paths, tagged to `gate-surfaced-source-debt` with a binding removal contract. Known
bluntness: a listed file is exempt from that check entirely (even new violations) until its entry is
removed; at 72 files for `no-unsafe-casts` this is a real enforcement hole.

**To design:** baseline-relative item gates — a gate asserts *the item made nothing worse* (findings
vs merge-base delta, or per-line baselines), while whole-tree cleanliness remains the watch engine's
audit job (findings → intake → debt items). Mirrors the frozen diff-scoping principle: narrow
**attribution**, never **selection**; the invariant floor still rides every gate. Should subsume and
then retire the exclusion ratchet.
