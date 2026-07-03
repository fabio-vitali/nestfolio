---
id: runtime-regression-harness
status: parking
type: tooling
epic: runtime-operationalization
epic_role: core
notes: "The PARITY ORACLE (re-scoped 2026-07-03): a benchmark-backlog-style harness that grades the runtime loop against the LEGACY backlog skills on the SAME scenarios (the objective 'value ≥ legacy' instrument + the P5 migration go/no-go), plus baseline.json release comparison, a real-LLM behavioral eval of the loop, and a greenfield adoption e2e sandbox — reusing the live defineSuite seam."
references: []
out_of_scope: []
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
of the SPEC 3 H1 rewire — and the `sandbox.mjs`/`grade.mjs`/`judge.mjs` patterns. Depends on
`runtime-seam-probe` (a real loop to eval) and `runtime-backward-edge-live` (mint/curate for scenario (d)).
Headless real-LLM runs cost quota — front-load heavy calibration runs where quota allows.
