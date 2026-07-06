# Runtime check migration — deterministic tier (design)

**Date:** 2026-07-06
**Backlog item:** `runtime-check-migration-completion` (epic `runtime-operationalization`, P4, core)
**Type:** refactor / migration
**Status:** design approved; awaiting spec review → writing-plans

## 1. Goal

Complete the SPEC 1 §12 / SPEC 3 §12 "no-lost-value map" for the **deterministic** enforcement surfaces:
move the remaining legacy checks into `runtime/content/checks/` CheckEntry YAML so each one **runs on the
live commit gate**. "Migrated" means *runs on a real cadence, demonstrated not asserted* — not "has a YAML
entry."

The full P4 migration was decomposed on 2026-07-06 (Decision D2/D3/D4 in the backlog file):

- **This workstream — deterministic tier:** 3 `cmd:` checks + a `service-structure` `cmd:` check + all
  remaining deterministic backlog-lint rules as `module:` checks. All ride the existing commit cadence; **no
  new engine, judge, or dispatcher code.**
- **Split out — `runtime-check-migration-judgment-tier`** (core member): the 4 audit-* skills, backlog-lint
  `captured-audit`, the 2 judgment gaps, the live judge binding, an expensive-check cadence dispatcher, and
  ≥1 real audit routed through intake.
- **Split out — `runtime-check-exclusions-content-ring`** (core member): relocating the 8
  `tools/*-exclusions.json` sidecars + wiring `exclusionsRoot`.

## 2. Current state (grounded)

**CheckEntry schema** — `runtime/engine/schema/check.schema.ts` (`.strict()`, frozen by runtime-realization):
fields `id, property, kind, evaluator, cost_tier, contexts, scope, status, flake_contract?, provenance`.
`evaluator.run = "<scheme>:<target>"`; `RUN_SCHEMES = ['cmd','module','eslint','skill']` (`:16`).
`cost_tier ∈ {cheap,moderate,expensive}`; `contexts ⊆ {gate,audit,invariant}` (nonempty). **Cadence is NOT a
field** — it is *derived* from `cost_tier` + `contexts` (SPEC 1 §12 note). `judgment ⇒ flake_contract`
(`:82-88`) — irrelevant here (this tier is all `deterministic`).

**The one live cadence — the commit gate:**
`.git/hooks/pre-commit` ≡ `scripts/verify-structure.sh` (byte-identical copy) → line 18
`node runtime/adapters/git/pre-commit-gate.mjs` → `run-watch.mjs runWatch()` → `run-check.mjs runCheck()` →
`resolve-evaluator.mjs resolveEvaluator()`. `selectChecks` (`run-watch.mjs:15-22`) picks active checks whose
`contexts ∩ trigger.contexts ≠ ∅` **and** `cost_tier ≤ cost_ceiling`. The `commit` trigger
(`runtime/content/triggers.yaml`) = `contexts:[invariant,gate]`, `cost_ceiling: cheap`. A throwing evaluator
becomes a `gap` finding = **fail-closed** (`run-watch.mjs:30-34`).

**Scheme executors (all real for this tier):**
- `cmd:<shell>` — `spawnSync(target,{shell:true})`, staged∩scope passed via `RUNTIME_STAGED_PATHS` env;
  exit 0 = pass, nonzero = one finding (`resolve-evaluator.mjs:41-50`).
- `module:<file>#<export>` — dynamic-import, call the **zero-arg** export, expect a violations array
  (`resolve-evaluator.mjs:51-62`). **Zero-arg = the check reads whatever it wants** (e.g. the whole
  `docs/backlog/` dir), so cross-file backlog rules work with no staged-file dependency.

**14 live CheckEntries today** — schemes `cmd`×9, `module`×3, `eslint`×1, `skill`×1. The proven templates:
- `cmd:` template — `no-ddb-scan.yaml` (→ `cmd:node tools/check-no-ddb-scan.mjs`), 8 others identical.
- `module:` core-wrapper template — `backlog-id-matches-filename.yaml` (rule 1) →
  `module:runtime/content/lib/backlog-id-core.mjs#backlogIdViolations`, which imports `loadBacklogFiles` +
  `ruleIdMatchesFilename` from `.claude/skills/backlog-lint/lib/rules.mjs`, runs the rule over all backlog
  files, and maps violations to the runtime finding shape `{ detail, scope, evidence }`. Two more precedents:
  `item-store-core.mjs`, `plan-views-core.mjs`.

**Registry integrity:** `registry-integrity.yaml` → `cmd:node runtime/engine/lib/meta-check.mjs` (loads +
validates the whole registry; dup-id / bad-scheme = load error, fail-closed at commit).

## 3. Scope

### In scope

**3.1 — Three `cmd:` checks.** New CheckEntries mirroring `no-ddb-scan.yaml`:

