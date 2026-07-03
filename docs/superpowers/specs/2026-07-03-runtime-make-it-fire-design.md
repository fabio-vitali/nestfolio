# Design — `runtime-make-it-fire`: the runtime's first live enforcement gate

- **Date:** 2026-07-03
- **Backlog item:** `docs/backlog/runtime-make-it-fire.md` (epic `runtime-operationalization`, `epic_role: core`)
- **Status:** design approved; next → `writing-plans`
- **Depends on:** merged `runtime-realization` (SPEC 1/2/3 — the runtime library)

## Context & motivation

The runtime (`runtime/`) is shipped, merged, and green — but it is a **tested library, not a running
system**: no git hook, CI job, or schedule invokes it, its adapter capabilities are stubs until a host
injects runners, and the project's *actual* enforcement is still `.git/hooks/pre-commit →
tools/check-*.mjs`. Every other `runtime-operationalization` member (especially `runtime-operational-surface`)
is gated on the capability seam being **dogfooded by a real consumer**.

This slice is the **thinnest real thing that fires**: it makes the runtime enforce its content-ring
commit-trigger checks (cheap `invariant`/`gate` context) on every commit. It deliberately does **not** exercise the `execute`/`ask`/`fanOut`
capability seam — deterministic (`cmd:`) checks run their evaluators directly, so no capability injection is
needed. It de-risks the shared trigger/changed-set/fail-closed plumbing that a later, larger slice (a
minimal loop through the live adapter) will reuse to dogfood the full seam.

## Goal

On every commit, run the content-ring checks the `commit` trigger activates (cheap `invariant` + `gate`
context, per `triggers.yaml`) scoped to the staged files, through the existing `run-watch` engine, and
**block the commit** if any finding is raised — proving the runtime path catches a real violation (not just
the legacy `tools/check-*.mjs`).

## Non-goals (explicit)

- **No capability injection** (`execute`/`ask`/`fanOut`/`runProcedure`). Out of scope by construction.
- **No check migration** — uses the ~6 already-migrated invariant checks as-is (migration is
  `runtime-check-migration-completion`).
- **Commit trigger only** — whatever it activates (cheap `invariant`/`gate` context); no `expensive`/`audit`
  checks, no `merge`/`schedule`/`epic-pre-done` triggers.
- **No replacement of the legacy checks** — the runtime gate runs *alongside* `verify-structure.sh`'s
  existing steps, not instead of them.
- **No new nx/CI wiring for the check fixtures** — that is `runtime-check-goldengates-ci`.

## Design

### Component 1 — `runtime/adapters/git/pre-commit-gate.mjs` (new · ring-2 git-host binding)

A git→runtime host binding. Ring-2 by placement, so `git diff --cached` awareness stays **out** of ring-1
(`run-watch` remains pure and host-agnostic; the ring-1 import-boundary guard keeps `engine/**` from
importing adapters, never the reverse).

- **Pure core:** `runPreCommitGate({ stagedFiles, registry, trigger }) → { exitCode, findings }`.
  - Calls `runWatch({ registry, trigger, changedScope: stagedFiles })` (ring-1, already tested).
  - `exitCode`: `0` if `findings.length === 0`, else `1`.
  - No git, no process, no I/O — unit-testable by injection.
- **CLI wrapper** (`main()`, guarded by the house `import.meta.url` idiom):
  1. Escape hatch: if `process.env.RUNTIME_GATE_SKIP` is set → print a notice, `exit 0`.
  2. Compute staged files: `git diff --cached --name-only --diff-filter=ACM` (added/copied/modified).
  3. Assemble inputs: `loadRegistry({ checksDir })` + `loadTriggers(triggersFile)` from
     `runtime/runtime.config.json`; pick the `commit` trigger.
  4. `const { exitCode, findings } = runPreCommitGate({ stagedFiles, registry, trigger })`.
  5. Print findings human-readably (`<check-id>  <file>  <detail>`), then `process.exit(exitCode)`.
  6. **Fail-closed:** any thrown error in the wrapper (registry load failure, git failure) → print the
     error → `process.exit(2)`. A broken enforcement gate must block, never silently pass.

### Component 2 — `scripts/verify-structure.sh` (edit)

Add one step near the end (after the existing legacy checks), before the final success line:

```sh
# Runtime enforcement gate (runtime-make-it-fire): content-ring commit-trigger checks on the staged set.
node runtime/adapters/git/pre-commit-gate.mjs || exit 1
```

`verify-structure.sh` is copied to `.git/hooks/pre-commit` by `package.json`'s `prepare` script, so this
auto-installs on the next `pnpm install` / `npm run prepare`. No new install mechanism.

### Component 3 — `runtime/adapters/git/test/pre-commit-gate.test.mjs` (new · `node --test`)

Exercises the **pure core** by injecting `stagedFiles` + a registry (real content-ring or a small fixture
registry) + the commit trigger:

- **bad staged file** in an invariant check's scope → `exitCode === 1`, `findings` non-empty.
- **clean staged file** in scope → `exitCode === 0`.
- **no in-scope staged files** → `exitCode === 0` (nothing runs — fast path).
- **escape hatch** (`RUNTIME_GATE_SKIP`) → the CLI short-circuits to `0` (tested at whatever seam keeps it
  hermetic — e.g. a `shouldSkip(env)` helper).

Covered by the existing `runtime/adapters/**/test/*.test.mjs` glob in `runtime/project.json`; runs under
`pnpm nx test runtime`.

## Data flow

```
git commit
  └─ .git/hooks/pre-commit  (= scripts/verify-structure.sh)
       ├─ [legacy structural checks + tools/check-typed-*/card-drift]   (unchanged)
       └─ node runtime/adapters/git/pre-commit-gate.mjs
            ├─ RUNTIME_GATE_SKIP? → exit 0
            ├─ git diff --cached --name-only --diff-filter=ACM   → stagedFiles
            ├─ loadRegistry(content) + loadTriggers → commit trigger
            ├─ runWatch({ registry, trigger:'commit', changedScope: stagedFiles })
            │     → selects commit-trigger checks (cheap invariant/gate) ∩ staged-scope + global invariants → findings[]
            └─ findings.length ? exit 1 (BLOCK) : exit 0 (allow)     [crash → exit 2 BLOCK]
