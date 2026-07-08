---
id: deploy-gate-runner-pipefail-silent-green
status: shipped
closed: 2026-07-08
type: bug
epic: runtime-operationalization
epic_role: core
notes: "deploy-gate-runner integration stage pipes without pipefail — affected-projects.mjs crash → xargs -r runs nothing → silent-green deploy gate. Trigger fired 2026-07-08 (user-confirmed): soak is 1/5 and the upcoming runtime-driven workstreams are exactly what this gate protects — deploy-gate integrity must precede any service-touching soak workstream."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: "commits 44312f45 (fix: resolve-then-run shOut seam, integration-resolve fail-hard, AWS_PROFILE warn + .env hydration in CLI main; DGR4-8) + 483b6985 (6.4b: no-pipe-exit-masking extended to JS sh-string pipelines, PM8-12 + JS eval fixtures, measured 0 findings on clean tree pre-widening) on main; pnpm nx run-many -t test,typecheck -p runtime,tools true-exit 0 (runtime 402/402, tools 137/137); parity-oracle deterministic 34/34; node tools/check-pipe-mask.mjs clean-tree exit 0; driven end-to-end on the runtime engine under RUNTIME_ENGINE (run-next.mjs exit 3 park execute → fulfil → exit 3 park ship floor → user Ship via AskUserQuestion → exit 0 done, fallback-free — soak evidence 2/5); ship-recheck gate-clean journaled at 483b6985; mint consideration recorded --minted no-pipe-exit-masking (extended-in-place, user-approved)"
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

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-08
- **Decision:** Named /backlog-next target deploy-gate-runner-pipefail-silent-green was status: parking (rule 8). Promote and work now, or leave parked?
- **Options:** Promote to queued rank 4 and proceed | Leave parked, stop
- **Chosen:** Promote to queued rank 4 and proceed
- **Rationale:** USER-CONFIRMED via AskUserQuestion (parking refusal is never auto-taken). Trigger fired: soak stands at 1/5 and upcoming runtime-driven workstreams are what this gate protects; deploy-gate integrity must precede any service-touching soak workstream.
- **Rejected:** Leaving it parked risks the first service-touching soak drive shipping on a false-green integration stage, corrupting soak evidence.

### D2 — 2026-07-08
- **Decision:** Drive this workstream on the legacy skill body or the runtime engine (RUNTIME_ENGINE=1 run-next.mjs)?
- **Options:** Runtime engine drive (soak evidence) | Legacy skill body
- **Chosen:** Runtime engine drive (soak evidence)
- **Rationale:** Soak-gate closes on >=5 fallback-free runtime-driven workstreams (currently 1/5); WS1 precedent (run-epic-fulfil-key-decision-id-ambiguity) proved the park/fulfil protocol on a Simple-lane main item. Engine lane classifies the runtime/-only diff as doc-layer, so the deploy-gate batch (the code under repair) does not fire on its own fix — no chicken-and-egg.
- **Rejected:** Legacy drive would produce no soak evidence and exercise nothing.

### D3 — 2026-07-08
- **Decision:** Fix shape for the silent-green integration stage: set -o pipefail prefix, or resolve-then-run via a captured shOut seam?
- **Options:** Resolve-then-run: shOut seam resolves the affected list (fail-hard on exit code), then nx run-many directly; explicit skip on empty list; stage guarded by the existing resolver-availability sandbox fallback | set -o pipefail; prefix on the existing pipeline
- **Chosen:** Resolve-then-run with shOut seam + sandbox guard, plus non-blocking AWS_PROFILE warning and .env hydration in the CLI main() only
- **Rationale:** Auto-resolved (detect-fork-blast-radius runDeployGate = exit 0, adapter-local). pipefail is not POSIX-sh portable (dash lacks it; spawnSync shell:true uses /bin/sh) and keeps the failure mode implicit. Resolve-then-run kills the pipe entirely, makes resolver crash a hard {ok:false,stage:integration-resolve}, makes the empty list an EXPLICIT no-op, and is stubbable via the same seam pattern as sh. CRITICAL: the parity sandbox has no tools/ — today its resolver crash is masked by this very bug — so the integration stage must be guarded by the existing line-17 resolver-availability fallback or rt-next-lane-complex-ship regresses. Env preflight is warn-not-block (missing AWS_PROFILE fails LOUD, not silent-green; a blocking assert would also break the sandbox stub-deploy path); the .env hydration lives in main() so the library stays pure and the sandbox (no .env) is untouched. Reusable pattern: never pipe inside a gate — resolve, check, then run.
- **Rejected:** pipefail prefix: platform-dependent, leaves empty-resolver-output and resolver-crash indistinguishable, untestable through the stub seam.

### D4 — 2026-07-08
- **Decision:** Engine ship floor: Ship item deploy-gate-runner-pipefail-silent-green?
- **Options:** Ship | Hold
- **Chosen:** Ship
- **Rationale:** USER-CONFIRMED via AskUserQuestion at the engine floor (worker design: merge/ship is always a floor ask, never auto). Evidence at ask time: commit 44312f45, DGR 8/8, runtime+tools 402, typecheck 0, parity deterministic 34/34, ship-recheck gate-clean.
- **Rejected:** Hold would re-ask next wake with no new evidence to gather.

### D5 — 2026-07-08
- **Decision:** 6.4b mint consideration chose mint-now, but discovery changed the premise: no-pipe-exit-masking already owns this lesson (minted 2026-07-04) yet was blind to JS sh-string pipelines (scope .sh-only, heuristic tee/tail-only). Mint a sibling, extend the existing check, or file follow-up?
- **Options:** Extend existing check (widen scope to runtime/tools/scripts/.claude-skills *.mjs + JS sh-string-pipeline predicate) | Mint sibling check no-pipeline-in-gate-runner | File as follow-up item
- **Chosen:** Extend existing check
- **Rationale:** USER-CONFIRMED via AskUserQuestion after the premise shift. One property = one check; re-minting a live id is a category error per deriveGeneration; strengthening a check is not guard-lowering so no curate floor is needed. Measured first (P4 lesson): widened predicate returns 0 findings on the clean post-fix tree (no commit-bricking) and would have caught the original bug line. TDD PM8-PM12; eval scenario gains good/bad JS fixtures; gotcha: the bad fixture comment must not contain the literal guard keywords or it waives itself.
- **Rejected:** Sibling check fragments one lesson across two ids and leaves the original blind outside runtime/adapters; follow-up filing would leave the 4th bite possible.
