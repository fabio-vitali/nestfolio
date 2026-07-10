# Plan — runtime-legacy-retirement (P6)

> Workstream: `runtime-legacy-retirement` · spec: `docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md` §10/§12
> Decisions: D1 full final oracle sweep as pre-removal gate · D2 comparator retires, deterministic
> differential survives runtime-only · D3 plain `path:runtime` provenance kept, fallback instrumentation dies.

## Pre-removal gate (ALL must be green before any deletion)

1. **FINAL parity-oracle sweep** — `node scripts/parity-oracle/run.mjs parity` (17 mapped pairs,
   Opus, exit 0). The last run ever possible: the oracle needs the legacy bodies alive, and the
   driver mains changed after the 2026-07-08 green sweep (`8dafc83c`).
2. **Live soak clauses 1–2** — `soak-observer.mjs`: ≥5 runtime workstreams (actual: 12), zero
   `path:legacy-fallback` (actual: 0).
3. **Deterministic differential green** — `lint-differential.mjs`: every rule `both-catch`, no
   `good-false-positive` (verified green 2026-07-09 pre-sweep).
4. **Capability-coverage audit** — zero undischarged gaps (matrix below). PASSED 2026-07-09.

## Deletion inventory (from the 2026-07-09 exploration; line refs at audit time)

The whole strangler hangs on ONE predicate: `usesRuntimeEngine(env)` at
`runtime/engine/lib/path-provenance.mjs:13`. Retirement = collapse every branch to the runtime arm.

### Skills (prose)

| File | Delete | Keep |
|---|---|---|
| `backlog-next/SKILL.md` | §5a flag framing (runtime drive becomes the unconditional Step-5 body); §6.3 detect-deploy; §6.4 deploy+scoped-validation (both subsumed by the runtime deploy-gate); `next-driver.mjs` mention | §0–§4, §5 routing, §6.1, §6.2, §6.4b, §6.5 (frontmatter write), §6.6–§6.8, §7, `--auto` policy, epic-member mode |
| `backlog-next-epic/SKILL.md` | The "Runtime engine drive (behind RUNTIME_ENGINE)" subsection (flag framing; run-epic becomes the unconditional E4–E6 drive); legacy E4–E6 drive prose; `epic-driver.mjs` mention | E0–E3, E5 `--auto` floor policy, E7 captured audit, E8 single PR + cleanup + postflight |
| `backlog-add/SKILL.md` | The "flag unset → legacy prose router (retained byte-for-byte until P6)" sentinel + flag framing; the prose router body | File templates + `notes:` quoting rule (load-bearing for the write layer `run-intake.mjs` feeds), router semantics doc as description of `intake.mjs` behavior |
| `backlog-lint/SKILL.md` | Flag sentinels ("When RUNTIME_ENGINE is unset …retained until P6"); legacy invocation framing | 11-rules section, `--fix` regen side-car (the runtime gate never runs regen — permanent design), `lib/` engine (runtime checks delegate INTO `lib/rules.mjs`) |

### Seam modules + tests

| File | Fate |
|---|---|
| `backlog-next/backlog-gate.mjs` | Collapse to runtime-only single return (run-watch cmd); legacy `lint.mjs` arm dies |
| `backlog-next/next-driver.mjs` + test | DELETE (constant after collapse; SKILL names `run-next.mjs` directly) |
| `backlog-next-epic/epic-driver.mjs` + test | DELETE (same) |
| `backlog-next/preflight.mjs` / `postflight.mjs` | Keep; collapse the `backlogGate` call to the runtime gate; keep ALL backward-evidence checks (`ship:<id>:gate-clean`, `consider:<id>`) |
| `backlog-next/test/backlog-gate.test.mjs` | Rewrite: sole runtime-gate assertion (quoted-glob assertion stays — load-bearing) |
| `backlog-next/test/gate-wiring.test.mjs` | Rewrite: preflight/postflight shell the runtime gate |
| `backlog-add/test/runtime-flag.test.mjs`, `backlog-lint/test/runtime-flag.test.mjs` | Rewrite: assert the runtime path is documented as the ONLY path; legacy-retention assertions die |
| `runtime/engine/lib/path-provenance.mjs` | DELETE `usesRuntimeEngine`, `FALLBACK_RUN_ID`, `PATH_LEGACY_FALLBACK`, `fallbackKey`, `recordLegacyFallback`; KEEP `RUNTIME_PATH_KEY`, `PATH_RUNTIME`, `recordRuntimePath`, `isRuntimePathRecord` (D3) + their test cases |

