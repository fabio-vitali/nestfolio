---
id: runtime-backward-edge-live
status: queued
type: feature
rank: 4
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

5. **Red-team p2 deltas (added 2026-07-03, see `runtime-design-redteam`):** fix torn-curate ordering
   (reconcile the lesson before/atomically-with lowering the guard on disk — today a reconcile failure
   leaves the guard lowered and the retry refused, permanently); the curate-supersede successor gets the
   FULL mint guarantees (CheckEntrySchema validation + eval-scenario landing — today it is written
   unvalidated with no scenario); the floor Decision renders the complete candidate/successor (today
   `toDecision` drops them — the human ratifies sight-unseen); backward journal keys gain a lifecycle
   epoch (today a legitimate re-mint of a retired check id replays the old result and writes nothing).

**Sequencing (binding):** ships BEFORE `runtime-check-migration-completion` starts.

Roadmap: P2 of the probes-first adoption plan (see epic body).

**Promoted 2026-07-04 (trigger fired):** the P1 gate is cleared — `runtime-seam-probe` (P1a),
`runtime-design-redteam` (P1b) and `runtime-make-it-fire` all shipped 2026-07-03. The live diff-scoped
pre-commit gate is now firing with `RUNTIME_GATE_SKIP` as its only bypass, i.e. the skip-hatch-as-de-facto-
curation drift this item exists to close is live today, and the bulk check migration remains blocked
behind it.
