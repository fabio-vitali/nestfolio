---
id: deploy-gate-runner-pipefail-silent-green
status: queued
rank: 4
type: bug
epic: runtime-operationalization
epic_role: core
notes: "deploy-gate-runner integration stage pipes without pipefail — affected-projects.mjs crash → xargs -r runs nothing → silent-green deploy gate. Trigger fired 2026-07-08 (user-confirmed): soak is 1/5 and the upcoming runtime-driven workstreams are exactly what this gate protects — deploy-gate integrity must precede any service-touching soak workstream."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# deploy-gate-runner: integration stage can report silent green (no pipefail)

Found in the post-ship review of `runtime-replatform-next` (WS-3). `runtime/adapters/claude-code/deploy-gate-runner.mjs:32` runs the affected-integration stage as one `sh` pipeline:

```
node tools/affected-projects.mjs --base=… --with-target=test-integration | paste -sd, - | xargs -r -I{} pnpm nx run-many -t test-integration -p {}
```

`spawnSync(cmd, {shell:true})` uses `/bin/sh` with **no pipefail**, so if `tools/affected-projects.mjs` exits non-zero mid-gate (nx daemon glitch, graph error — the try/catch at line 17 only guards the *import*/classify block, not this invocation), the pipe delivers empty input, `xargs -r` runs nothing, the pipeline exits 0, and `runDeployGate` reports the integration stage green **with zero tests run** — a false-green ship gate. This is the exact "pipe masks exit code" failure mode (feedback memory), resurfacing in the one path whose live proof was deliberately deferred to the soak. DGR1–3 stub `sh`, so shell-level semantics are untested.

Same live-proof bucket: `spawnSync` inherits `process.env`, and raw `node` does **not** load `.env` — `AWS_PROFILE` may be absent when `deploy.sh` fires (line 29) from a bare driver invocation.

**Cheapest fix:** resolve the project list via a separate `execSync` (fail hard on its exit code), then run `pnpm nx run-many` directly — or prefix the pipeline with `set -o pipefail;`. Add a DGR case where the resolver crashes and assert `ok:false`. Consider env preflight (assert `AWS_PROFILE`) before the deploy stage.

**Why core:** a silently-green deploy gate would corrupt the soak-gate evidence (`runtime-replatform-soak-gate` closes on "demonstrated not asserted"). **Trigger fired 2026-07-08** (user-confirmed promotion): soak stands at 1/5 and the upcoming runtime-driven workstreams are what this gate protects — it must be fixed before the first **service-touching** workstream driven by `run-next.mjs` under `RUNTIME_ENGINE`.
