---
id: runtime-regression-harness
status: parking
type: tooling
epic: runtime-operationalization
epic_role: core
notes: "A benchmark-backlog-style regression/release-comparison harness for the runtime itself: baseline.json + regression/compare modes, a real-LLM behavioral eval of the loop, and a CLI-level e2e sandbox — reusing the live defineSuite seam."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Runtime regression / release-comparison harness

The runtime has unit tests + fixture-based check golden gates, but NOT the three things
`scripts/benchmark-backlog/` gives the backlog skills:
- **(b)** a `baseline.json`-style versioned **release comparison** (did release B regress vs A?).
- **(c)** a **real-LLM behavioral eval** of the loop (worker/orchestrator/intake decision quality driven
  headlessly through the live adapter — today's loop tests use injected spies).
- **(d)** a runnable **CLI-level e2e sandbox** harness (a real git sandbox the runtime drives end-to-end).

Build these reusing the now-live `defineSuite` seam (`scripts/benchmark-backlog/suite.mjs`) — the whole point
of the SPEC 3 H1 rewire — and the `sandbox.mjs`/`grade.mjs`/`judge.mjs` patterns. Protects runtime releases
the way benchmark-backlog protects the backlog skills. Depends on `runtime-make-it-fire` for a real loop to eval.