### Hook

`scripts/verify-structure.sh` #1–10 retire in favor of the runtime pre-commit gate
(`runtime/adapters/git/pre-commit-gate.mjs`) + `scripts/check-service-structure.sh`; reinstall via
`package.json` `prepare` + re-copy to `.git/hooks/pre-commit` (the post-merge reinstall deferred by
`runtime-check-migration-completion`). Double-covered checks (#1–5 → `service-structure.yaml`,
#8 → `typed-subjects.yaml`, #9 → `typed-fixtures.yaml`, #10 → `service-card-fresh.yaml`) come out
of the hook script.

### Comparator (D2)

- DIE: `parity-oracle/run.mjs` A/B modes, `suites.mjs`, `mapping.mjs`, `verdict.mjs`,
  `parity-report.mjs`, `parity-baseline.json(+provenance)`, `runtime-sandbox.mjs`,
  `soak-observer.mjs` (+ test), `runtime-grade.mjs` A/B wrapper; `scripts/benchmark-backlog/`
  legacy corpus (scenarios, baseline.json) — subject to an import-chain check: pieces the
  surviving differential imports (`store-sandbox.mjs`, `structural-lint.mjs`, possibly
  `sandbox.mjs` internals) are kept or inlined.
- SURVIVE runtime-only: `lint-differential.mjs` (drop `legacyExit` + legacy classes; assert
  `bad→exit 1, good→exit 0` per rule over the same fixtures), fixtures
  `parity-oracle/fixtures/lint/<rule>/{good,bad}/`, its test re-pointed (`both-catch` →
  `runtime-catches`).

### Doc layer

- `runtime/GUIDE.md` — full rewrite of stale sections: status sentence ("not yet an automation" →
  the runtime IS the live enforcement + work-driver), §2 (add run-next/run-epic/run-view drives),
  §4 (mint/curate CLI exists: `run-backward.mjs`), §5 (runProcedure bound via
  `makeDriverCapabilities`), §6 (regression = runtime-only differential post-D2), §7 (all three
  "not wired" items shipped; rewrite as current operational surface), §8 quick-reference (drop
  "old backlog workflow" row, add driver/view/backward rows). FIRST-CLASS deliverable.
- `runtime/README.md` — §12 equivalence map (operational surface shipped, not deferred), layout
  block (operational-surface.mjs, run-view/next/epic/backward), validation sentence
  (benchmark-backlog corpus → runtime-only regression suite). FIRST-CLASS deliverable.
- `CLAUDE.md` — no flag mentions (verified); no §5a-style edits needed.
- Historical specs/plans under `docs/superpowers/` — keep as point-in-time records.
- Dossier `project_runtime_realization.md` — retirement narrative at ship.

## Capability-coverage matrix (gate clause 4 evidence)

Runtime-owned (✓): deploy detect (`deploy-gate-runner.mjs`), deploy+integration+e2e batch
(`deploy-gate.yaml` via `worker.mjs preShipBatch`, sha-conditional), ship floor (`worker.mjs`
askStep — never auto), backward edge (`ship-recheck.mjs`, `run-backward.mjs` mint/curate/consider),
epic member loop + pre-done batch (`run-epic.mjs` → `orchestrator.mjs`), intake routing
(`intake.mjs` + `run-intake.mjs`), 11 lint rules (`backlog-*.yaml` → `lib/rules.mjs` via
run-watch), operator visibility (`run-view.mjs` + `operational-surface.mjs`).

Host-retained by design (prose survives): §6.1 derivation regen, §6.2 unit tests+lint, §6.5
frontmatter write, §6.6 index regen (`lint.mjs --fix` side-car), §6.7/§6.8, E0–E3, E7, E8.

Zero undischarged gaps → the runtime + retained host prose ≥ legacy on every capability.

## Out of scope

Mirrors the workstream frontmatter: ring-1 contract redesign; net-new checks; engine behavior
changes beyond seam collapse; epic closure (separate act); captured members; WS-4 deferred
gh-PR-probe/worktree-ops binding.

## Sequencing

1. Gate green (sweep + soak + differential + matrix) → 2. skills prose + seam collapse + flag
death + provenance trim (one commit) → 3. hook refactor + reinstall (one commit) → 4. comparator
retirement + differential conversion (one commit) → 5. GUIDE/README + doc sweep (one commit) →
6. tests + ship-recheck + mint consideration + ship.
