# runtime — the Long-Horizon Engineering Runtime

The single library of **checks** — every consistency property the project asserts — with provenance, a
floor-curated lifecycle, a self-check, **a backward edge that mints checks from lessons**, and **a forward
edge that runs them on the right cadence and drives the work loop through a harness-agnostic capability
seam**. Three specs, one ring-1 core:

- **SPEC 1** — the check registry + atom (schemas + six helpers). Project- & harness-agnostic.
- **SPEC 2** — the backward edge (`mint` · `curate`): a lesson becomes a ratified check.
- **SPEC 3** — the forward edge (watch · intake · planner · gates · worker/orchestrator) + the **two
  seams** (harness + project) and their first binding, the **Claude Code adapter**.

> Specs: `docs/superpowers/specs/2026-07-01-runtime-spec-{1,2,3}-*.md` ·
> Vision: `docs/vision/long-horizon-engineering-runtime.md`

## Three rings, two seams

- **Ring 1 — `engine/`**: pure, project- & harness-agnostic. Depends outward on **nothing**. Schemas +
  helpers + the forward/backward edges + the capability *types*. A `runtime/engine/**` file importing an
  adapter, a skill, or shelling `claude` is a **seam #1 violation** — guarded by
  `engine/test/import-boundary.test.mjs`.
