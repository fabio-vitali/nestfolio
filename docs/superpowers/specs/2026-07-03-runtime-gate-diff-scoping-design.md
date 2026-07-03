# Runtime gate: diff-scoped enforcement (make-it-fire T2 correction)

**Date:** 2026-07-03
**Workstream:** `runtime-make-it-fire` (epic `runtime-operationalization`)
**Supersedes the scope semantics of:** `docs/superpowers/specs/2026-07-03-runtime-make-it-fire-design.md` §§ "scoped to the staged files" (lines 25, 79–81)
**Depends on (shipped):** SPEC 3 forward edge — `run-watch.mjs`, `run-check.mjs`, `resolve-evaluator.mjs`, `find-by-scope.mjs`; the ring-2 gate `runtime/adapters/git/pre-commit-gate.mjs` (make-it-fire T1).

## 1. Context — what firing the gate exposed

Wiring the make-it-fire gate into the pre-commit hook and firing it against the **real** content ring surfaced that the gate blocks on **whole-tree debt**, not on the staged diff — 6 findings on *every* commit, even an empty staged set:

| check | class | findings |
|---|---|---|
| `no-agent-result-fallback` | source-drift (over-broad — flags `?? []` on DB reads) | 38 |
| `no-ddb-seed-in-integration` | source-drift (real debt) | 11 |
| `no-ddb-scan` (filter-on-key-attr) | source-drift (real debt) | 4 |
| `no-states-runtime-catch` | source-drift (1 known site) | 1 |
| `no-unsafe-casts` | source-drift | (fires on staged violations) |
| `backlog-id-matches-filename` | **crashes** (`gap` finding) | — |

Root cause, at two layers, both making `changedScope: stagedFiles` inert:

1. **Selection** — `find-by-scope.mjs` returns the `invariants` bucket **unconditionally** (every `invariant`-context check, ignoring scope). This is **intentional and frozen**: `find-by-scope.mjs:2` — *"Scoping narrows retrieval … never the enforcement floor (§6/§11)."*
2. **Attribution** — every `cmd:` check tool scans the **whole working tree** (via `tools/lib/text-scan.mjs` walking `services`/`libs`/`apps`), ignoring `changedScope` entirely. `eslint:` checks lint `check.scope.paths` (whole scope). So even the checks that *are* scope-selected report violations tree-wide.

The make-it-fire spec promised enforcement "scoped to the staged files" (line 25) and asserted "no in-scope staged files → exit 0" (line 81), but the implementation delivers neither. T1's unit test missed it because it injected a **fake `watch`** + a tiny fixture registry; the staged-scope illusion only holds against fixtures, not the real 6-invariant content ring.

## 2. Goal & non-goals

**Goal.** The pre-commit gate blocks only on violations **attributable to the staged files**, so pre-existing whole-tree debt does not block unrelated commits — realizing the make-it-fire spec's stated intent, without weakening the frozen invariant floor.

**Non-goals.**
- Remediating the pre-existing source debt (filed as separate backlog items).
- Changing which checks *run* (selection). The invariant enforcement floor is frozen.
- Capability injection (`execute`/`ask`/`fanOut`/`runProcedure`) — out of scope by construction, as in make-it-fire.
- Diff-scoping the `audit`/`merge` triggers — those *want* whole-tree scans; this design touches only how a scoped caller (the gate) passes `changedScope`.

## 3. Governing principle — attribution, not selection

Diff-scoping narrows **what a check scans** (attribution), never **which checks run** (selection). This preserves the frozen §6/§11 floor and yields a clean two-class split:

- **Source-drift checks** — scan source files for a bad pattern. **Diff-scoped:** report only violations in staged files. (`no-unsafe-casts`, `no-ddb-scan`, `no-ddb-seed-in-integration`, `no-states-runtime-catch`, `no-agent-result-fallback`, `module-boundaries`.)
- **Repo-integrity checks** — assert a whole-collection invariant that must hold regardless of what you staged. **Whole-scope, unchanged.** (`backlog-id-matches-filename`, `service-card-fresh`.) A `module:` (zero-arg) evaluator cannot attribute a finding to a file, and these checks *should* block on any collection breakage — so leaving them whole-scope is correct, not a gap.

## 4. Architecture — thread `changedScope` into each evaluator's native channel

`changedScope` already enters `runWatch`. Thread it one more hop so the evaluator can scope its own scan:

```
pre-commit-gate.mjs (ring-2)
  └─ runWatch({ registry, trigger, changedScope: stagedFiles })
       └─ runCheck({ check, context, judge, changedScope })          // NEW param, passed through
            └─ resolveEvaluator({ check, judge, changedScope })      // NEW param
                 └─ invoke()   // distributes changedScope per evaluator type
```

Signature changes (ring-1):
- `runCheck({ check, context, judge, changedScope })` — forwards `changedScope` unchanged.
- `resolveEvaluator({ check, judge, changedScope })` — distributes it.

Per-type distribution inside `resolveEvaluator`:

- **`cmd:`** — when `changedScope` is present, set `RUNTIME_STAGED_PATHS` (newline-joined) in the spawn's `env`. The shared `tools/lib/text-scan.mjs` gains a **staged mode**: when `RUNTIME_STAGED_PATHS` is set, `walkFiles` yields only those paths that pass the tool's own `includeUnder`/`ext`/`excludeTest` filters (instead of walking the tree). All five dogfood tools inherit this for free — no per-tool edits. Tools that do **not** use `text-scan` (`check-service-card-drift.mjs`) simply ignore the env and stay whole-scope, which is correct for the repo-integrity class.
- **`eslint:`** — when `changedScope` is present, lint `changedScope` filtered to files matching the check's scope (and the tool's ext), instead of `check.scope.paths`. Empty filtered list → no files → `[]`.
- **`module:`** — no attribution channel (zero-arg core). Unchanged; stays whole-scope (repo-integrity class).

