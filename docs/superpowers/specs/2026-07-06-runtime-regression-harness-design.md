# Runtime regression harness — the parity oracle (design)

**Date:** 2026-07-06 · **Workstream:** `runtime-regression-harness` (epic `runtime-operationalization`, P3)
**Status:** approved design (brainstorming gates D2–D5 passed 2026-07-06)

## 1. Context & problem

The runtime (`runtime/`) has unit tests and fixture-based check golden gates
(`runtime/eval/grade-check-scenario.mjs`), but not the instrument the adoption roadmap needs most: an
**objective measure that the runtime loop gives all the value of the legacy backlog system and more**.
This harness is that instrument — the go/no-go gate for `runtime-work-driver-replatform` (P5) and the
evidence base for legacy retirement (P6).

Two proven assets are composed, not rebuilt:

- `scripts/benchmark-backlog/` — the skill-level oracle: `defineSuite({buildSandbox, stubs, grade,
  scenarios})` seam (`suite.mjs`), `runMode(mode, opts, suite)` (`run.mjs`), headless `claude -p`
  runner with isolation + pause convention (`runner.mjs`), 3-layer grading (golden / invariants / LLM
  rubric, `grade.mjs` + `judge.mjs`), token-denominated `baseline.json` + provenance, 55
  engine-agnostic scenarios.
