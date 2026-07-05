# Runtime — user guide

A task-oriented companion to `runtime/README.md` (which is the reference). This explains **what the
runtime is, what actually runs today, and how you drive each piece by hand** — plus an honest map of what
is built-but-not-yet-wired.

> **Status in one sentence.** The runtime is a **tested, harness-agnostic library with CLIs** — all three
> specs (SPEC 1/2/3) are shipped and green (172 `node --test` cases + `tsc`). It is **not yet an automation**:
> nothing fires it on commit/merge/schedule, and today's real enforcement is still the old
> `.git/hooks/pre-commit → tools/check-*.mjs`. Making it *fire* is the deferred `runtime-operational-surface`
> follow-on (spec §14).

---

## 1. The mental model (five ideas)

1. **A check is the atom.** One consistency property the project asserts — e.g. "no DynamoDB `Scan`",
   "exactly one active backlog item". A check is a YAML file (`runtime/content/checks/<id>.yaml`) with an
   `evaluator` (how to test it), a `kind`, a `cost_tier`, `contexts`, a `scope`, and `provenance`.
2. **The forward edge runs checks and raises findings.** watch (on a cadence) → intake (a finding becomes
   backlog work) → planner (what's next) → gates (block a boundary) → the worker/orchestrator loop (drive
   the work). A finding never mutates state on its own; it becomes a *decision*.
3. **The backward edge grows/prunes checks from lessons.** `mint` (a lesson → a floor-ratified check) and
   `curate` (retire / supersede / keep). This is "enforcement-as-memory" — the moat.
4. **Three rings, two seams.** Ring 1 (`engine/`, pure) → seam #1 → Ring 2 (`adapters/`, a host binding)
   and Ring 1 → seam #2 → Ring 3 (`content/`, *this project's* checks). Swap the content ring and the
   engine is unchanged; swap the adapter and it runs on a different host.
5. **The journal makes it resumable.** Every effectful step is recorded in a git-native ledger; a
   paused-then-resumed run replays completed steps instead of re-doing them.

---

## 2. What actually runs today (copy-paste)

All commands run from the repo root. **Node ≥24 required** (native `.ts` type-stripping, zero build).

### Validate the library
```bash
pnpm nx test runtime        # 172 node:test cases across engine/backward/loop/adapters/eval
pnpm nx typecheck runtime   # tsc --noEmit over the .ts schema contract
```

### Run a single check by hand
```bash
# scope-gate: does the working-tree diff stay inside the single active item's scope?
node runtime/engine/lib/scope-gate.mjs
node runtime/engine/lib/scope-gate.mjs --single-active   # at most one active item + one active epic

# run one registry check in a declared context (exit 0 = clean, 1 = findings, 2 = usage error)
node runtime/engine/lib/run-check.mjs no-ddb-scan --context invariant

# load + zod-validate every check YAML (prints errors[] for malformed entries)
node runtime/engine/lib/load-registry.mjs --checks-dir runtime/content/checks
```

### Run the watch engine by hand (for one trigger)
```bash
# selects the checks a trigger activates (∩ affordable) + all global invariants, runs them, prints findings
node runtime/engine/lib/run-watch.mjs --on=commit
node runtime/engine/lib/run-watch.mjs --on=merge --changed='services/**,libs/**'
```
> ⚠️ `node runtime/cli.mjs watch` and `… next` are **currently no-ops** (they only `import()` the module and
> never trigger its CLI). Use the `engine/lib/*.mjs` entry-points above directly. `node runtime/cli.mjs init`
> **does** work — it seeds the 6 starter checks into a *new* repo's content ring (you don't need it here;
> Nestfolio's content ring is already populated).

### Drive a single backlog item through the loop (park/fulfil, resume-as-replay)
```bash
# drives the item until the first unfulfilled park; prints the parked Decision; exit 0 done / 3 paused / 1 failed / 2 usage
node runtime/adapters/claude-code/run-item.mjs <item-id>

# perform the parked work (or answer the parked floor ask), fulfil the key, and re-drive
node runtime/adapters/claude-code/run-item.mjs <item-id> --fulfil <key> --value '<json>'
```
> With no injected runner/interactive, `execute` and `ask` PARK a durable `awaiting` record in the
> git-native journal instead of stubbing "done" — see §5.