When `changedScope` is **absent** (the `audit`/`merge`/CLI path), every evaluator behaves exactly as today — whole-tree. This is a pure additive capability; existing callers are unaffected.

## 5. The `backlog-id-matches-filename` crash (fix, in-scope)

A fired enforcement check must never emit a `gap`. The check is **mis-bound**: its evaluator is `module:…/rules.mjs#ruleIdMatchesFilename`, but `ruleIdMatchesFilename(file)` takes a single backlog file, while the runtime's `module:` convention calls the export **zero-arg** (`resolve-evaluator.mjs`: "zero-arg core → violation array") → `file` is `undefined` → `undefined.filename` throws.

**Fix.** Add a runtime-owned **zero-arg adapter** (e.g. `runtime/content/checks/lib/backlog-id-core.mjs#backlogIdViolations`) that loads `docs/backlog/*.md`, parses frontmatter, maps the existing `ruleIdMatchesFilename` over each file, and returns the flattened violation array. Repoint the check's `module:` ref at the adapter. This respects the zero-arg convention, keeps the backlog-lint rule reusable, and establishes the reusable pattern *"wrap a per-item lint rule in a zero-arg core for the runtime `module:` convention."* After the fix, the check enforces the whole (small, always-clean) backlog dir — the correct repo-integrity behavior.

## 6. Wire + smoke (the original T2, now safe)

Insert the gate into `scripts/verify-structure.sh` immediately after `WARNINGS=0`, **before** the services-only early-exit (so it runs on every commit, not just service commits):

```sh
# Runtime enforcement gate (runtime-make-it-fire) — content-ring commit-trigger checks over the staged
# set, via the ring-1 watch engine. Runs on EVERY commit, so it MUST precede the services-only early-exit
# below. Fail-closed: a non-zero exit (findings=1 or crash=2) blocks the commit.
if ! node runtime/adapters/git/pre-commit-gate.mjs; then
  exit 1
fi
```

Reinstall via `pnpm run prepare` (copies the script to `.git/hooks/pre-commit`). Smoke:
- **red** — a staged `libs/_smoke/src/bad.ts` containing `(0 as any)` → the `no-unsafe-casts` `✖` line + `exit 1`. (Note: the path needs the `/src/` segment — the check scope is `libs/**/src/**/*.ts` and the tool skips non-`/src/` paths; the make-it-fire plan's `libs/_smoke/bad.ts` was wrong on both.)
- **green** — a clean staged set (or a staged file outside every check's scope) → no `✖` + `exit 0`.

## 7. Error handling & fail-closed (unchanged from T1)

Exit codes stay `0` clean / `1` findings / `2` crash-or-no-trigger; `RUNTIME_GATE_SKIP=1` bypass preserved. Diff-scoping only reduces the *findings* set on clean commits; the fail-closed envelope is untouched.

## 8. Testing

- **Unit — `changedScope` threading (per evaluator type):**
  - `cmd:` — a fixture check whose tool scans a temp file; assert a staged-hit yields the finding and a staged-miss (violation exists in the tree but not in `changedScope`) yields `[]`.
  - `eslint:` — assert the eslint invocation receives the staged∩scope file list, and an empty intersection short-circuits to `[]` without spawning.
  - `module:` — assert it ignores `changedScope` (whole-scope) and still returns violations.
- **Unit — `text-scan.mjs` staged mode:** `RUNTIME_STAGED_PATHS` set → `walkFiles` yields only staged paths passing the filters; unset → whole-tree walk unchanged.
- **Unit — backlog-id adapter:** clean dir → `[]`; an id/filename mismatch fixture → one violation; called zero-arg (no throw).
- **Integration — the gate over the real registry:** a clean staged set → `exit 0` (the make-it-fire green path, now achievable); a staged violation → `exit 1`.
- **Smoke** (§6) both ways; **`pnpm nx test runtime`** stays green.

## 9. Debt filed (not fixed here)

Once diff-scoped, these no longer block, but they are real findings the runtime surfaced — filed via `backlog-add`, split for atomicity:
- **Source debt to remediate:** `no-ddb-seed-in-integration` (11), `no-ddb-scan` filter-on-key-attr (4), `no-states-runtime-catch` (1).
- **Check-quality:** `no-agent-result-fallback` is **over-broad** — its regex flags every `?? {}`/`?? []` in advisory `src`, not only AgentCore/orchestrator-result fallbacks; needs narrowing to the check's stated property.

## 10. Out of scope

- Remediating the source debt in §9.
- Narrowing `no-agent-result-fallback` (filed).
- Migrating `check-service-card-drift.mjs` / `check-read-model-drift.mjs` to `text-scan` staged mode (they are repo-integrity / audit-only; whole-scope is correct for them today).
- Any selection-layer change (the frozen §6/§11 invariant floor).
- Capability injection.

## 11. Reusable takeaway

`resolveEvaluator({ check, changedScope })` becomes a first-class engine capability: any runtime consumer gets diff-scoped enforcement, governed by the **source-drift (diff-scoped) vs repo-integrity (whole-scope)** split, with the frozen invariant floor intact. The `RUNTIME_STAGED_PATHS` + shared-scanner convention and the zero-arg lint-rule adapter are both liftable patterns.
