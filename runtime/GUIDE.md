# Runtime — user guide

A task-oriented companion to `runtime/README.md` (which is the reference). This explains **what the
runtime is, how it runs the project today, and how you drive each piece by hand**.

> **Status in one sentence.** The runtime is the project's **live enforcement and work-driver**: the
> pre-commit hook fires the diff-scoped watch engine on every commit, a weekly CI cadence runs the
> audit tier, and the backlog skills (`/backlog-next`, `/backlog-next-epic`, `/backlog-add`,
> `/backlog-lint`) drive their execute / gate / ship phases through the engine loop via the
> `run-*.mjs` drivers. The legacy prose work-driver was retired 2026-07-09
> (`runtime-legacy-retirement`) after a final full parity sweep — the runtime paths are the only
> paths.

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
   engine is unchanged; swap the adapter and it runs on a different host. Rings 1+2 are
   **self-contained** — no production import escapes `runtime/` (guarded by
   `engine/test/import-boundary.test.mjs`), so the subtree ships alone into a sandbox or a fresh repo.
5. **The journal makes it resumable.** Every effectful step is recorded in a git-native ledger; a
   paused-then-resumed run replays completed steps instead of re-doing them. `execute`/`ask` **park**
   a durable `awaiting` record when no runner/interactive is injected — the park/fulfil loop below.

---

## 2. How it runs the project (the live wiring)

- **Every commit**: `.git/hooks/pre-commit` → `runtime/adapters/git/pre-commit-gate.mjs` — the
  commit-trigger checks over the staged set via the ring-1 watch engine, diff-scoped, fail-closed.
- **Weekly (CI)**: `.github/workflows/runtime-audit.yml` runs the `schedule` trigger (audit-tier
  judgment checks, Mon 06:00 UTC per `content/triggers.yaml`).
- **Per workstream**: the backlog skills drive the engine loop — see §5. The worker owns execute,
  the sha-conditional pre-ship deploy-gate batch, and the ship floor (never auto-ships); the epic
  orchestrator owns the member loop and the batched epic-pre-done checks. Git workflow (worktrees,
  preflight/postflight, PR/merge) stays with the skills' host prose.
- **At ship**: the backward-edge ritual — `runtime/adapters/git/ship-recheck.mjs` adjudicates the
  branch delta (`ship:<id>:gate-clean`), `run-backward.mjs` handles curate-at-the-floor and the
  mint consideration; postflight enforces both records.

## 3. What you can run by hand (copy-paste)

All commands run from the repo root. **Node ≥24 required** (native `.ts` type-stripping, zero build).

### Validate the library
```bash
pnpm nx test runtime        # 422 node:test cases across engine/backward/loop/adapters/content/eval
pnpm nx typecheck runtime   # tsc --noEmit over the .ts schema contract
```

### Run a single check / the watch engine
```bash
node runtime/engine/lib/scope-gate.mjs [--single-active]      # the §9.2 diff-inside-scope invariant
node runtime/engine/lib/run-check.mjs no-ddb-scan --context invariant
node runtime/engine/lib/load-registry.mjs --checks-dir runtime/content/checks
node runtime/engine/lib/run-watch.mjs --on=commit --changed='docs/backlog/*.md'   # the backlog gate
```
> ⚠️ `node runtime/cli.mjs watch|next` are **no-ops** (they `import()` a module whose main-guard never
> fires from another entry-point). Use the `engine/lib/*.mjs` entry-points directly. `runtime init`
> **does** work — it seeds the 6 starter checks into a *new* repo's content ring.

### Drive work through the loop (park/fulfil, resume-as-replay)
```bash
node runtime/adapters/claude-code/run-next.mjs <item-id>      # the /backlog-next §5 drive
node runtime/adapters/claude-code/run-epic.mjs <epic-id>      # the /backlog-next-epic member loop
node runtime/adapters/claude-code/run-item.mjs <item-id>      # bare worker spine (no lane/deploy-gate)
node runtime/adapters/claude-code/run-intake.mjs --finding <finding.json>   # /backlog-add routing
node runtime/adapters/claude-code/run-view.mjs [exec <op>]    # the operator surface (view + executor)
```
Every driver runs until the first unfulfilled park, prints the parked Decision, and exits
`0 done / 3 paused / 1 failed / 2 usage`. Perform the parked work (or answer the parked floor ask),
then re-invoke with `--fulfil <key> --value '<json>'` — replay short-circuits completed steps.

**Fulfil by `key`, not by `decision.id`.** Always fulfil the pending record's `key` (as printed in
`pending[].key`). They coincide for a plain worker's execute-park (both `execute:<id>`), but differ
for an epic member park (journal key `member.<id>`); a unique pending `decision.id` is tolerated —
`fulfil-key.mjs` translates it to its step key.