---

## 3. How to add a check (the everyday task)

1. Create `runtime/content/checks/<id>.yaml`. Minimal deterministic check:
   ```yaml
   id: no-foo-in-handlers
   property: "handlers never import the deprecated foo helper"
   kind: drift                       # drift | inconsistency | gap | staleness
   evaluator:
     type: deterministic
     run: "cmd:node tools/check-no-foo.mjs"   # scheme ∈ cmd | module | eslint | skill
     # fix: "node tools/check-no-foo.mjs --fix"   # optional autofix
   cost_tier: cheap                  # cheap | moderate | expensive
   contexts: [invariant, gate]       # subset of: gate | audit | invariant
   scope:
     paths: ["services/**/*.ts"]
   status: active
   provenance:
     minted_by: "manual"             # or a lesson/item id, or "starter-pack"
     ratified: "2026-07-02"
   ```
2. **Rule of thumb: `contexts:[invariant]` ⇒ `cost_tier: cheap`** (invariants run on every change; the
   meta-check enforces this).
3. Validate: `node runtime/engine/lib/load-registry.mjs --checks-dir runtime/content/checks` → `errors: []`.
4. A **judgment** check (LLM-graded) uses `type: judgment`, `run: "skill:audit-…"`, and **must** carry a
   `flake_contract` (`eval_scenario`, `allowed_flake_rate`, `calibration`). It only *resolves* in ring-1; it
   *runs* only when a host injects a `judge` capability.

Evaluator run-schemes: `cmd:<shell>` · `module:<file>#<export>` · `eslint:<ruleId>` · `skill:<skillName>`.

---

## 4. The backward edge (mint / curate a check from a lesson)

The learning loop lives in `runtime/engine/backward/`. Conceptually: a lesson (a `feedback_*` you don't want
to relearn) is drafted into a candidate check → **presented at the floor** (a human `ask`, never
self-ratified) → registered → an eval scenario is landed so the check is regression-guarded. `curate` later
retires or supersedes a check that has gone stale.

- It is **driven programmatically** through the same capability seam as the forward edge (injected `ask` +
  `journal`). The worked reference is `runtime/engine/backward/dogfood/materialize.mjs` and the hermetic
  proof `runtime/engine/backward/test/dogfood.test.mjs` (5 real lessons run draft→ratify→register→eval).
- There is **no polished `mint` CLI** yet — you invoke the procedures from a small script, or through the
  operational surface once it exists (§7).

---

## 5. The capability seam (how a host makes the loop *do* things)

Ring-1 never calls a tool directly. It calls **six capabilities** that a host binds:

| Capability | What it does | Claude Code binding (`runtime/adapters/claude-code/`) |
|---|---|---|
| `execute(task)` | run the inline, visible work | your worker runner (host-supplied) — **parks to the journal if none** |
| `fanOut(tasks)` | breadth work, parallel | subagents — **summaries only** |
| `ask(decision)` | a floor decision | AskUserQuestion — **parks to the journal if not injected** |
| `onTrigger(spec, fn)` | subscribe to a cadence | hooks / cron |
| `runProcedure(name, args)` | run a named procedure | the Skill tool |
| `journal` | the idempotency ledger | the git-native step-ledger |

**`execute`/`ask` now PARK — they no longer silently stub.** With no `runner`/`interactive` injected,
`execute` returns a `paused` `TaskResult` (a `Decision` keyed `execute:<task-id>`) instead of claiming
"done", and the journaled floor ask (`askStep`) parks the same way instead of just handing back an
in-memory `PAUSE` — both land a durable `awaiting` record in the git-native journal (§4.3/SPEC 3 §18).
`fanOut` (still claims "done" without a `runTask`), `runProcedure` (still fails "unknown procedure"
without a `procedures` map), and `onTrigger` (its registry still has nothing dispatching into it) are
unchanged. You drive the park/fulfil loop by hand, with the session itself as the executor:
```bash
# drives item until the first unfulfilled park; prints the parked Decision; exit 0 done / 3 paused / 1 failed / 2 usage
node runtime/adapters/claude-code/run-item.mjs <item-id>

# perform the parked work (or answer the parked floor ask), then fulfil the key and re-drive — replay
# short-circuits everything already complete and advances past the park you just answered
node runtime/adapters/claude-code/run-item.mjs <item-id> --fulfil <key> --value '<json>'
```
This IS the interactive binding now — there is no separate "wire a real host" step for `execute`/`ask`;
the session performing the parked work *is* the host. Wiring a real host for `fanOut`/`runProcedure`/
`onTrigger` is still §7.

