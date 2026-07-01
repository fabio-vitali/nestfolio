---
id: runtime-realization-specs
status: shipped
rank: null
type: design
references:
  - docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md
  - docs/superpowers/specs/2026-07-01-runtime-spec-2-backward-edge-learning-loop.md
  - docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md
  - docs/vision/long-horizon-engineering-runtime.md
  - docs/superpowers/specs/2026-06-30-long-horizon-runtime-target-architecture-design.md
  - docs/superpowers/specs/2026-06-30-long-horizon-engineering-runtime-definition.md
  - docs/reviews/2026-06-30-long-horizon-runtime-spec-review.md
  - docs/reviews/2026-07-01-long-horizon-runtime-vision-review.md
out_of_scope:
  - Implementation plans (writing-plans → TDD) — these specs are the realization-phase specs; the plan phase follows separately per spec.
  - Product name (vision §15.7) — remains TBD; not a spec.
  - Extracting the Runtime into a standalone repo/package — the specs describe the portable core + Nestfolio as the first content ring, but the physical extraction is a later workstream.
  - Re-litigating the vision/target-architecture (frozen inputs) — the specs derive from them, they do not revise them.
  - Building the checks/adapters/journal themselves — the specs are the buildable contracts, not the build.
spec: null
plan: null
topic_memory: []
validation_gate: |
  Doc-layer (design umbrella) workstream. Deliverable: three implementation-ready realization
  specs derived from the vision, moat-first, via a ground→draft→verify→revise multi-agent workflow
  (13 agents; grounding inventoried 34 real check surfaces, 58 feedback lessons / 17 checkable
  today, 5 dogfood lessons). Adversarial verify+revise applied 32 findings (12+10+10), zero
  skipped. Cross-spec contract reconciled by hand: intake now writes provenance.from_finding =
  finding.id (was finding.check); the starter-pack Provenance sentinel absorbed into SPEC 1 §15
  (re-freeze delta 3). All 5 vision-review tensions verified honored, not reintroduced. Specs:
  2026-07-01-runtime-spec-1-check-registry-and-atom.md (ring-1 core, schema frozen),
  2026-07-01-runtime-spec-2-backward-edge-learning-loop.md (the moat, dogfooded first on 5 real
  lessons), 2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md (watch/intake/planner/
  execution + 6 capability interfaces + journal + no-lost-value equivalence map). Each spec carries
  its own § Out of scope + validation strategy; per-spec implementation plans are the next
  workstreams (out of scope here).
notes: "Derive the realization-phase specifications from the long-horizon-engineering-runtime vision. Moat-first, 3 implementation-ready specs: (1) Check Registry & the hybrid atom, (2) the Backward Edge / learning loop (the moat, proven first on real reference-project lessons), (3) Forward Edge & capability seams (watch/intake/planner/execution + 6 capability interfaces + journal). Target-architecture already delivered the design level and deferred a §15 realization list; these specs are that layer. Derived via multi-agent workflow (ground → draft foundation → draft dependent → verify → revise)."
---

# Runtime realization specs — derive the buildable spec set from the vision

Design umbrella. The vision (`docs/vision/long-horizon-engineering-runtime.md`) and the
target-architecture design settle *what the Runtime is and how its parts fit*, and defer a §15
"realization phase" list (registry, backward-edge heuristics, capability/journal contracts, starter
library, operational surface). This workstream produces that realization layer as **three
implementation-ready specs**, sequenced moat-first per the vision's own directive ("prove the backward
edge first"):

1. **Check Registry & the Hybrid Atom** — the check schema, the four finding kinds, the check
   lifecycle, the three contexts, and the self-check / meta-check. The "single thing to build, test,
   and port" (ring-1 core).
2. **The Backward Edge — Learning Loop** — mint + curate, the floor protocol, provenance/supersession
   chains, enforcement-as-memory (`mints:`), and eval-scenario landing. The moat, proven first on a
   handful of real mechanizable reference-project lessons.
3. **Forward Edge & Capability Seams** — watch engine / intake / planner / execution / gates, the six
   capability interfaces, the journal idempotency contract, the three-rings/two-seams portability
   story, and the no-lost-value equivalence map.

Each spec carries its own § Out of scope and its own validation gate; draining the set completes the
realization-phase definition. Reusability is the primary objective: the core stays project-agnostic;
Nestfolio's live checks (`backlog-lint` invariants, nx drift targets, `audit-*` skills) are the
*first* content-ring entries, quarantined behind the project seam.