| id | run | notes |
|---|---|---|
| `no-appsync-literals` | `cmd:node tools/check-no-appsync-literals.mjs` | no sidecar (inline exclusions); `--root` defaults to cwd |
| `typed-fixtures` | `cmd:node tools/check-typed-fixtures.mjs` | uses `tools/typed-fixture-registered-events.json` (an **allowlist**, not exclusions — stays) |
| `typed-subjects` | `cmd:node tools/check-typed-subjects.mjs` | `scope.exclusions: tools/typed-subject-exclusions.json` (relocated later by the exclusions item) |

Each: `evaluator.type: deterministic`, `cost_tier: cheap`, `contexts: [invariant, gate]`, `scope.paths`
matching the tool's target globs, `status: active`, `provenance.minted_by: runtime-check-migration-completion`.
All three tools already exit `0`/`1` and accept `--root` (tests pass a tmpdir), so they drop in unchanged.

**3.2 — `service-structure` `cmd:` check (recursion-safe extraction).**
`verify-structure.sh` mixes: (a) the runtime-gate invocation (line 18), (b) structural checks #1-#7, and
(c) delegated checks #8-#10 (typed-subjects/typed-fixtures/card-drift). A CheckEntry bound to
`cmd:scripts/verify-structure.sh` would **recurse** (the gate would run a script that re-invokes the gate).

Design: extract checks **#1-#7** into a new gate-free **`scripts/check-service-structure.sh`** (no gate call,
no #8-#10 delegation; honors `RUNTIME_STAGED_PATHS` to scope to changed services, falling back to
`git diff --cached`). Bind a `service-structure` CheckEntry to `cmd:bash scripts/check-service-structure.sh`.
Refactor `verify-structure.sh` (and re-copy `.git/hooks/pre-commit`) to **call** the extracted script for its
#1-#7 block (single source of the structural logic — no divergent copy). Checks #8-#10 stay in
`verify-structure.sh` (typed-subjects/typed-fixtures migrate as their own `cmd:` entries in 3.1; card-drift is
already `service-card-fresh.yaml`).

- **#6 (card exists) and #7 (nx blast-radius)** are WARN-only in the legacy script. A gate check is
  pass/fail. Decision: the extracted `service-structure` check enforces **#1-#5 (the hard-fail structural
  invariants)** as findings; **#6/#7 stay WARN-only inside `verify-structure.sh`** (not migrated as gate
  findings — WARN semantics don't map to a blocking finding, and card-existence is already partly covered by
  `service-card-fresh`). This keeps the migrated check faithful to "what actually blocks a commit today."

**3.3 — Backlog-lint deterministic rules → `module:` core-wrappers.**
Mirror the rule-1 pattern. **Delegate, never fork** — import the rule fns from
`.claude/skills/backlog-lint/lib/rules.mjs` (single-parser discipline established by
`lint-library-total-and-located`; a second copy would reintroduce the divergence bug that workstream fixed).

Create **one** `runtime/content/lib/backlog-rules-core.mjs` exposing a small set of arity adapters + one
zero-arg named export per rule (DRY, liftable). Adapters over a shared `loadAll()` (`{ files, repoRoot,
indexPath }`) and a shared `toFindings(violations)` (mirrors `backlog-id-core.mjs`'s `{detail,scope,evidence}`
mapping):

- `perFile(rule)` → `() => toFindings(files.flatMap(rule))`
- `perFileWithAll(rule)` → `() => toFindings(files.flatMap(f => rule(f, files)))`
- `perFileWithRoot(rule)` → `() => toFindings(files.flatMap(f => rule(f, repoRoot)))`
- `wholeSet(rule)` → `() => toFindings(rule(files))`

Rule → adapter → export (rule 1 already migrated; **migrate all remaining deterministic rules** per Decision
D4):

| rule | rules.mjs export | arity | adapter |
|---|---|---|---|
| precondition | `ruleFrontmatterParseable(file)` | per-file | `perFile` |
| 2 | `ruleSingleActive(files)` | whole-set | `wholeSet` |
| 3 | `ruleReferencesValid(file, repoRoot)` | per-file+root | `perFileWithRoot` |
| 4 | `ruleActiveOutOfScope(file)` | per-file | `perFile` |
| 4a | `ruleActiveEpicFields(file)` | per-file | `perFile` |
| 5 | `ruleShippedValidationGate(file)` | per-file | `perFile` |
| 6 | `ruleQueuedRanks(files)` | whole-set | `wholeSet` |
| 7 | `ruleIndexMatches(...)` | whole-set (+index) | `wholeSet` (verify signature; supply `indexPath`) |
| 8 | `rulePromotionTriggerGated(file)` | per-file | `perFile` |
| 9 | `ruleEpicClosure(file, files)` | per-file+all | `perFileWithAll` |
| 10 | `ruleEpicPointerIntegrity(file, files)` | per-file+all | `perFileWithAll` |
| 11 | `ruleSingleActiveEpic(files)` | whole-set | `wholeSet` |