**Fulfil by `key`, not by `decision.id`.** Always fulfil the pending record's `key` (as printed in
`pending[].key`) — never the bubbled `decision.id`. They coincide for a plain worker's execute-park
(both `execute:<id>`), but differ for an epic member park (journal key `member.<id>`, while the
adapter's decision id is still `execute:<id>`).

---

## 6. Testing & regression protection

- **Correctness (unit):** `pnpm nx test runtime` — 172 cases. This is your regression net for engine/schema/
  journal/backward/loop/adapter/grader logic.
- **Check fixtures (golden gates):** each migrated `tools/check-*.mjs` has a `*.test.mjs` that reads
  `runtime/eval/scenarios/fixtures/<check>/{good,bad}/*.ts` and asserts good→0 findings, bad→≥1. The generic
  grader is `runtime/eval/grade-check-scenario.mjs`.
- **Not yet built for the runtime:** a `baseline.json`-style **release comparison**, a **real-LLM behavioral
  eval of the loop**, and a **CLI-level e2e sandbox harness** — the three things `scripts/benchmark-backlog/`
  provides for the *backlog skills*. `defineSuite` (now live in benchmark-backlog) is the reusable seam a
  runtime harness would build on. See §7.

---

## 7. What's NOT wired yet — the path to "live"

The runtime is a library; three things stand between it and running automatically. All are tracked or
recommended as follow-on work, deliberately deferred so the seam gets shaped by a real consumer first:

1. **Fire it (the operational surface, spec §14 — `runtime-operational-surface`, parked).** A host that
   (a) subscribes the watch engine to real git hooks / CI / a schedule, (b) injects live `execute`/`ask`/
   `fanOut`/`runProcedure`, and (c) renders derived state (active item, ranked queue, open findings,
   floor-pending). Recommended first step: a *thin* live path — a `pre-commit` that runs the
   `invariant`-context checks via `run-watch.mjs` — to dogfood the seam before bulk work.
2. **Finish the check migration.** ~11 of ~34–39 enforced surfaces are in the content ring. Still bundled or
   unmigrated: backlog-lint rules 4/5/6/8/9/10/11, `check-no-appsync-literals`/`check-typed-fixtures`/
   `check-typed-subjects`, the pre-commit structural checks, and 4 `audit-*` skills.
3. **Reconcile the item schema.** ✅ **Done 2026-07-05** (`runtime-item-schema-reconciliation`): the schema
   binds the store's real keys (`done_when` identity, nullable `rank`, both `references` citation forms),
   passes project-local extensions through preserved, and `readItems()` validates every item on read
   (fail-closed, registry precedent) — `docs/backlog` IS a validated runtime item store.

Until then: keep using the old backlog skills (`/backlog-next`, `/backlog-add`, `/backlog-lint`, …) and the
old `pre-commit` gate. The runtime augments them; it does not replace them yet.

---

## 8. Command quick-reference

| Goal | Command |
|---|---|
| Run the library's tests | `pnpm nx test runtime` |
| Typecheck the `.ts` contract | `pnpm nx typecheck runtime` |
| Validate all check YAMLs | `node runtime/engine/lib/load-registry.mjs --checks-dir runtime/content/checks` |
| Run the scope gate | `node runtime/engine/lib/scope-gate.mjs [--single-active]` |
| Run the watch engine for a trigger | `node runtime/engine/lib/run-watch.mjs --on=commit` |
| Run one check in a context | `node runtime/engine/lib/run-check.mjs <id> --context <gate\|audit\|invariant>` |
| Drive a backlog item (park/fulfil loop) | `node runtime/adapters/claude-code/run-item.mjs <item-id> [--fulfil <key> --value '<json>']` |
| Seed a NEW repo's content ring | `node runtime/cli.mjs init` |
| Old backlog workflow (unchanged) | `/backlog-next`, `/backlog-add`, `/backlog-themes`, `/backlog-lint` |