- `runtime/eval/` — the check-level golden gates (good/bad fixtures per check, auto-landed by the
  backward edge's `landEvalScenario`).

The scenarios are **behavior contracts** (prompt + fixture + expected terminal/golden/invariants):
nothing in them names the engine. That is what makes a legacy-vs-runtime comparison on the *same*
scenario set valid.

## 2. Deliverables

- **(a) PARITY** — grade the runtime loop against the legacy backlog skills on the same scenario set:
  lint parity (11 rules vs registry gates, deterministic), router parity (`backlog-add` vs
  `intake`), driver parity (`backlog-next` vs worker spine) — the latter two live-LLM.
- **(b) Release comparison** — versioned `parity-baseline.json`; `compare` answers "did release B
  regress vs A?" with teeth (non-zero exit on regression).
- **(c) Real-LLM behavioral eval** — the runtime loop driven headlessly through the live Claude Code
  adapter (`run-item.mjs` park/fulfil). This *is* the runtime side of (a)'s behavioral half — one
  mechanism, not two.
- **(d) Greenfield adoption e2e** — a deterministic full-loop scenario in a bare git sandbox:
  `init` → violation blocked → mint at the floor → minted check has teeth → curate → pass. Doubles as
  the portability/cold-start proof.

## 3. Out of scope

- **P5 itself** (`runtime-work-driver-replatform`) — this workstream produces the instrument and its
  evidence, not the re-platform. Legacy-procedure scenarios (lanes, deploy detection, `bne-*`
  orchestration phases, `themes-*`) are marked `unmapped: P5` in the mapping table, not emulated.
- **P6 legacy retirement** — the harness grades the legacy skills; it never deletes or modifies them.
- **The ~34-surface check migration and CI-wiring of the check golden gates** (P4 members).
- **Ring-1 engine contract redesign** — frozen by `runtime-realization`; any build-reconciliation
  delta re-freezes into SPEC 1/3, not here.
- **The 3× confirmation baseline** — deferred to the actual P5 go decision (D4).
- **Operator surface** — separate epic member.

## 4. Decisions (brainstorming gates, 2026-07-06)

| # | Decision | Choice |
|---|----------|--------|
| D2 | Go/no-go semantics | **Strict gate dominance**: per mapped pair, runtime `gatePassRate` ≥ legacy `gatePassRate` AND zero new hard-invariant failure classes. Tokens reported, never gated. |
| D3 | Behavioral scope at P3 | **Engine-mappable subset**: full mapping table with explicit `unmapped: P5` rows (totality-checked — no silent caps); live parity graded on the engine-expressible subset (~14–15 scenarios). |
| D4 | Quota budget | **Bring-up + 1× baseline**: deterministic layers TDD'd free; each mapping live-validated once as it lands; one full 1× interleaved baseline at close (cost re-confirmed at fire time); 3× deferred to P5-go. |
| D5 | Architecture | **Sibling suite** (`scripts/parity-oracle/`) composing benchmark-backlog's exported core; legacy suite + its `baseline.json` untouched. |

## 5. Architecture

```
scripts/parity-oracle/            ← NEW package (.mjs, node:test, zero build, house style)
  mapping.mjs                     ← THE source of truth: every legacy scenario id → runtime variant | {unmapped, reason}
  suite-legacy.mjs                ← defineSuite over benchmark-backlog's buildSandbox/gradeScenario (verbatim reuse)
  suite-runtime.mjs               ← defineSuite over runtime-sandbox + runtime-grade + generated rt-* variants
  runtime-sandbox.mjs             ← buildRuntimeSandbox(scenario, ref)
  runtime-grade.mjs               ← gradeScenario(...) + journal-invariants layer
  lint-differential.mjs           ← deterministic 11-rules-vs-registry differential (no LLM)
  verdict.mjs                     ← pure dominance math (per-pair + overall PARITY verdict)
  run.mjs                         ← modes: parity | differential | rebaseline | compare
  parity-baseline.json            ← committed rows (+ parity-baseline.provenance.json)
  fixtures/lint/<rule>/{good,bad} ← per-rule shared stores (reuse benchmark fixtures where possible)
  scenarios/*.scenario.mjs        ← rt-* variants (extend imported legacy scenario objects)
  test/*.test.mjs                 ← unit suite incl. oracle-teeth

runtime/adapters/claude-code/run-intake.mjs   ← NEW ring-2 driver (mirrors run-item.mjs park/fulfil)
runtime/eval/e2e/greenfield.test.mjs          ← NEW deliverable (d), joins the runtime:test globs
```

Composition rules:

- **Import, never move**: parity-oracle imports `runMode`, `runScenario`, `gradeScenario`,
  `report.mjs`, `cost.mjs` from `scripts/benchmark-backlog/`. Zero edits to the legacy suite; its
  committed baseline stays valid (bef lesson: every runner/sandbox change stales the baseline).
- **The runtime side's spawn target is still `claude`.** What changes is sandbox content and prompt
  (drive the loop drivers, not the skills), so `runScenario`/`buildClaudeArgs`/env isolation/pause
  convention are reused as-is.
- The reusable pattern: *grade engine-B against engine-A on shared behavior contracts via two composed
  suites + a dominance verdict*. `mapping.mjs` + `verdict.mjs` + the pairing runner carry no
  backlog-specific knowledge.

## 6. Scenario mapping (`mapping.mjs`)

Format — one entry per legacy scenario id, closed shape, totality-enforced by a unit test:

```js
export const MAPPING = {
  'add-fold-core':        { runtime: { driver: 'intake', /* prompt/golden/journal deltas */ } },
  'bne-e8-pr-route':      { unmapped: 'P5', reason: 'orchestrator re-platform; E8 is skill prose' },
  // ... every one of the 55 ids appears exactly once
};
```

First cut (finalized at plan time against the actual scenario/check inventories):

- **7 of 9 `add-*` → mapped (router parity).** Runtime variant drives `run-intake.mjs` with the same
  finding text over the same fixture; golden asserts the same filed *routing* outcome
  (`epic:`/`epic_role`/`status` — the filename follows the runtime's `from-<check>` slug convention,
  not the legacy title-derived slug). `selectRoute`/`shapeItems` branches
  (`discard|split|fold|join-theme|mint-aggregation|orphan`) map 1:1 to `backlog-add`'s router.
  Plan-time correction (2026-07-06): `add-id-collision-suffix` + `add-notes-scalar` are write-layer
  prose (filename suffixing / notes styling), not routing → `unmapped: P5`.
- **`next-*` engine-expressible subset → mapped (driver parity, 4):** `next-lane-complex-ship`
  (full drive: adopt → execute-park → work → ship-gate → ship-ask), `next-auto-floor-pause` +
  `next-auto-finishing-pr-stop` (the worker's ship is *always* a floor ask),
  `next-preflight-dirty-stop` (start-gate blocks out-of-scope dirt). Lane classification, deploy
  detection, design-fork recognition and blast-radius forks are skill prose → `unmapped: P5`.
- **All 34 `bne-*` + 2 `themes-*` → `unmapped: P5`** (orchestrator/clustering procedures).

Live mapped set (plan-time): **11 pairs** (7 intake + 4 worker), within the approved budget.

The unmapped rows are a feature: they ARE the honest P5 migration checklist, and the report prints
them (no-silent-caps rule).

## 7. Runtime-side run mechanics

**Sandbox** (`runtime-sandbox.mjs`, mirrors `sandbox.mjs`): throwaway git repo + bare origin; minimal
`package.json`; fixture → `docs/`; **`runtime/` copied ref-aware** (`git archive <ref> -- runtime |
tar -x`, HEAD → working-tree `cpSync` — same dual mode as `copySkill`); sandbox-local
`runtime.config.json` pointing at sandbox dirs; same op stubs (`deploy.sh`/`gh`/`nx` — the work is the
same work); same trimmed `CLAUDE.md`; baseline commit + push. No `.claude/skills/` (the runtime side
must not fall back to legacy prose).

**Operator prompt contract:** the headless session is the *loop operator*, not the procedure. It
invokes `node runtime/adapters/claude-code/run-item.mjs --item <id> …` (or `run-intake.mjs`); on exit
3 it reads the printed pending Decision: execute-parks → perform the task in the repo, then re-invoke
with `--fulfil <key> --value …`; floor-asks (ship/merge/mint) → emit `<<HARNESS-PAUSE: reason>>` as
the final line; repeat until exit 0. This yields the pause symmetry: legacy's
headless-AskUserQuestion-absent pause and the runtime's floor park classify through the same
`classifyTerminal`, so `scenario.terminal` grades both engines unchanged.

**`run-intake.mjs`** (new, ring 2): mirrors `run-item.mjs` — `driveIntake({finding, backlogDir,
checksDir, fulfil, capabilities})`, exit 0 done / 3 parked / 1 failed / 2 usage, fulfil by pending
key. Pure composition of `engine/lib/intake.mjs` (`selectRoute` + `shapeItems`) with the adapter
capabilities; no new engine surface.

## 8. Grading & parity verdict

`runtime-grade.mjs` = the existing 3 layers unchanged (golden frontmatter oracle works identically —
items are still `docs/backlog/*.md`; call-log/state invariants — same stubs; opt-in LLM rubric with
full-branch-diff judge) **plus one new deterministic layer**:

- **Journal invariants** — `scenario.journal: [{runId, has: 'ship:<id>:gate-clean'} | {awaiting: key}
  | {fulfilled: key}]`, asserted via `makeJournal({root: <sandbox git-common-dir>}).read(runId)`. The
  runtime's native evidence surface (park/fulfil records, gate-clean, consider) that legacy doesn't
  have.

**Pairing & verdict** (`verdict.mjs`, pure):

- Each mapped row runs interleaved legacy,runtime per iteration (temporal-drift balance, borrowed
  from `compare` mode).
- Per-pair: `dominant = runtime.gatePassRate >= legacy.gatePassRate && noNewHardInvariantClass`
  (a hard-invariant failure class = a `neverCalled` violation, terminal mismatch, or journal-invariant
  failure absent from the legacy row's failure classes).
- **PARITY = GREEN iff every mapped pair is dominant AND the lint differential has zero
  legacy-only catches on mapped rules.** Tokens (`tokens.total`, the amortized value signal) are
  reported per pair — informational, never gated (D2).

## 9. Lint differential (deterministic, no LLM)

`RULE_MAP` — all 11 `backlog-lint` rules + the index-render check + the element-shape class, each →
registry check id(s) or `unmapped`. Known overlaps to encode: rule 1 ↔ `backlog-id-matches-filename`,
rule 2 ↔ `single-active`/`activePartition`, rule 3 ↔ `references-valid` (starter, design/spec-scoped),
scope ↔ `active-item-scope-gate`, index ↔ `index-fresh`, shape class ↔ `item-store-valid`
(runtime-only bonus). Rules without a runtime check yet (4/5/6/8/9/10 as of today) → `unmapped` gap
rows feeding the P4 checklist.

Per rule, shared `{good, bad}` fixture stores. Legacy side: spawn `lint.mjs`, parse exit + violations.
Runtime side: `readItems` (fail-closed) + `runGate` over the loaded registry. Verdict classes:
`both-catch` (parity) / **`legacy-only` on a mapped rule (RED)** / `legacy-only` on unmapped (honest
gap) / `runtime-only` (bonus). Runs as plain `node --test` (CI-free) and as the `differential` mode
feeding the report. This table *quantifies* the 11-rules-vs-registry gap.

## 10. Baseline & compare (deliverable b)

- `parity-baseline.json`: rows `{id, legacy: aggRow, runtime: aggRow, verdict}` + differential summary.
  `aggRow` = benchmark-backlog's `aggregate()` shape (`gatePassRate`, `anyGateFlip`, token medians,
  turns). Provenance file records sha/model/iterations/source-run per row.
- `rebaseline`: crash-safe — run → scratch file → validate JSON → `cp` into the committed file (never
  pipe into it; a mid-run kill otherwise truncates it).
- `compare`: re-run (or load rows) vs baseline via `flagBands`/`renderCompare`; **exit non-zero on any
  pair regression** (`gatePassRate` drop or verdict flip). Differential re-runs fresh (cheap).
- Reports → gitignored `benchmarks/`, path printed (house rule).

## 11. Greenfield adoption e2e (deliverable d)

`runtime/eval/e2e/greenfield.test.mjs` — deterministic `node:test`; the test plays the human via
`--fulfil`. Temp git repo containing ONLY `runtime/` + git (no Nestfolio content):

1. `node runtime/cli.mjs init` → starter checks seeded; registry loads clean.
2. Pre-commit hook wired to `adapters/git/pre-commit-gate.mjs` (as `make-it-fire` does).
3. Commit a violation fixture → **gate blocks** (non-zero exit, finding printed).
4. `run-backward.mjs mint --proposal …` → parks (exit 3) → test fulfils ratify → check registered +
   eval scenario landed via `landEvalScenario`.
5. Commit violating the *minted* check → **blocked** (the minted check has teeth).
6. `run-backward.mjs curate` retire via floor (park → fulfil) → previously-blocked commit passes.
7. Journal + registry state asserted at each step (fail-closed on registry errors).

Joins the `runtime:test` globs (fast: local process spawns only, no LLM).

## 12. Testing strategy

- **Unit suite** (`scripts/parity-oracle/test/`, `node --test` glob form): mapping totality (every
  legacy id exactly once; `unmapped` ⇒ `reason`), verdict math edge cases (ties, flips, errored
  pairs), journal-invariant grader against `inMemoryJournal`-written ledgers, differential rule-map
  totality (all 11 rules present) + all four verdict classes, baseline crash-safe write, report
  render, structural lint for `rt-*` scenarios (extended key set incl. `journal` — benchmark's linter
  untouched).
- **`run-intake.mjs` units** under `runtime/adapters/claude-code/test/` (park/fulfil/exit codes,
  mirroring run-item's suite).
- **Oracle-teeth test**: sabotage the runtime side (corrupt registry yaml in a fixture → fail-closed)
  and assert the per-pair verdict flips to non-dominant and PARITY goes RED. The instrument must
  provably be able to say **no**.
- Validation commands: `pnpm nx run runtime:test` + `runtime:typecheck` + `node --test
  scripts/parity-oracle/test/*.test.mjs` (+ benchmark-backlog suite stays green untouched).

## 13. Error handling

- Per-pair try/catch: one pair's crash marks it `errored` (counts as non-dominant), sweep continues.
- Judge crash-proofing inherited (retry once → `{scores: null}`, never throw).
- Registry errors **fail closed** (`registryErrorLines` → scenario fails; never a silent pass).
- Timeouts (600s default, per-scenario override) → `terminal: timeout` → pair fails.
- Partial sweeps: report always written, dropped/errored pairs listed explicitly (no silent caps).

## 14. Live-run budget plan (D4)

1. Deterministic layers (differential, greenfield e2e, all units) — zero quota, TDD first.
2. Bring-up: each mapped scenario live-validated once as its mapping lands (~1 iteration; expect
   harness-bug findings per bef history — budget ~15–25M tokens total).
3. Close: ONE full 1× interleaved parity baseline (~15–40M tokens) — cost re-surfaced via
   AskUserQuestion with measured per-scenario numbers before it fires; committed with provenance.
4. 3× confirmation: deferred to the P5 go decision (out of scope here).

## 15. Validation gate (workstream done)

Units + `runtime:test`/`typecheck` green; differential green on mapped rules with the gap table
rendered; greenfield e2e green; every mapped scenario live-validated; 1× parity baseline captured,
committed with provenance; report path printed; oracle-teeth test proves the verdict can flip.

## References

- `scripts/benchmark-backlog/{suite,run,runner,grade,judge,report,cost,sandbox,structural-lint}.mjs`
- `runtime/engine/loop/{worker,orchestrator}.mjs`, `runtime/engine/lib/{intake,journal,scope-gate,run-gate,load-registry,plan-next}.mjs`
- `runtime/adapters/claude-code/{run-item,run-backward,index}.mjs`, `runtime/adapters/git/{pre-commit-gate,ship-recheck}.mjs`
- `runtime/eval/grade-check-scenario.mjs`, `runtime/eval/scenarios/`
- `.claude/skills/backlog-lint/{lint.mjs,lib/rules.mjs}`, `.claude/skills/backlog-next/{preflight,postflight}.mjs`
- Specs: `2026-06-24-backlog-eval-framework-design.md` (§ modes, § reusable seam), SPEC 3 §11 (eval harness), SPEC 2 §9 (eval-scenario landing), `2026-07-03-runtime-seam-probe-design.md` §2 (park/fulfil binding)