- **Ring 2 — `adapters/`** (seam #1, the harness seam): binds each capability to a host primitive. The
  first binding is `adapters/claude-code/` — `ask` degrades to `<<HARNESS-PAUSE>>` under headless, `fanOut`
  returns **summaries only** (a transcript never survives the boundary).
- **Ring 3 — `content/`** (seam #2, the project seam): the *project's* check library. Swap
  `runtime.config.json.checksDir` at another repo and ring-1 is unchanged. `starter/` is the
  project-agnostic pre-ratified pack that `runtime init` copies into a new project's ring 3.

The **only** project bindings are `runtime.config.json` (`{ checksDir, exclusionsRoot, triggersFile }`) and
the content ring — never a file inside ring 1.

## Layout

```
runtime/
  runtime.config.json     # the only project binding (checksDir / exclusionsRoot / triggersFile)
  cli.mjs                 # the on-ramp: `init` seeds the starter pack; `watch`/`next` delegate to ring-1
  package.json            # { "type": "module" } — scopes the subtree to ESM
  tsconfig.json           # typecheck-only .ts contract gate (noEmit + allowImportingTsExtensions + strict)
  project.json            # nx "runtime": test + typecheck (run-commands, forwardAllArgs:false)
  engine/                 # RING 1 — pure
    schema/               # check · item · finding · journal  (zod + z.infer types = single source of truth)
    capabilities/         # the SIX capability interfaces (types) — the harness contract (seam #1)
    lib/                  # helpers: loadRegistry/resolveEvaluator/runCheck/findByScope/advanceLifecycle/metaCheck
                          #   + journal (git-native step-ledger) + run-watch/scope-gate/run-gate/intake/plan-next
    loop/                 # worker (single-item spine) + orchestrator (epic spine) — call ONLY capabilities
    backward/             # SPEC 2, the backward edge (mint · curate). See engine/backward/README.md
    test/                 # node:test golden gates + wiring + import-boundary + starter-pack + cli
  adapters/claude-code/   # RING 2 — seam #1's first binding (six bindings + index assembly)
  content/checks/*.yaml   # RING 3 — Nestfolio's check library
  content/lessons/*.md    # RING 3 — lesson mirrors carrying `mints:` pointers (enforcement-as-memory)
  content/triggers.yaml   # RING 3 — the cadence map (which contexts fire on commit/merge/schedule/pre-done)
  starter/checks/*.yaml   # the 6 project-agnostic pre-ratified starter checks (`runtime init` copies these)
  eval/grade-check-scenario.mjs   # the CHECK-eval grader (the SPEC 2 → SPEC 3 minted-scenario handoff)
```

## The six helpers (SPEC 1 · `engine/lib/`)

| Helper | Contract |
|---|---|
| `loadRegistry({checksDir})` | `→ { checks, byId, errors }` — parse + zod-validate every `*.yaml`; malformed entries are **located** in `errors[]`, never crash. |
| `resolveEvaluator({check, judge?})` | `→ { kind, invoke }` — dispatch `evaluator.run` over `cmd`/`module`/`eslint`/`skill`. A `skill:` check needs the injected **`judge`** capability (seam #1); without it `invoke` throws `JudgeCapabilityUnavailable`. |
| `runCheck({check, context, judge?})` | `→ { findings, ran, skippedReason? }` — enforce the honesty rule (a check never runs in a context it did not declare); tag findings with `check.kind`. |
| `findByScope({registry, scope})` | `→ { checks, invariants }` — retrieval-scoped `checks` (pure glob-overlap) + **all** global invariants, always. |
| `advanceLifecycle({check, transition, floorApproval, successor})` | `→ { check, event }` — the floor-gated state machine; `floorApproval` is checked **first**. |
| `metaCheck({registry, env})` | `→ Finding[]` — the registry self-check: 3 integrity assertions + 2 rot-detectors + cheap-by-construction. Files findings; never advances state. |

## The forward edge (SPEC 3 · `engine/lib/` + `engine/loop/`)

| Piece | Contract |
|---|---|
| `runWatch({registry, trigger, changedScope, judge?})` | The cadence engine: select **activated ∩ affordable** checks (a trigger's `contexts` ∩ within its `cost_ceiling`) **+ all global invariants**, run them, complete every finding, and file a `gap` finding if a check throws (fail-open to *visible*, never silent). `content/triggers.yaml` maps commit/merge/schedule/epic-pre-done → contexts + cost ceiling. |
| `scopeGate({activeItem, diffPaths})` · `singleActive(items)` | The §9.2 invariant: the working-tree diff belongs to exactly one active item and every changed path is in its scope. Ships a **self-resolving CLI** (`scope-gate.mjs [--single-active]`) that reads `docs/backlog` itself — the starter checks invoke it verbatim. |
| `runGate({registry, boundary, item, judge?})` | The §10 boundary gate (`exit 0 ≠ pass`): run the `gate`-context checks + invariants for a boundary; **fail-closed** (any throw ⇒ a gap finding ⇒ `passed:false`). |
| `intake({finding, …})` · `shapeItems` · `selectRoute` | The §7 router: a finding becomes backlog item(s) via fold / join-theme / mint-aggregation / orphan / split / discard. Every emitted item carries `provenance.from_finding`. |
| `planNext(...)` · `computeImpact(...)` · `renderIndex(...)` | The §8 planner: active-resume else lowest-rank queued (epic ids redirect); impact (blast / epicPull / freshness) is **computed at read-time** — only `rank` is ever stored (derive-don't-store). |
| `runWorker({item, capabilities, registry})` | The §9.1 single-item spine: `begin → start-gate → execute → ship-gate → ask-to-ship`. The ship is **always** a floor `ask` — never auto. |
| `runOrchestrator({epic, members, capabilities, registry})` | The §9.3 epic spine: drive **core** members one-at-a-time via `execute` (inline, never `fanOut`), batch the expensive checks **once** at epic-pre-done, single merge `ask`. The pre-done batch is **sha-conditional** (`e2eIsFresh`): a moved HEAD re-runs it — a resume never replays a stale e2e. |

## The capability seam (`engine/capabilities/index.ts` + `engine/lib/journal.mjs`)

Ring-1 drives the loop through **six** injected capabilities — the harness contract. Ring-2 binds them:

| Capability | Shape | Claude Code binding |
|---|---|---|
| `execute(Task)` | `→ TaskResult` | the inline, visible worker (decision-bearing) |
| `fanOut(Task[])` | `→ Summary[]` | parallel subagents — **summaries only**, transcript discarded |
| `ask(Decision)` | `→ Choice` | AskUserQuestion; **degrades to `{value: PAUSE}`** headless |
| `onTrigger(spec, handler)` | `→ unsubscribe` | hooks / cron (in-process registry) |
| `runProcedure(name, args)` | `→ TaskResult` | the Skill tool (injected map) |
| `journal` | `Journal` | the git-native step-ledger below |

**The journal** (`journal.mjs`) is the idempotency spine: a git-native NDJSON step-ledger under
`.git`-common. `begin/step/record/read/awaiting/fulfil`; **resume-as-replay** (a `complete` step
short-circuits to its recorded value); `pure-rederive` steps are never ledgered; a torn tail line
self-heals on read. This is what makes a paused-then-resumed run pick up exactly where it left off.

## Starter pack + on-ramp (§13)

`starter/checks/` holds **6 project-agnostic, pre-ratified, cheap-by-construction** checks
(`registry-integrity`, `single-active`, `active-item-scope-gate`, `references-valid`, `index-fresh`,
`no-unsafe-casts`) that enforce from commit #1. `node runtime/cli.mjs init` copies them into a project's
content ring — the "works on a normal repo in minutes" wedge. `watch` / `next` delegate to the ring-1
helpers.

## §12 equivalence map — no lost value (discharge)

Every forward-edge and capability row of the vision maps to a built home (above): watch → `run-watch`,
intake → `intake`, planner → `plan-next`, gates → `run-gate`, the loop → `loop/`, the six capabilities →
`capabilities/` + `adapters/claude-code/`, the eval carry-forward → `eval/grade-check-scenario.mjs` +
`benchmark-backlog`'s live `defineSuite` seam. Two rows are **net-new `generalized`**: the `journal`
(git-native idempotency ledger) and the self-resolving `scope-gate`. The **operational surface (§14)** is
the one deliberate deferral — a filed follow-on of the `runtime-realization` program (fork Q2), to be
built once the seam is dogfooded by a real consumer.

## Run the gates

```bash
# All node:test suites (glob form is required — bare `node --test <dir>` does not discover on Node 24):
node --test runtime/engine/test/*.test.mjs runtime/engine/backward/test/*.test.mjs \
            runtime/engine/loop/test/*.test.mjs runtime/adapters/**/test/*.test.mjs \
            runtime/eval/test/*.test.mjs

# Or via nx:
pnpm nx test runtime        # every node:test suite
pnpm nx typecheck runtime   # tsc --noEmit: proves the frozen .ts contract compiles under `strict`
```

**Runtime requirement:** Node ≥24 (native `.ts` type-stripping — zero build step). zod v3, `yaml` v2.
No external service; the whole runtime is git-native files + small tested helpers. **Tier-0: never
deploys** — its validation *is* `node --test` + `tsc` + the `benchmark-backlog` corpus.
