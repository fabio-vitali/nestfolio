---
id: runtime-regression-harness
status: active
type: tooling
epic: runtime-operationalization
epic_role: core
notes: "The PARITY ORACLE (re-scoped 2026-07-03): a benchmark-backlog-style harness that grades the runtime loop against the LEGACY backlog skills on the SAME scenarios (the objective 'value ≥ legacy' instrument + the P5 migration go/no-go), plus baseline.json release comparison, a real-LLM behavioral eval of the loop, and a greenfield adoption e2e sandbox — reusing the live defineSuite seam."
references: []
out_of_scope:
  - "P5 itself — runtime-work-driver-replatform (re-platforming the backlog skills onto the engine loop). This workstream only produces the go/no-go instrument and its evidence."
  - "P6 legacy retirement — deleting/deprecating the legacy backlog skills; the harness only grades them."
  - "The ~34-surface check migration and CI-wiring the check golden gates — separate epic members (P4)."
  - "Re-designing ring-1 engine contracts (schemas/helpers) — frozen by runtime-realization; deltas re-freeze into SPEC 1, not here."
  - "Heavy real-LLM calibration sweeps beyond what proves the eval works — quota-gated, front-loaded only where the user approves the token spend."
  - "Operator surface (view+executor) — separate epic member."
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Runtime regression harness — the parity oracle (re-scoped 2026-07-03)

The runtime has unit tests + fixture-based check golden gates, but NOT the instrument the adoption roadmap
needs most: an **objective measure that the runtime gives all the value of the legacy backlog system AND
more**. Re-scoped as the migration's parity oracle, with four deliverables:

- **(a) PARITY — the headline.** Grade the runtime loop against the LEGACY backlog skills on the **same
  scenario set** (reuse/extend the benchmark-backlog scenarios): lint parity (11 rules vs registry gates),
  router parity (backlog-add vs intake), driver parity (backlog-next vs worker spine). This is the
  go/no-go gate for `runtime-work-driver-replatform` (P5) and the evidence for legacy retirement (P6).
- **(b)** a `baseline.json`-style versioned **release comparison** (did release B regress vs A?).
- **(c)** a **real-LLM behavioral eval** of the loop (worker/orchestrator/intake decision quality driven
  headlessly through the live adapter — today's loop tests use injected spies).
- **(d)** a **greenfield adoption e2e**: a real git sandbox where `init` seeds a fresh repo, a violation is
  committed, the gate blocks, a check is minted at the floor, another is curated away — the full loop in
  one scenario. Doubles as the portability/cold-start proof.

Build these reusing the now-live `defineSuite` seam (`scripts/benchmark-backlog/suite.mjs`) — the whole point
of the SPEC 3 H1 rewire — and the `sandbox.mjs`/`grade.mjs`/`judge.mjs` patterns. Both former dependencies
have shipped, so the parking trigger fired and the item was promoted 2026-07-05: `runtime-seam-probe`
(shipped — provides the real loop to eval) and `runtime-backward-edge-live` (shipped 2026-07-04 — provides
mint/curate for scenario (d)).
Headless real-LLM runs cost quota — front-load heavy calibration runs where quota allows.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-05
- **Decision:** Named item runtime-regression-harness was status: parking — promote and proceed, or stop?
- **Options:** Promote to queued rank 0 and proceed in this run | Promote but stop | Leave parked
- **Chosen:** Promote to queued rank 0 and proceed in this run
- **Rationale:** User-approved via AskUserQuestion (parking refusal is never auto-resolved). Both dependencies (runtime-seam-probe, runtime-backward-edge-live) are shipped, so the parking trigger fired; the runtime-realization dossier marks the parity oracle as the next P3 item.
- **Rejected:** Stopping or leaving parked would idle the epic drain despite satisfied dependencies.