One CheckEntry per rule (`backlog-rule-<name>.yaml`), all: `evaluator.type: deterministic`,
`run: module:runtime/content/lib/backlog-rules-core.mjs#rule<N>Violations`, `cost_tier: cheap`,
`contexts: [invariant, gate]`, `scope.paths: [docs/backlog/*.md]`, `kind` per rule
(inconsistency/gap/staleness), `status: active`, `provenance.minted_by: runtime-check-migration-completion`,
`provenance.lesson: docs/superpowers/specs/2026-05-07-backlog-redesign-design.md`.

### Out of scope

- The **judgment tier** — `runtime-check-migration-judgment-tier`.
- **Exclusions relocation** — `runtime-check-exclusions-content-ring`.
- **Legacy retirement** (removing migrated checks from the hook / `verify-structure.sh`) — P6, user-triggered.
  This workstream keeps legacy running alongside (belt-and-suspenders double-coverage is intended).
- **CI golden gates** — `runtime-check-goldengates-ci`.
- Any change to the frozen CheckEntry schema / engine (`runtime/engine/**`).

## 4. Cadence — why no new infrastructure

Every check in this tier is `deterministic`, `cost_tier: cheap`, `contexts: [invariant, gate]`. The `commit`
trigger's `cost_ceiling` is `cheap` and `contexts` is `[invariant, gate]`, so `selectChecks` includes them on
every commit — exactly as rule 1 and the 8 `cmd:` checks already run. `module:` checks are zero-arg, so
cross-file backlog rules (6, 9, 10, 11) read the whole `docs/backlog/` dir directly; no staged-file scoping is
needed. **This is why the deterministic tier needs zero new dispatcher/judge code — the split isolates all
that into the judgment tier.**

## 5. Validation & acceptance (demonstrated, not asserted)

1. **Each new check fires on the commit gate.** For each: stage a *violating* fixture and show
   `pre-commit-gate.mjs` exits non-zero with the finding; stage a clean tree and show it passes. Capture the
   gate output as evidence in the `validation_gate`.
2. **`registry-integrity` green** — `node runtime/engine/lib/meta-check.mjs` loads the enlarged registry with
   no dup-id / bad-scheme / missing-module errors.
3. **Source-of-truth suites green** — `.claude/skills/backlog-lint` node:test suites (`rules.mjs` unchanged) +
   the 3 tool `*.test.mjs` (`check-no-appsync-literals`/`-typed-fixtures`/`-typed-subjects`) + any
   `check-service-structure` test.
4. **nx `test,lint` on affected green** (`tools/affected-projects.mjs --base=origin/main`).
5. **No behavior regression in the legacy hook** — `verify-structure.sh` still passes end-to-end after the
   #1-#7 extraction (re-copied hook).

## 6. Implementation notes to confirm during TDD

- **`ruleIndexMatches` signature** — confirm exact params (files + index content/path) and wire `indexPath =
  docs/BACKLOG.md` in `loadAll()`.
- **Does `selectChecks` gate `module:` checks by `scope ∩ staged`?** Observe rule 1 (`scope.paths:
  [docs/backlog/*.md]`) on a code-only commit: if it runs regardless, rules 2-11 run every commit (cheap,
  fine); if it's scope-gated, they run only on backlog-touching commits (cleaner). Either is acceptable —
  match rule 1's observed behavior. Note the rule-7 consequence: if the index is stale, the gate blocks the
  next commit until `lint --fix` runs (correct, but flag it).
- **`backlog-id-core.mjs` finding mapping** — reuse its exact `{detail, scope, evidence}` shape in
  `toFindings` so all backlog checks emit uniform findings.
- **`RUNTIME_STAGED_PATHS` contract** — confirm the env format the gate passes to `cmd:` checks and mirror it
  in `check-service-structure.sh`'s changed-service computation.

## 7. Risks

- **Recursion** (service-structure) — mitigated by the gate-free extraction (§3.2); the extracted script must
  never invoke `pre-commit-gate.mjs`.
- **Double-coverage** — typed-subjects/typed-fixtures/card-drift + service structural checks now run both via
  the runtime gate and the legacy hook. Intended (belt-and-suspenders) until P6 retirement.
- **Delegate-not-fork** — the backlog cores must import `rules.mjs`; a copied rule would silently diverge from
  the lint gate (the exact bug `lint-library-total-and-located` fixed).
- **Commit-time cost** — 11 new zero-arg backlog `module:` checks run per commit. Each is cheap (in-memory
  rule over parsed frontmatter); the slow `lint --fix` git-log fan-out (F-29) is NOT invoked by these rules.