---

## 4. How to add a check (the everyday task)

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
   `flake_contract` (`eval_scenario`, `allowed_flake_rate`, `calibration`). It runs when a driver
   injects the judge — every `run-*.mjs` main composes `makeDriverCapabilities()`, which binds the 4
   `audit-*` skills as headless read-only procedures (`RUNTIME_AUDIT_MODEL`, default Opus).

Evaluator run-schemes: `cmd:<shell>` · `module:<file>#<export>` · `eslint:<ruleId>` · `skill:<skillName>`.

---

## 5. The backward edge (mint / curate a check from a lesson)

The learning loop lives in `runtime/engine/backward/`, driven by the `run-backward.mjs` CLI:

```bash
# mint: a lesson dossier + proposal JSON → floor-parked candidate → ratify via --fulfil
node runtime/adapters/claude-code/run-backward.mjs mint --item <id> --lesson <dossier.md> --proposal <proposal.json>

# curate at the floor — the ONLY sanctioned path past a failing guard (retire / supersede / keep)
node runtime/adapters/claude-code/run-backward.mjs curate --check <check-id> --trigger ship-gate [--reason '…']

# record the ship-time mint consideration ("nothing mechanizable" is a legal answer; silence is not)
node runtime/adapters/claude-code/run-backward.mjs consider --item <id> (--minted <check-id> | --none) --reason '…'
```

Every floor decision parks (exit 3) with the full candidate/guard YAML in the Decision — surface it
via AskUserQuestion, never self-ratify. The worked programmatic reference is
`runtime/engine/backward/dogfood/materialize.mjs` + the hermetic proof
`runtime/engine/backward/test/dogfood.test.mjs`.

---

## 6. The capability seam (how the host binds the loop)

Ring-1 never calls a tool directly. It calls **six capabilities** that ring-2 binds:

| Capability | What it does | Claude Code binding (`runtime/adapters/claude-code/`) |
|---|---|---|
| `execute(task)` | run the inline, visible work | **parks to the journal** — the session performing the work IS the host |
| `fanOut(tasks)` | breadth work, parallel | subagents — **summaries only** |
| `ask(decision)` | a floor decision | AskUserQuestion — **parks to the journal** headless |
| `onTrigger(spec, fn)` | subscribe to a cadence | the live cadence is bound outside-in: git hook + CI cron invoke the watch engine |
| `runProcedure(name, args)` | run a named procedure | `makeDriverCapabilities()` → the 4 `audit-*` skills headless (the judge) |
| `journal` | the idempotency ledger | the git-native step-ledger |

**Driver mains MUST compose `makeDriverCapabilities()`** (not bare `makeClaudeCodeCapabilities({})`)
so judgment checks resolve at the start / pre-ship / ship gates — enforced by DC3 in
`adapters/claude-code/test/driver-capabilities.test.mjs` (discovery-total over `run-*.mjs`).
Nested headless sessions go through `headless-run.mjs` — ring-2's own spawn binding (self-containment:
nothing in `runtime/` imports repo tooling outside the subtree).

---

## 7. Testing & regression protection

- **Correctness (unit):** `pnpm nx test runtime` — 422 cases. The regression net for engine/schema/
  journal/backward/loop/adapter/content/grader logic.
- **Check fixtures (golden gates):** each migrated check has fixtures under
  `runtime/eval/scenarios/fixtures/<check>/{good,bad}/` asserting good→0 findings, bad→≥1. The generic
  grader is `runtime/eval/grade-check-scenario.mjs`.
- **Backlog-gate regression suite:** `scripts/backlog-regression/` (the deterministic differential,
  runtime-only since the comparator retired) asserts the runtime commit gate catches every
  backlog-lint violation class (r1–r11 + element-shape) over per-rule good/bad fixture stores.
- **Import boundaries:** `engine/test/import-boundary.test.mjs` — ring-1 purity (seam #1) + rings-1/2
  self-containment (no import escapes `runtime/`).

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
| Drive a workstream | `node runtime/adapters/claude-code/run-next.mjs <item-id>` |
| Drive an epic's member loop | `node runtime/adapters/claude-code/run-epic.mjs <epic-id>` |
| File a finding (intake routing) | `node runtime/adapters/claude-code/run-intake.mjs --finding <json>` |
| Operator surface (view / exec) | `node runtime/adapters/claude-code/run-view.mjs [exec <op>]` |
| Mint / curate / consider | `node runtime/adapters/claude-code/run-backward.mjs <mint\|curate\|consider> …` |
| Ship recheck (branch delta) | `node runtime/adapters/git/ship-recheck.mjs --item <id>` |
| Seed a NEW repo's content ring | `node runtime/cli.mjs init` |