```

## Error handling — fail-closed

| Situation | Exit | Effect |
|---|---|---|
| No findings | 0 | commit proceeds |
| ≥1 finding | 1 | commit blocked; findings printed (check id · file · detail) |
| Gate crash (registry/git error) | 2 | commit blocked (fail-closed) |
| `RUNTIME_GATE_SKIP=1` | 0 | gate skipped (deliberate bypass) |
| `git commit --no-verify` | — | whole hook bypassed (git-native) |

## Testing & validation (Tier-0 — no deploy)

- `node --test` on the pure `runPreCommitGate` core (+ the `shouldSkip` helper) — the regression net.
- `pnpm nx test runtime` stays green (the new test is inside the existing glob).
- **Manual smoke** (documented in the item's ship narrative): stage a file containing a known violation
  (e.g. a `.scan(` in a `services/**` file), attempt a commit, confirm the runtime gate **blocks** it and
  names the check; then stage a clean file and confirm the commit proceeds.

## Rollout

- Auto-installs via `package.json` `prepare` → `verify-structure.sh` copy. Refresh with `pnpm install`.
- Worktree commits already use `--no-verify` by repo convention, so the gate primarily guards main-line
  commits — sufficient for the proof, and consistent with existing behavior.
- Reversible: revert the one-line `verify-structure.sh` edit (and re-run `prepare`) to disable.

## Open questions

None — the trigger mechanism (extend the existing pre-commit), the slice goal (enforcement gate, no
capabilities), the gate location (ring-2 `adapters/git/`), and fail-closed-on-crash are all decided.
