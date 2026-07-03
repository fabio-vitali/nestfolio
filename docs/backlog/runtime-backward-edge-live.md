---
id: runtime-backward-edge-live
status: parking
type: feature
epic: runtime-operationalization
epic_role: core
notes: "P2: make the moat live — mint-in-anger (one real lesson → real floor → registered check + eval scenario), mint wired into the ship ritual, curate CLI as the ONLY sanctioned path past a failing guard, RUNTIME_GATE_SKIP instrumented. MUST precede the bulk check migration."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Backward edge live — mint and curate in anger

The vision (§3, §9, §15) is explicit: the backward edge IS the product, and it must be proven first. Today
it has only run in vitro (hermetic 5-lesson dogfood). Separately, the live pre-commit gate's only bypass is
`RUNTIME_GATE_SKIP=1` — with no curate-at-the-floor in the workflow, the skip hatch becomes de-facto
curation, i.e. exactly the silent drift design law 5 forbids. Migrating ~23 more surfaces
(`runtime-check-migration-completion`) before this ships would manufacture skip-hatch drift at 3x scale:
**the anti-moat must not ship before the moat.**

**Deliverables:**

1. **Mint-in-anger:** one REAL lesson from a real workstream driven through `runMint` with a real
   AskUserQuestion floor (not `headlessAsk`) → ratified → registered in `runtime/content/checks/` → its
   eval scenario landed. The first in-production traversal of draft → floor → register → land-eval.
2. **Mint wired into the ship ritual:** the `/backlog-next` postflight (and epic close ritual) offers the
   mint procedure over the ship's lessons — the vision's "after ship, a fix can mint" made a real step, not
   a library call nobody makes.
3. **Curate as the sanctioned gate bypass:** a small CLI (floor `ask`: retire / supersede / keep) invoked
   when the pre-commit gate blocks a *deliberate* property change — the §9 synchronous curate arm, live.
4. **Skip-hatch instrumentation:** every `RUNTIME_GATE_SKIP` use is journaled and surfaced as a finding —
   a skip is itself drift evidence. Curate becomes the cheap, sanctioned path; skip becomes visible debt.

**Sequencing (binding):** ships BEFORE `runtime-check-migration-completion` starts.

Roadmap: P2 of the probes-first adoption plan (see epic body).
