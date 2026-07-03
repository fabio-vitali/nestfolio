# Runtime SPEC 3 — the forward edge & capability seams (design)

**Date:** 2026-07-01
**Status:** design — approved-in-vision; ring-1 forward edge + seam #1 (the harness). Consumes SPEC 1's frozen schema verbatim.
**Workstream:** `runtime-realization` — SPEC 3 of the moat-first three-spec set (forward edge, capability interfaces, journal, equivalence map)
**Inputs:** VISION `docs/vision/long-horizon-engineering-runtime.md` (§8 forward edge, §10 eval harness, §11 capability interfaces + journal, §12 three rings/two seams, §13.1/§13.6/§13.7/§13.8 laws); TARGET-ARCH `docs/superpowers/specs/2026-06-30-long-horizon-runtime-target-architecture-design.md` (§4 capabilities, §6 forward edge, §10 eval, §11 equivalence map); SPEC 1 `docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md` (the frozen contract); VISION REVIEW `docs/reviews/2026-07-01-long-horizon-runtime-vision-review.md` (the 5 tensions); SPEC REVIEW `docs/reviews/2026-06-30-long-horizon-runtime-spec-review.md`.
**Consumes (frozen, do not re-shape):** SPEC 1 §4/§7/§10/§11 — the enums `FindingKind · CostTier · Context · CheckStatus · EvaluatorKind`; the `CheckEntry · Provenance · FlakeContract · Finding · Item` shapes; the helpers `loadRegistry · resolveEvaluator · runCheck · metaCheck · findByScope · advanceLifecycle`.
**Consumed by:** the realization plans; SPEC 2 `docs/superpowers/specs/2026-07-01-runtime-spec-2-backward-edge-learning-loop.md` (the floor drives `ask`/`journal` from here).
**Hard constraint:** ring-1 stays **project- and harness-agnostic** — the core calls **only** the six capability interfaces (§4). Every Nestfolio-specific binding (Claude Code adapter, the `backlog-*` procedures, the `benchmark-backlog` corpus) is quarantined behind seam #1 (harness) or seam #2 (project). The result is a **strict superset** of today's `backlog-*` system (discharged in §12).
**Locked decisions:** (1) **the core calls only the six capabilities** — the adapters ARE the harness seam; (2) **the decision-bearing spine stays inline and visible** — `fanOut` returns summaries, never transcripts; (3) **`journal` = idempotent keyed steps**, resume is replay not a save-point; (4) **the scope-gate is a registry check that BITES** — distraction is closed structurally, not by a plea.

---

## 1. Problem

The forward machinery the Runtime needs — detect → file → prioritize → fix → prove — **already runs today**, but it is scattered across bespoke skills with no shared spine, no shared capability seam, and a resume model the review flagged as fragile. Grounded inventory of the forward-edge surfaces, as of 2026-07-01:

| Forward-edge concern | Where it lives today | The scatter symptom |
|---|---|---|
| detect (watch) | `scripts/verify-structure.sh` pre-commit + manual `nx run *drift` + a human remembering to invoke an `audit-*` skill | **no one orchestrated surface** — no drift target is wired into CI or `nx.json` `targetDefaults`; enforcement = "someone runs it" |
| file (intake) | `.claude/skills/backlog-add` epic-aware router | fine, but decoupled from the checks that should feed it |
| prioritize (planner) | `.claude/skills/backlog-next` Step 1 pick + `docs/BACKLOG.md` render | `impact` is prose-judged, not computed; only `rank` is stored |
| fix (execution) | `backlog-next` (worker) + `backlog-next-epic` (orchestrator) | rich but Claude-Code-shaped; the host primitives (subagents, AskUserQuestion, hooks) are *baked into the prose*, not behind an interface |
| prove (gates) | `preflight.mjs` / `postflight.mjs` | good deterministic gates — but not registry checks; `exit 0 ≠ pass` is re-implemented per skill |
| resume (journal) | `runstate.mjs` closed-schema snapshot + `resume-gate.mjs` | **save-points, not idempotent journaling** — the eval corpus carries a live `bne-resume-corrupt-stop` danger (`scripts/benchmark-backlog/scenarios/bne-resume-corrupt-stop.scenario.mjs`) |
| distraction control | single-active (lint rule 2/11) | **half-structural**: single-active bites, but "don't pivot mid-flight" is still a *behavioral plea* (VISION REVIEW A5 / SPEC REVIEW A8) |

**Two problems this spec closes:**

1. **The forward edge has no seam.** The execution engine is welded to Claude Code — so the executor is *not yet* harness-fungible, only model-fungible. The six capability interfaces (§4) are the seam that makes the core depend on *nothing about its host*.
2. **The resume is a save-point, and distraction is a plea.** The `journal` idempotency contract (§5) makes resume duplicate-safe replay; the scope-gate check (§9) makes "diff ⊆ declared scope" a check that *bites*, closing failure mode 3 structurally (the fix the target-arch promised and the vision then dropped — VISION REVIEW A5, now restored).

This spec builds the forward edge and the harness seam **on top of** SPEC 1's registry — it adds **nothing project-specific** to ring-1; §12 maps today's surfaces onto the new homes as the first content/adapter ring.

---

## 2. Decisions (locked in vision; restated as build premises)

Each decision names the failure it answers **and the reusable pattern it establishes** — pattern-reuse is the primary objective (CLAUDE.md Hard Constraints).

1. **The core calls only the six capabilities; the adapters are the harness seam.** Ring-1 depends outward on exactly one TypeScript surface — `capabilities/index.ts` — and nothing else about its host. Establishes the reusable *"a stateless core over a fixed capability contract is harness-fungible"* pattern (VISION §11/§12, law §13.7). Answers failure mode 7 (lock-in) for the *harness* axis, the way statelessness answers it for the *model* axis.

2. **The decision-bearing spine stays inline and visible; `fanOut` returns summaries, never transcripts.** Fan-out is for *breadth* (decision-free parallel work), never to hide the interactive worker. Establishes the reusable *"isolate work, never isolate judgment"* pattern (VISION §13 caution; the **Tier-2 scar**, `feedback_no_worker_isolating_subagents.md`). Answers failure mode 5 (unsafe autonomy) + preserves legibility (law §13.9).

3. **`journal` = idempotent, keyed, replayable steps — resume is replay, not a save-point.** Every side-effecting step is wrapped in a keyed journal step; re-running is duplicate-safe. Establishes the reusable *"adopt the durable-execution discipline behind an interface, not the engine as a dependency"* pattern (VISION §11 journal, law §13.6; SPEC REVIEW A6). Answers failure mode 1 (amnesia) at the step granularity the save-point model misses.

4. **The scope-gate is a registry check that bites.** "The active item's diff stays within its declared `scope`" is a `CheckEntry` run `onTrigger=commit` (invariant) AND at the ship gate — a diff that escapes scope files a `Finding` and blocks the gate. Establishes the reusable *"structural control beats behavioral exhortation"* pattern (VISION §8, tension **(d)**; closes SPEC REVIEW A8). Answers failure mode 3 (distraction) structurally.

5. **Global invariants always ride the wake; expensive checks batch once at an epic boundary.** Scoped wake (law §13.8) economizes *retrieval*, never *enforcement*: the cheap-by-construction invariant gates are always in the payload; the live-e2e and heavy judgment audits run out-of-band, batched once at epic pre-done. Establishes the reusable *"cost-tier drives cadence; safety never waits on cost"* pattern (VISION §7/§8, tension **(b)**; reconciles VISION REVIEW A3).

These were confirmed at the vision layer; this spec derives the interfaces, engines, and TDD gates from them and does **not** revisit them.

---

## 3. Architecture — three rings, two seams (VISION §12)

The Runtime is three concentric rings. **This is the whole portability story, both axes.** SPEC 1 laid down `runtime/engine/` (ring 1) and `runtime/content/` (ring 3); this spec adds the **forward-edge helpers** (ring 1), the **capability seam** (ring 1 types + ring 2 adapters), and the **eval corpus** (ring 3).

```
runtime/
  engine/                        # ─────────── RING 1 — pure, project- & harness-agnostic ───────────
    schema/                      #   (SPEC 1) check.schema.ts · item.schema.ts · finding.schema.ts
                                 #   (SPEC 3) journal.schema.ts    §5 — Journal/StepRecord/RunLedger/RunMeta types
    lib/                         #   (SPEC 1) load-registry · resolve-evaluator · run-check ·
                                 #            meta-check · find-by-scope · advance-lifecycle
      run-watch.mjs              #   (SPEC 3) watch engine         §6
      intake.mjs                 #   (SPEC 3) intake router        §7
      plan-next.mjs              #   (SPEC 3) planner              §8
      scope-gate.mjs             #   (SPEC 3) scope-gate check     §9
      run-gate.mjs               #   (SPEC 3) gates                §10
      journal.mjs                #   (SPEC 3) journal contract     §5
    capabilities/                #   ── seam #1 boundary ──
      index.ts                   #   (SPEC 3) the SIX interfaces (TYPES ONLY)  §4
    loop/
      worker.mjs                 #   single-item spine — calls capabilities, never a host primitive
      orchestrator.mjs           #   epic spine        — calls capabilities, never a host primitive
    test/*.test.mjs              #   node --test, import pure cores directly
    registry.config.json         #   { checksDir, exclusionsRoot, triggersFile } — the ONLY project binding

  starter/                       # ─── project-agnostic default library (ring-1-adjacent, NOT seam #2) ─
    checks/*.yaml                #   the 6 structural checks that work on ANY repo day-one (§13);
                                 #   `runtime init` COPIES these into a new project's content ring

  adapters/                      # ─────────── RING 2 — seam #1 (the harness) ─────────────────────────
    claude-code/                 #   the FIRST adapter — maximal binding (§4 right-hand column)
      execute.mjs                #     → the inline, interactive worker
      fan-out.mjs                #     → subagents / Workflow (returns SUMMARIES, never transcripts)
      ask.mjs                    #     → AskUserQuestion (+ the <<HARNESS-PAUSE>> degradation, §4.3)
      on-trigger.mjs             #     → hooks / cron (commit·merge·ci·schedule)
      run-procedure.mjs          #     → the Skill tool / superpowers
      journal.mjs                #     → git-native run-state files (§5)

  content/                       # ─────────── RING 3 — seam #2 (the project = Nestfolio) ─────────────
    checks/*.yaml                #   the 34 surfaces mapped to CheckEntry (SPEC 1 §12)
    triggers.yaml                #   the watch-engine cadence config (§6) — itself a checked knob
    exclusions/*.json            #   the reusable pure-fn + JSON-sidecar gate pattern
  eval/
    scenarios/*.scenario.mjs     #   the eval corpus (today's benchmark-backlog; §11)
```

**The two seams and the one dependency rule:**

- **Seam #1 (harness) — `runtime/engine/capabilities/index.ts`.** Ring 1 imports these *types* and nothing else about a host. A rich host (Claude Code) binds each to its richest primitive; a lean host binds its own or degrades (§4). **Ring 1 never imports from `runtime/adapters/`.**
- **Seam #2 (project) — `registry.config.json`.** The engine reads *where* checks/triggers/exclusions live; it never hard-codes `runtime/content/`. Point `checksDir` at another repo's library and ring 1 is unchanged.

**Invariant achieved:** everything in rings 2–3 is swappable; **ring 1 never depends outward.** Serverless, monolith, event-driven, micro-frontend — all are just content the checks encode (VISION §12).

---

## 4. The six capability interfaces (VISION §11 — the harness seam)

The core calls only these. Each row names the **discipline pattern-adopted**, the **Claude Code binding** (maximal), the **graceful degradation**, and **the engine wrappable later** — all without the core changing (TARGET-ARCH §4).

| Capability | Discipline adopted | Claude Code binding (maximal) | Degrades to | Wrappable engine (later) |
|---|---|---|---|---|
| `execute(task)` | agent-runner loop | the **worker** (inline, visible) | inline steps | a coding-agent runner |
| `fanOut(tasks)→summaries` | fan-out returns **summaries, not transcripts** (Tier-2 scar; LangGraph `Send`) | **subagents / Workflow** `parallel` | sequential loop | an orchestration lib |
| `ask(decision)→choice` | HITL that **blocks indefinitely** (LangGraph `interrupt()`, Temporal signals) | **AskUserQuestion** | the `<<HARNESS-PAUSE>>` sentinel (§4.3) | a workflow signal |
| `onTrigger(event\|schedule)` | event/cron-driven checks (hooks, CI) | **hooks / cron** (commit·merge·ci) | manual trigger | a CI runner |
| `runProcedure(name)` | composable skills | **Skill tool / superpowers** | inline procedure | a skill registry |
| `journal` | **idempotent, keyed, replayable** run-state (Temporal/Restate *discipline*, NOT save-points) | git-native **run-state files + idempotency contract** (§5) | same, single-process | a durable-execution engine |

**Guiding rule — progressive enhancement, not lowest-common-denominator.** The reference host uses every capability to the fullest and the procedures are *prompt-shaped for it*, so a leaner harness yields a materially thinner product — not the same product through a thinner adapter (VISION §11; SPEC REVIEW A5). The interfaces buy exactly one thing: the *core* never *depends* on a host. **The adapter is allowed to be thick where it counts.**

### 4.1 The typed contract (ring-1 — `runtime/engine/capabilities/index.ts`)

```ts
// runtime/engine/capabilities/index.ts — the ONLY host surface ring-1 depends on.
import type { Finding } from '../schema/finding.schema';   // SPEC 1 §3, frozen
import type { Journal } from '../schema/journal.schema';   // §5 — the journal contract, defined ONCE there

// ── execute / fanOut ────────────────────────────────────────────────────────
export interface Task {
  id: string;                         // stable idempotency-key seed (feeds journal, §5)
  prompt: string;                     // the work instruction — prompt-shaped by the adapter
  scope: string[];                    // paths the task may touch (feeds the scope-gate, §9)
  procedure?: string;                 // optional named sub-procedure (runProcedure)
  payload?: unknown;                  // structured inputs
}
export interface TaskResult {
  taskId: string;
  status: 'done' | 'failed' | 'paused';
  summary: string;                    // bounded prose — NEVER a transcript
  findings?: Finding[];               // any findings the task raised
}
export interface Summary {            // the ONLY thing fanOut returns (the Tier-2 scar, decision 2)
  taskId: string;
  status: 'done' | 'failed';
  summary: string;                    // a bounded string; a transcript here is a SEAM VIOLATION
}

// ── ask (the floor surface) ─────────────────────────────────────────────────
export interface Decision {
  id: string;
  question: string;
  options: DecisionOption[];          // exactly one MUST carry recommended:true (house rule)
  irreversible?: boolean;             // hard-floor: ALWAYS pauses, even in --auto (§9, the floor)
  context?: string;                   // what's at stake, for the human
}
export interface DecisionOption { label: string; value: string; recommended?: boolean; }
export interface Choice { decisionId: string; value: string; rationale?: string; }

// ── onTrigger / runProcedure ────────────────────────────────────────────────
// TriggerEvent = the payload the HOST delivers to a handler. TriggerSpec = the filter the core
// SUBSCRIBES with. Two sides of onTrigger: subscribe by kind, receive the matching event.
// `epic-pre-done` is deliberately in NEITHER — it is not a host event but an orchestrator-internal
// direct `runWatch(--on=epic-pre-done)` batch call (§6.1/§9.3). The watch engine's `WatchTrigger.on`
// (§6.1) is the SUPERSET that adds `epic-pre-done`; it is never passed to `onTrigger`.
export type TriggerEvent =
  | { kind: 'manual' }
  | { kind: 'commit'; sha: string; changed: string[] }
  | { kind: 'merge';  branch: string; changed: string[] }
  | { kind: 'ci';     ref: string;    changed: string[] }
  | { kind: 'schedule'; cron: string };
export interface TriggerSpec {             // the subscribe filter — the first arg of onTrigger
  on: TriggerEvent['kind'];                // a HOST-deliverable kind (never 'epic-pre-done')
  cron?: string;                           // required iff on === 'schedule'
}
export type Unsubscribe = () => void;

// ── the six ─────────────────────────────────────────────────────────────────
export type { Journal };                   // §5 — defined in schema/journal.schema.ts, re-exported here (NOT a placeholder)
export interface Capabilities {
  execute(task: Task): Promise<TaskResult>;
  fanOut(tasks: Task[]): Promise<Summary[]>;                          // summaries, never transcripts
  ask(decision: Decision): Promise<Choice>;                          // blocks indefinitely; degrades (§4.3)
  onTrigger(spec: TriggerSpec, handler: (e: TriggerEvent) => Promise<void>): Unsubscribe;
  runProcedure(name: string, args?: unknown): Promise<TaskResult>;
  journal: Journal;
}
```

**The core imports `Capabilities` and calls it. It imports nothing from `runtime/adapters/`.** That single-import discipline *is* seam #1; a `runtime/engine/**` file importing a host primitive (a `@anthropic` skill, `execSync('claude …')`, a subagent handle) is a seam violation the meta-check surfaces (SPEC 1 §8 assertion "every enforced surface ↔ a registry entry" is extended in §11 to a ring-1 import-boundary check).

### 4.2 `fanOut` returns summaries — never transcripts (the Tier-2 scar, load-bearing)

`fanOut(tasks) → Summary[]` is for **breadth**: N decision-free, parallelizable tasks (e.g. per-service audit sweeps, per-check runs). Each `Summary` is a **bounded string** plus a status — the sub-agent's transcript is *discarded at the boundary*. This is the mechanized form of `feedback_no_worker_isolating_subagents.md` and VISION §13's caution: the collaborative, decision-bearing worker runs under `execute` (inline, visible), **never** under `fanOut`. The Tier-2 epic-member isolation was reverted for exactly this reason (`epic-member` mode runs the worker *inline* via the Skill tool, not detached — grounding: `backlog-next` SKILL.md is deliberately **not** `disable-model-invocation`).

**Rule (enforced by design):** any code path that would surface a human decision from inside a `fanOut` task is a violation — a decision must bubble to the inline spine as a `Finding`/`paused` result, never be answered inside an isolated agent. The eval harness's `structural-lint.mjs` (§11) is the regression: a fanned-out task that logs an `ask` is a RED.

### 4.3 The pause-and-resume sentinel (`<<HARNESS-PAUSE>>`) — formalized (VISION §15.2)

`ask(decision)` blocks indefinitely under the maximal binding (AskUserQuestion). But the eval harness runs the procedures under headless `claude -p`, whose toolset has **no AskUserQuestion** — a forced pause would become an *undetectable prose stop*. The degradation is a **convention injected identically into both A/B variants** so it can never bias a `compare` run:

- **Injection (adapter, degradation path).** Via `--append-system-prompt`: *"When you would call `ask` / AskUserQuestion or otherwise pause for a user decision, emit a single final line exactly of the form `<<HARNESS-PAUSE: reason>>` and then stop. Do not ask in prose."* (The constant `PAUSE_CONVENTION` lives in `docs/superpowers/plans/2026-06-24-backlog-eval-framework.md:1083`; parsed in `scripts/benchmark-backlog/runner.mjs`.)
- **Detection.** Terminal-kind `= pause` iff the regex `/<<HARNESS-PAUSE:\s*([^>]*)>>/` matches the final line **AND** no terminal mutating op appears in the call-log (a sentinel with a mutation after it is a RED — the pause must be the *last* act).
- **Protocol (how it composes with `journal`, §5).** A pause is a **journaled step whose value is the human's `Choice`, filled on the next wake.** On pause: the engine records `{ key: <decision-id>, status: 'awaiting', decision }` in the journal and stops. On resume: the human supplies the answer (interactive) or the harness scenario asserts `terminal:pause` (headless); the recorded `Choice` back-fills the step; replay (§5) reaches the decision point and continues with the recorded choice — never re-asking. This is what makes `ask` + `journal` compose: **a pause is durable, and answering it is a replay input, not a re-run.**

**The floor MUST be a real `Decision` widget, never a prose "your call."** A free-text prose pause is a seam violation — LESSONS F-7/F-33 record that an ambiguous prose "go" once collapsed into a self-merge. `ask` always carries options with exactly one `recommended:true`, and **no option ever runs a merge/irreversible act** — the human performs those (`.claude/skills/backlog-next-epic/SKILL.md:157,164,171`).

---

## 5. The `journal` idempotency contract (VISION §11 / §15.3)

**The problem this fixes (grounded).** Today resume is **save-points**: `runstate.mjs` writes a closed 6-key snapshot (`epic·branch·worktree·auto·decisions[]·e2e` + optional `e8`), and `resume-gate.mjs` dispatches `FRESH/RESUME/POST_MERGE_TAIL/PR_STILL_OPEN/ERROR` from it. Member status is *re-derived* from frontmatter (a good pure-replay pattern already), but the **side-effecting procedure steps** (the promote-commit, worktree-ensure, deploy, PR-open) are *not keyed* — a resume re-runs them and *hopes* each is idempotent by hand (E1 promote is **not**: a second `docs(backlog): promote …` commit). The eval corpus carries the live danger: `bne-resume-corrupt-stop` guards *a silent re-branch on corrupt run-state*. Law 6 ("`/clear` is free") is only honest **under a journal discipline** (TARGET-ARCH §13, amended law 6).

**The contract — the journal is a git-native, append-only, keyed step-ledger.** It *generalizes* `runstate.mjs` (kept as its meta/decisions/e2e slice) by adding a per-step ledger.

```ts
// runtime/engine/schema/journal.schema.ts — ring-1 TYPES (SPEC 1's convention keeps *types* in
//   `*.schema.ts` and *helpers* in `.mjs`, so the journal's shapes live HERE — imported by both
//   `capabilities/index.ts` (§4) and the `lib/journal.mjs` implementation, defined ONCE).
import type { Decision, Choice } from '../capabilities';    // §4.1 (the ask surface; type-only, so the cycle is erased)

export type RunId = string;                   // `item-<id>` or `epic-<id>` — STABLE across wakes
export type StepKey = string;                 // `<phase>.<name>` e.g. "E1.promote", "ship.postflight"
export type Json =                            // any JSON-serializable step value
  | null | boolean | number | string | Json[] | { [k: string]: Json };
export type StepStrategy =
  | 'pure-rederive'        // no external effect; recompute each wake (member selection, planner rank) — NOT ledgered
  | 'keyed-effect'         // a side effect (commit, deploy, PR-open) — ledgered; re-invocation returns the recorded value
  | 'external-idempotent'; // effect is naturally idempotent given a token (worktree-add NOOP-if-exists) — ledgered for legibility

export interface RunMeta { runId: RunId; branch: string; worktree: string; auto: boolean; }   // the runstate.mjs slice
export interface StepRecord { key: StepKey; status: 'complete' | 'awaiting'; value?: Json; decision?: Decision; ts: string; }
export interface RunLedger { meta: RunMeta; steps: Map<StepKey, StepRecord>; }   // the in-memory shape read() returns

export interface Journal {
  begin(runId: RunId, meta: RunMeta): void;                    // idempotent: existing run → NOOP (this is FRESH-vs-RESUME)
  step<T>(runId: RunId, key: StepKey,
          fn: () => Promise<T>, strategy?: StepStrategy): Promise<T>;   // the idempotent-step primitive
  record(runId: RunId, key: StepKey, value: Json): void;       // append-only annotation (decisions[], e2e evidence)
  read(runId: RunId): RunLedger | null;                        // null ⇒ FRESH
  awaiting(runId: RunId, key: StepKey, decision: Decision): void;   // pause: durably park an ask (§4.3)
  fulfil(runId: RunId, key: StepKey, choice: Choice): void;    // resume: back-fill a parked ask
}
```

**Where the types vs the implementation live.** The `interface`/`type` declarations above are the **`schema/journal.schema.ts`** module; the `lib/journal.mjs` **implementation** (the `journal.step` algorithm below, tail-heal, resume) imports them. `capabilities/index.ts` (§4) also imports `Journal` from here and binds `Capabilities.journal` to it — one definition, two importers, no `.mjs`-embedded types and no empty placeholder.

**Key format (concrete, git-native).** The ledger lives at `<git-common-dir>/journal/<runId>/steps.ndjson` — one file per run, resolved via the same `git rev-parse --path-format=absolute --git-common-dir` form `runstate.mjs` already uses (cwd-independent; shared across worktrees). Each line is one `StepRecord`. The `runstate.mjs` closed-schema file is retained as the run's `meta` (`RunMeta = { runId, branch, worktree, auto }`) + its `decisions[]`/`e2e`/`e8` slice — **generalized, not replaced** (equivalence map §12).

**The idempotent-step contract** (the one primitive everything else is built on):

```
journal.step(runId, key, fn, strategy):
  ledger = read(runId)                                  // tail-healed NDJSON (below)
  if strategy === 'pure-rederive':      return await fn()             // never ledgered — replay is free
  if ledger.get(key)?.status === 'complete':
                                        return ledger.get(key).value  // REPLAY — fn NOT invoked
  value = await fn()                                    // execute exactly once
  appendLine(runId, { key, status:'complete', value, ts: now() })     // single atomic line write
  return value
```

**Crash safety = tail-heal, not whole-file trust.** The ledger is parsed line-by-line; a **torn final line** (a crash mid-append) is *dropped* on parse — generalizing the `parseRunState` self-heal (`runstate.mjs:96-109`, F-11). So every intact line is a completed step and the tail is either fully present or discarded: a crash **never** corrupts a prior step. This shrinks the `resume-corrupt-stop` danger from "the whole run is unusable → STOP" to "drop the torn tail, replay the rest."

**The resume algorithm (resume = replay, duplicate-safe):**

```
resume(runId):
  ledger = journal.read(runId)                          // append-only, tail-healed
  if ledger == null:  action = FRESH                    // run the procedure from the top; every step executes once
  else:               action = RESUME                   // re-run the SAME procedure from the top:
       #   - each journal.step short-circuits on a 'complete' key (replay, no side effect)
       #   - the FIRST un-recorded step executes for real
       #   - pure-rederive steps just recompute (member selection, planner rank)
       #   - a parked ask (status 'awaiting') whose Choice was fulfilled resumes with the recorded choice (§4.3)
  meta.decisions[] and meta.e2e are READ, never re-asked / re-run.
```

The `resume-gate.mjs` dispatch is **kept** as the meta/e8-marker slice of this algorithm (`FRESH/RESUME/POST_MERGE_TAIL/PR_STILL_OPEN`); the journal *adds* the per-step ledger so `RESUME` is genuine replay rather than "trust the snapshot and hope each step re-runs idempotently."

**Grounding — which existing steps map to which strategy:**

| Existing step | Strategy | Why |
|---|---|---|
| member selection (`epic-members.mjs`) | `pure-rederive` | re-derived from frontmatter each wake — already a replay (grounding: run-state deliberately does NOT store member status) |
| planner `rank`/`impact` (§8) | `pure-rederive` | read-time computed; only `rank` is stored |
| E1 promote-commit (`docs(backlog): promote …`) | `keyed-effect` | NOT naturally idempotent — the ledger makes a re-run a NOOP (removes the double-promote hazard) |
| E2 worktree-ensure (`worktree-ops.mjs ensure`) | `external-idempotent` | `planEnsure → NOOP/ATTACH/CREATE` is already idempotent; ledgered for legibility |
| E6 batched e2e | `keyed-effect` | pinned to the tip sha (`e2e.sha`, F-14); a resume replays the recorded green, re-runs only if HEAD moved |
| E8 PR-open | `keyed-effect` + `awaiting` | the open is ledgered; the merge is a parked `ask` the human fulfils |

---

## 6. The watch engine (VISION §8 — detect)

The watch engine is **net-new orchestration over existing checks**: it runs registry checks on `onTrigger` in their `audit`/`invariant` contexts and emits `Finding[]`. It reuses SPEC 1 verbatim — `loadRegistry`, `findByScope`, `runCheck` — and adds only cadence.

### 6.1 The trigger-config schema (a checked knob, seam #2)

```yaml
# runtime/content/triggers.yaml — the watch-engine cadence config (content ring).
# This file is itself a stored knob ⇒ it is the `scope` of a `watch-config-valid` check (law §13.2).
triggers:
  - on: commit                 # every commit
    contexts: [invariant, gate]
    cost_ceiling: cheap        # NEVER runs moderate/expensive on commit — the batching rule
  - on: merge
    contexts: [invariant, gate]
    cost_ceiling: cheap
  - on: schedule
    cron: "0 6 * * *"          # nightly
    contexts: [audit]
    cost_ceiling: moderate     # scheduled repo-wide audits (read-model-drift, card-drift) — NOT live-e2e
  - on: epic-pre-done          # the epic boundary batch — the ONE place expensive checks run
    contexts: [audit, gate]
    cost_ceiling: expensive    # live-e2e + heavy judgment audits, batched ONCE (grounding: E6)
  - on: manual
    contexts: [gate, audit, invariant]
    cost_ceiling: expensive
```

```ts
interface WatchTrigger {
  // SUPERSET of TriggerEvent['kind'] (§4.1): adds 'epic-pre-done', which is NOT a host onTrigger
  // event but an orchestrator-internal direct `runWatch(--on=epic-pre-done)` batch call (§9.3).
  on: 'manual' | 'commit' | 'merge' | 'ci' | 'schedule' | 'epic-pre-done';
  cron?: string;               // required iff on === 'schedule'
  contexts: Context[];         // SPEC 1 frozen enum — which registry contexts fire on this trigger
  cost_ceiling: CostTier;      // SPEC 1 frozen enum — refuses any check whose cost_tier exceeds it
}
```

### 6.2 Cost-tier → cadence, and the scoped-wake / global-safety reconciliation (tension (b), load-bearing)

| `cost_tier` | default `contexts` | cadence | rides the wake? |
|---|---|---|---|
| `cheap` | `invariant` / `gate` | **every commit + every item boundary** | **always** (global invariants ALWAYS ride) |
| `moderate` | `audit` | scheduled (nightly) + on-demand | no — deferred to the watch engine |
| `expensive` | `audit` | **batched once at `epic-pre-done`**, never per item | no — deferred to the epic boundary |

**The reconciliation, made mechanical.** Global invariants are **cheap-by-construction** — SPEC 1 §6 freezes `contexts.includes('invariant') ⇒ cost_tier === 'cheap'` and the meta-check (SPEC 1 §8) files an `inconsistency` if violated. Because invariants are provably cheap, `findByScope` (SPEC 1 §11) can return **every** active invariant into **every** scoped wake with no cost blowup: *scoping narrows retrieval (dossiers, expensive audits), never the enforcement floor* (VISION §7, law §13.8). An expensive-but-global property is modeled as an `audit` batched at the epic boundary — **never** an `invariant`. So a scoped worker is always guarded by the global invariants, and only the costly audits wait for the watch engine. This is exactly today's E6: the live-e2e (`e2e-feature-tests` + `nestfolio-e2e`) runs **once** at epic pre-done, never per member (grounding: `backlog-next-epic` SKILL.md E6).

### 6.3 The watch-engine helper

- **`runWatch({ registry, trigger, changedScope, capabilities }) → Finding[]`**
  - **Pure core (selection):** the checks to fire = every `active` check where `check.contexts ∩ trigger.contexts ≠ ∅` **AND** `costRank(check.cost_tier) ≤ costRank(trigger.cost_ceiling)` **AND** (`findByScope` overlap with `changedScope` **OR** the check is a global invariant — always included). This is `findByScope` + a cost-ceiling filter; no new selection logic.
  - **Impure edge:** for each selected check, `runCheck({ check, context })` (SPEC 1 §11) — which itself refuses a context the check did not declare. Findings are collected and returned to intake (§7).
  - **CLI:** `run-watch.mjs --on=<trigger> [--changed=<glob,glob>]` — **exit 0** no findings, **1** findings raised (the *fails-loudly* contract), **2** usage. Wired to the host via `onTrigger` (commit/merge hook; the nightly cron; the epic-pre-done batch call from the orchestrator).
  - **Pins:** a `cheap` invariant fires on `commit` even when its scope does not overlap `changedScope` (global invariants always ride); an `expensive` audit does **not** fire on `commit` (`cost_ceiling` refuses it); `exit 0 ≠ pass` — the count of `Finding[]`, not the child exit code, decides.

---

## 7. Intake (VISION §8 — file)

Intake turns each `Finding` into **zero, one, or many** `Item`s via the epic-aware router — today's `backlog-add`, unchanged in behavior. A finding is an *observation*; intake is where the judgment *"is this worth an item, and where does it belong?"* lives.

### 7.1 The intake decision contract

```ts
// runtime/engine/lib/intake.mjs — ring-1 (the ROUTER is judgment; the SHAPE is fixed)
type IntakeRoute =
  | 'fold'             // thematically near the active epic → fold in as a member (§7.2 picks core|captured)
  | 'join-theme'       // matches an existing theme epic → join it
  | 'mint-aggregation' // shares a root cause with ≥1 parking orphans → SUGGEST a new theme epic
  | 'orphan'           // the residue → parking orphan
  | 'split'            // atomicity: sub-parts split across the closure verdict → MANY items
  | 'discard';         // false positive / already-covered → zero items (logged, no item)

interface IntakeDecision {
  finding: Finding;              // SPEC 1 §3, frozen
  route: IntakeRoute;
  items: Item[];                 // 0 (discard) · 1 (fold/join/orphan/mint) · many (split) — SPEC 1 §10 shape
  epic?: ItemId;                 // set for fold / join / mint-aggregation
  rationale: string;             // which router branch fired + why — STATED in chat (CLAUDE.md hot-path rule)
}
// intake is ASYNC + capability-seamed: the ROUTE selection is JUDGMENT (theme-match, core-vs-captured),
// performed via `capabilities.execute` — prompt-shaped by the adapter, the SAME judgment the harness's
// LLM-judge layer grades (§11.2). Internally it splits into two typed layers: `selectRoute` (judgment,
// via `execute`) → `shapeItems` (a PURE deterministic core: frontmatter + `backlog-lint --fix`). No
// synchronous, capability-free routing is possible — the judgment needs the seam.
export function intake(
  { finding, registry, backlog, capabilities }
) → Promise<IntakeDecision>;
```

### 7.2 The router (maps to `backlog-add`'s epic-aware hot-path, verbatim)

The four hot-path branches (CLAUDE.md § Backlog Discipline): **(1)** near the active epic → **fold** (role by the *closure-predicate test*: `core` if leaving it undone falsifies a `done_when` clause or it's in `scope:`; `captured` only if genuinely orthogonal — default **core** when load-bearing is uncertain); **(2)** matches a theme epic → **join**; **(3)** shares a root cause with ≥1 parking orphans → **suggest mint-aggregation**; **(4)** else → **orphan**. Plus two shape rules SPEC 1's item atom requires: **atomicity** (a finding whose sub-parts split across the closure verdict → **split** into separate items, never one mixed item) and **discard** (a false-positive/already-covered finding → zero items, logged). Each new item carries `provenance.from_finding = finding.id` (SPEC 1 §10 — the raised-finding id, **not** `finding.check`) — the forward-edge link that lets the planner and the backward edge trace an item back to the finding it came from (and, via that finding's `check`, to the check that raised it).

**Evaluator note.** The route *selection* is judgment (theme-match, core-vs-captured) → it is guarded by the LLM-judge layer of the eval harness (§11), and the harness corpus already tests it: `add-fold-core`, `add-fold-captured`, `add-join-theme`, `add-mint-aggregation`, `add-orphan`, `add-atomicity-split` (`scripts/benchmark-backlog/scenarios/`). The *write* (frontmatter, `backlog-lint --fix`) is deterministic and golden-gated.

---

## 8. The planner (VISION §8 — prioritize)

The planner answers *what is worked next* with `next` + `rank` + read-time `impact`. **Only `rank` is stored** (law §13.2); everything else is computed at read time — there is no stale, stored priority field. Maps to `backlog-next` Step-1 pick + the `docs/BACKLOG.md` render.

### 8.1 The planner helper

- **`planNext({ backlog, registry, env }) → { next, ranked, impacts }`**
  - **`next`** — the pick, by today's order (grounding: `backlog-next` SKILL.md Step 1): **(1)** a non-epic `status: active` item → resume; **(2)** else the top-ranked `queued` item (lowest `rank`). Redirect-and-stop to the orchestrator if the pick is `type: epic` or an active-epic member (the epic-member guard).
  - **`ranked`** — the queued items sorted by the stored `rank` (the ONLY stored priority input, law §13.2).
  - **`impacts`** — a read-time `impact` per item, **never stored** (§8.2).
- **`renderIndex({ backlog, registry }) → string`** — the generated `docs/BACKLOG.md`-style index (EPICS / ACTIVE / QUEUED / LATER / Recently-Shipped), rendered **purely** from frontmatter + registry with no stored state. It is the read-only render side of the planner (equivalence map §12: `docs/BACKLOG.md` generated index); the `index-fresh` starter check (§13) asserts the committed index byte-matches this render.

### 8.2 The read-time `impact` computation (the derived priority surface)

`impact` is recomputed on every read from irreducible state — it is a *view*, not a field:

```ts
interface Impact {
  blocks:    number;              // # of open findings/items whose precondition is THIS item
                                  //   (derived from provenance.from_finding + references — NOT a stored edge)
  blast:     number;             // units-of-blast the item's `scope` touches — a PROJECT-SUPPLIED count,
                                  //   injected via `blastOf` (below); ring-1 never computes it (no nx, no subprocess)
  freshness: 'fresh' | 'stale';   // whether the item's `references` still resolve (a staleness check, SPEC 1 §5)
  epicPull:  number;              // if a member: # sibling CORE members still open (how much it drains the epic)
}
type BlastOf = (scope: string[]) => number;   // the content ring (seam #2) supplies this — NOT a ring-1 dependency
export function computeImpact({ item, backlog, registry, blastOf }) → Impact;   // pure; read-time only
```

**`blast` is project-supplied — ring-1 stays tool-agnostic.** `blastOf` is a pure function the **content ring (seam #2)** injects; ring-1 never imports `nx` or shells out — an impure subprocess baked into a read-time pure helper would violate the one dependency rule (§3, locked-decision 1). Nestfolio's content ring binds `blastOf` to `nx affected` over `scope` (grounding: `detect-fork-blast-radius.mjs`, the same measure the floor's blast gate uses) — that binding is the **quarantined project example**, not part of the core. Another repo supplies its own units-of-blast (files touched, package count, LOC) and ring-1 is unchanged.

**Derive, don't store — and `rank` is itself checked.** `impact` is never persisted (any persisted priority is a law §13.2 violation the meta-check files). The one stored knob, `rank`, is validated by an `active` check — the content-ring `backlog-queued-rank-unique` entry (lint rule 6: `status: queued ⇒ rank set + unique`, SPEC 1 §12). This binds VISION law §13.2 mechanically: *a stored knob with no validating check is a `gap` finding* (SPEC 1 §8 rot-detector ii). `blocks` is a **derived dependency view**, computed from `provenance`/`references` at read time — never a stored `depends_on` edge (VISION §13 standing constraint; the scar the SPEC REVIEW B4 flags).

---

## 9. The execution engine (VISION §8 — fix) + the scope-gate check

Two modes, both **behind the capability interfaces**, both keeping the decision-bearing spine **inline and visible**.

### 9.1 The worker (single item)

The worker runs one item, calling `execute` for its steps, `ask` at every floor act, `journal.step` for every side effect, and `runProcedure` for composable sub-procedures. It maps to `backlog-next` (lane classification, preflight, execution, closing sequence) — kept verbatim, now behind the seam:

- **Lane** (doc-layer / simple / complex) — the worker's routing knob (grounding: `backlog-next` SKILL.md:54-64). Complex → `journal.begin` a run + a worktree (`external-idempotent` step); doc/simple → work on main.
- **Gates at start + ship** (§10) — `run-gate` in the `gate` context.
- **The closing sequence** (regen derived docs → true-affected verify → deploy-if-needed → ship → `lint --fix` → finish) — each a `journal.step` with the strategy of §5. `finishing-a-development-branch` is a `runProcedure`; the deploy is an `execute` task gated by the floor.

### 9.2 The scope-gate check — distraction closed structurally (tension (d), load-bearing)

"Don't pivot mid-flight" is **not** a plea — it is a registry check that **bites**. The active item's diff must stay within its declared `scope`; a diff that escapes files a `Finding` and blocks the ship gate. This is the fix TARGET-ARCH §11 promised ("closes review item A8") and the vision then dropped (VISION REVIEW A5) — **restored here as a concrete `CheckEntry`:**

```yaml
# runtime/starter/checks/active-item-scope-gate.yaml
#   (STARTER library — a project-agnostic structural check, NOT Nestfolio seam-#2 content. It works
#    on ANY repo with no domain model; `runtime init` copies it into a new repo's content ring, §13.)
id: active-item-scope-gate
property: >
  The working-tree diff belongs to exactly one active item (single-active), and every changed path is
  matched by that item's declared `scope`. A path changed outside `scope` is an out-of-scope escape.
kind: inconsistency          # the diff (one source of truth) disagrees with the declared scope (the other)
evaluator:
  type: deterministic
  run: "node runtime/engine/lib/scope-gate.mjs"
  # NO fix — an out-of-scope diff is a floor decision: widen scope, split the item, or revert. Never auto-resolved.
cost_tier: cheap             # a git-diff vs a glob set — cheap-by-construction ⇒ admissible as an invariant
contexts: [invariant, gate]  # invariant onTrigger=commit (BITES continuously) + gate at ship
scope:
  paths: ["**/*"]            # reads the git diff; the active item's `scope` comes from the item frontmatter
status: active
provenance:
  minted_by: "starter-pack"          # reserved sentinel: seeded starter checks have no minting item/lesson
                                      #   (SPEC 1 Provenance convention — §15 re-freeze delta 3)
  lesson: "MEMORY/feedback_pivot_to_worktree.md"
  ratified: "2026-07-01"             # starter checks ship PRE-ratified (no per-check floor ratification)
```

- **`scopeGate({ activeItem, diffPaths }) → { withinScope, escapes, findings }`**
  - **Pure core:** `escapes` = every `diffPaths` entry not matched by any `activeItem.scope` glob. `withinScope = escapes.length === 0`. `findings` = one `inconsistency` `Finding` per escape cluster, `detail` naming the escaped path(s) and the declared scope.
  - **CLI:** `scope-gate.mjs` — reads `git diff --name-only` + the active item's `scope`; **exit 0** in-scope, **1** an escape (the gate blocks), **2** usage.
  - **Pins:** a diff touching a path outside `scope` → `exit 1` + a `Finding` (the gate bites — positive); a diff fully within `scope` → `exit 0`, no finding (negative); two active items (single-active broken) → `exit 1` (the check also asserts single-active, reusing lint rule 2's property).

**Consequence:** like single-active, the scope-gate is *structural because it bites*, not because it intercepts the keystroke (VISION §8). Combined with single-active (lint rules 2/11 as invariant checks), failure mode 3 is closed by two checks, not by discipline.

### 9.3 The orchestrator (epic)

The orchestrator runs an epic on a **single shared branch**, drives the worker over core members **one at a time via `execute`** (inline, never `fanOut` — the decision-bearing spine, decision 2), batches the **expensive checks once at `epic-pre-done`** (via `runWatch --on=epic-pre-done`, §6), runs the **incidental-work / captured audit**, and does a **single integration** (one PR). It maps to `backlog-next-epic` verbatim (grounding: E0–E9), now behind `fanOut` (for the *breadth* work only — parallel per-check runs, per-service audit sweeps) and `journal` (the run-state generalized, §5). `--auto` decisions go through `ask` and are logged into `journal.record`'s `decisions[]`, rendered into the PR body at ship — the **asynchronous-review surface** that replaces synchronous approval; **the merge is always the human's** (`ask`, §4.3).

---

## 10. Gates (VISION §8 — prove)

Gates are **registry checks in their `gate` context, at item start and ship** — the *prove* step. Nothing ships without the evidence its gates demand. Maps to `preflight.mjs` / `postflight.mjs`, now unified as registry checks.

- **`runGate({ registry, boundary, item, env }) → { passed, findings }`** where `boundary ∈ { start, ship }`
  - **Selection:** `findByScope({ registry, scope: item.scope })` restricted to `contexts.includes('gate')`, **plus all global invariants** (they always ride, §6.2). At `ship`, this includes the scope-gate (§9.2) and the item's `done_criteria`-derived gates.
  - **`exit 0 ≠ pass` (load-bearing).** The gate reads the **finding/collected count**, never a bare child exit code. This mechanizes the ZERO-COLLECTED HARD GATE the orchestrator already applies to e2e: *a suite exiting 0 with 0 collected tests is RED, not green* (grounding: `backlog-next-epic` E6; `feedback_e2e_nx_wrapper_strips_quotes.md`; `feedback_pipe_masks_exit_code.md`). `runCheck` returns `Finding[]`, and `passed = findings.length === 0 && ran === true`.
  - **The only sanctioned pass-through is floor curate.** A `gate` finding blocks the ship; the *only* way past a failing guard is to **retire or supersede it at the floor** (SPEC 2 curate arm), which changes what "all gates pass" means and is itself an evidenced `ask` decision — never a silent skip (VISION law §13.5).
  - **CLI:** `run-gate.mjs --boundary=<start|ship> --item=<id>` — **exit 0** all pass, **1** any gate finding (blocks), **2** usage.

---

## 11. The eval harness (VISION §10 — the Runtime proving itself)

The Runtime holds itself to its own standard: the eval harness grades the Runtime's **own procedures** — a regression suite over *how it works*, not over the project it manages. Maps to today's `benchmark-backlog` (`scripts/benchmark-backlog/`), carried forward with two roles.

### 11.1 The four-layer artifact (the realization taxonomy)

Each Runtime procedure is a **four-layer artifact** (VISION §10; TARGET-ARCH §11, "the realization taxonomy"):

| Layer | What it is | Nestfolio binding (content ring) |
|---|---|---|
| **procedure** | the steps | `SKILL.md` prose |
| **lessons** | the knowledge it applies | `LESSONS.md` F-fixes + `feedback_*` dossiers |
| **helpers** | tested `.mjs` scripts | `runstate.mjs`, `resume-gate.mjs`, `epic-members.mjs`, … + ring-1 helpers |
| **eval** | its own regression scenarios | `scripts/benchmark-backlog/scenarios/*.scenario.mjs` |

### 11.2 Regression on procedures — and the honest teeth

Three run modes (grounding: `benchmark-backlog` SKILL.md): **regression** (grade the corpus on HEAD; any single gate-pass flip vs `baseline.json` = a regression, per `feedback_flake_means_broken`), **compare `<refA> <refB>`** (interleaved A,B,A,B to balance cache/temporal drift — proves an intended skill change didn't regress), **rebaseline** (overwrite the committed baseline).

The grading has **three layers** (`grade.mjs`), and the honesty is load-bearing:

1. **Golden (deterministic)** — resulting frontmatter, YAML scalar types, `lint.mjs` exit 0. **These bite** (real teeth), reusing `backlog-lint/lib`.
2. **Invariants (deterministic)** — the **call-log plane** (`called`/`neverCalled` over the four stub binaries `gh·deploy.sh·nx·backlog-next-worker`, allow-listed by `structural-lint.mjs`) + the **state plane** (`git`/worktree/run-state run for real, graded by end-state). Positive **and** negative (`gh pr merge` **never** called — the no-self-merge oracle).
3. **LLM judge (`judge.mjs`)** — fuzzy dimensions only (core-vs-captured, routing, clustering, finding write-quality).

**Self-proof is only as strong as the golden gates (VISION §10; VISION REVIEW A6).** The `2026-06-25` eval review found some rubric/judge scenarios can "pass for the wrong reason" (*real-but-partial* teeth). The harness states this plainly and treats **thin judge gates as findings the Runtime files against itself** (§11.3). The `<<HARNESS-PAUSE>>` sentinel (§4.3) is what lets a *forced pause* be graded deterministically — a pause is `terminal:pause`, asserted by every pause-expecting scenario so a hang or wrong-completion cannot false-pass.

### 11.3 Home for minted eval scenarios (the SPEC 2 handoff seam)

Every check ratified in SPEC 2 (the backward edge) lands its **eval scenario here** — this is the `flake_contract.eval_scenario` pointer SPEC 1 §4 freezes and SPEC 1 §8 assertion 3 requires. So the learning loop is itself regression-protected: a minted judgment check's flake is regressed by its scenario in this corpus.

- **Ownership split (no overlap).** SPEC 3 owns the **harness structure** (the four layers, the three modes, the three grading planes, the `defineSuite` reusable seam at `scripts/benchmark-backlog/suite.mjs`, the stub-binary/state-plane op taxonomy, the `<<HARNESS-PAUSE>>` grading). **SPEC 2 owns authoring** a minted check's eval scenario + its calibration/flake mechanics. The seam is exactly `flake_contract.eval_scenario` (a path into `runtime/eval/scenarios/` — today `scripts/benchmark-backlog/scenarios/`).
- **The reusable seam.** `defineSuite({ buildSandbox, stubs, grade, scenarios })` (`scripts/benchmark-backlog/suite.mjs`) is the liftable harness contract — a new content ring supplies its own sandbox + stubs + scenarios and reuses the runner/grader/judge unchanged. This is the single biggest eval-reuse win.

---

## 12. The no-lost-value equivalence map (discharging the strict-superset contract)

Every forward-edge and capability surface of today's `backlog-*` system, and its Runtime home. **Status:** *kept* (behavior identical) · *renamed* (plain term) · *generalized* (same value, wider) · *absorbed* (folded into a new surface, no behavior lost). Builds on TARGET-ARCH §11; SPEC 1 discharged the schema rows, SPEC 2 the backward-edge rows — **this table discharges the forward-edge + capability rows.**

| Current capability (today) | Runtime home | Status |
|---|---|---|
| `docs/BACKLOG.md` generated index | planner **index** (`renderIndex`) | kept |
| `backlog-next` Step-1 pick + routing | planner **`planNext`** + worker dispatch (§8/§9) | kept |
| `backlog-next` lane classification (doc/simple/complex) | worker **lane** (§9.1) | kept |
| `backlog-next` `preflight.mjs` | **gates** @ item-start (`gate` context) + `journal.begin` (§10/§5) | absorbed |
| `backlog-next` `postflight.mjs` | **gates** @ ship (`gate` context) (§10) | absorbed |
| `backlog-next` Step-6 closing (derive→affected→deploy→ship→lint→finish) | worker **ship sequence** through `execute`/`runProcedure`/`journal` (§9.1) | kept |
| `backlog-add` epic-aware router | **intake** (§7) | renamed |
| `backlog-themes` clustering | **intake grouping pass** (`mint-aggregation`, §7) | renamed |
| `backlog-next-epic` orchestrator (`--auto`, shared branch, batched e2e, captured audit, single PR) | execution **orchestrator** behind `fanOut`/`journal` (§9.3) | kept |
| `epic-members.mjs` member ordering | orchestrator **`pure-rederive` step** (§5) | kept |
| `runstate.mjs` closed-schema snapshot | **`journal`** meta + `decisions[]` + `e2e` (§5) | generalized |
| `resume-gate.mjs` FRESH/RESUME/… dispatch | **`journal` resume algorithm** (§5) | generalized |
| `worktree-ops.mjs` ensure/cleanup | **`journal` keyed/external-idempotent steps** (§5) | kept |
| `pr-conflict-resolve.mjs` (F-25) | worker ship step via `execute` (§9.1) | kept |
| E5 `--auto` floor + `Pre-authorized-actions` list | **`ask(decision)`** + the floor policy (checked config, SPEC 1 §8) | kept |
| E5 `<<HARNESS-PAUSE>>` sentinel | **`ask` degradation** (§4.3), formalized | generalized |
| E6 batched e2e once at epic pre-done | **watch engine** `expensive`-tier @ `epic-pre-done` trigger (§6) | generalized |
| single-active item / epic (rules 2, 11) + "don't pivot" plea | **law 1** invariant checks **+ the scope-gate check** (§9.2) | generalized (net-new scope-gate closes failure mode 3) |
| `detect-fork-blast-radius.mjs` | content-ring **`blastOf`** → planner `impact.blast` + the floor blast-radius gate (§8.2/§9.3) | kept |
| pre-commit `verify-structure.sh` (7 checks) | **watch engine** `onTrigger=commit` (`gate`/`invariant`, §6) | absorbed |
| nx drift targets (`read-model-drift`, `card-drift`, `typed-subject-drift`) | **watch engine** `audit`-context checks (§6) | absorbed |
| `audit-*` skills (5) | **watch engine** judgment `audit`-context checks (§6) | absorbed |
| `benchmark-backlog` grading harness | **eval harness** (§11) | renamed |
| `defineSuite` reusable seam | **eval harness** reusable seam (§11.3) | kept |
| `structural-lint.mjs` `STUB_BINARIES` call-log | **eval harness** call-log plane (§11.2) | kept |
| four-layer skill model (procedure·lessons·helpers·eval) | the **realization taxonomy** (§11.1) | kept |
| read-time priority regeneration | planner read-time **`impact`** (only `rank` stored, §8) | kept |

**Conclusion.** Every forward-edge and capability surface maps to a home with no behavioral loss; the two `generalized` net-new rows (`journal`, the scope-gate) *add* capability without subtracting any. Combined with SPEC 1 (schema) and SPEC 2 (backward edge), the whole `backlog-*` system is a **strict superset** → the "replace with no lost value" constraint is discharged.

---

## 13. Starter check library + on-ramp (VISION §15.5 — the cold-start wedge)

The cold-start risk (SPEC REVIEW A7): a new repo starts with an empty check library, so the *differentiated* half (the backward edge) does nothing until an adopter authors their own content ring. The mitigation is a **starter pack of project-agnostic structural checks** that work on *any* repo on day one — none needs a domain model.

**The smallest library (6 checks, all deterministic, all ring-1-hostable):**

| Starter check | Property | `kind` | `contexts` |
|---|---|---|---|
| `registry-integrity` | the meta-check — every enforced surface ↔ an entry; every entry runnable; every judgment check guarded (SPEC 1 §8) | inconsistency | `[audit, gate]` |
| `active-item-scope-gate` | the diff ⊆ the active item's `scope` + single-active (§9.2) | inconsistency | `[invariant, gate]` |
| `single-active` | at most one active item + one active epic (lint rules 2/11) | inconsistency | `[invariant]` |
| `references-valid` | every item `references` path + `#anchor` resolves (lint rule 3) | staleness | `[gate]` |
| `index-fresh` | the generated index byte-matches the render of frontmatter (lint rule 7; has `fix`) | drift | `[gate]` |
| `no-unsafe-casts` | no `as any` / `as unknown as` / `eslint-disable` in production source (`feedback_prefer_libraries_over_casts`) | drift | `[invariant, gate]` |

**Starter-check provenance (carried by SPEC 1 §15).** Seeded starter checks have **neither** a minting work-item/lesson **nor** a per-check floor ratification, so they use a reserved `minted_by: "starter-pack"` sentinel and ship **pre-ratified** (`ratified` = the starter-pack ship date). SPEC 1's first-cut `Provenance` defined `minted_by` as *the item id (or lesson id) whose ship minted the check* and `ratified` as *the ISO date of the floor ratification* — neither literally fits a seeded check, so the convention went **back to SPEC 1 and was re-frozen there** (§15 re-freeze delta 3: the reserved `minted_by` sentinel + the "starter checks ship pre-ratified" note). This spec consumes it verbatim rather than overloading `minted_by` with a spec id.

**The "works on a normal repo in 10 minutes" on-ramp:**

1. `runtime init` scaffolds `runtime/engine/` (ring 1, copied verbatim), `runtime/adapters/<host>/` (pick an adapter), `registry.config.json`, and **copies the 6-check starter pack from `runtime/starter/checks/` into the new project's `runtime/content/checks/`** (the agnostic default library seeds the content ring; §3).
2. `runtime watch --on=commit` wires the cheap invariants to a commit hook (`onTrigger`) — enforcement is live immediately, before a single domain check exists.
3. `runtime next` gives the planner; the first item authored gets a scope-gate and a ship gate for free.
4. `runtime mint` (SPEC 2) opens the backward edge — the *first* domain check is minted from the *first* real lesson, not authored cold.

The wedge is that the starter pack **enforces structural properties from commit #1** (single-active, scope-gate, broken-link, unsafe-cast) — value before the content ring is authored. The differentiated half then accrues at the rate of ratified mints (VISION REVIEW A2, honestly slow), but the adopter is never at zero.

---

## 14. The operational surface (VISION §15.6 — render, or also run?)

**Decision — the operational surface both renders derived state AND runs floor-gated ops through the single executor + adapter. (Recommended.)**

The open question is whether the developer-facing view merely *renders* state or also *runs* operations. Two options:

| Option | What it is | Reuse verdict |
|---|---|---|
| A — read-only renderer | a view that renders the derived surface (active item, ranked queue + `impact`, open findings, floor-pending, provenance) | a **second, divergent** surface that must re-derive state — drifts from the engine |
| **B — view + executor (Recommended)** | the same renderer **plus** action affordances that dispatch **through `runProcedure`/`ask`/`execute`** — every mutating action is a floor-gated op through the *same* capabilities the CLI uses | **one executor, one floor, one journal** — the view *cannot* drift from the engine because it *calls* the engine |

**Reuse rationale (the tie-break, and the primary objective).** Option B reuses the capability seam (§4) as the operational surface's *only* mutation path: a "ship this item" button is a `runProcedure('worker.ship', {item})` call; a floor prompt is an `ask(decision)` rendered as a widget; a resume is `journal.read` + replay (§5). There is no second write path to keep consistent — the view renders `planNext`/`computeImpact`/`findByScope` output and mutates only through the six interfaces. A read-only renderer (Option A) would be a divergent surface that re-derives state and can silently disagree with the engine — exactly the drift the Runtime exists to fight. Reusability breaks the tie decisively toward B (CLAUDE.md Hard Constraints; `feedback_recommend_reusable_patterns`).

**Specification (Option B):**
- **Render (read-only, derived):** `active` item; the `ranked` queue with per-item `impact` (§8.2); open `Finding`s (§6); floor-pending decisions (`journal` `awaiting` steps, §5); enforcement provenance (each check's `Provenance`, SPEC 1 §4). All computed at read time — the view stores nothing.
- **Run (floor-gated, through the seam):** every mutating affordance dispatches through `runProcedure`/`execute`; every irreversible/outward act surfaces as an `ask(decision)` widget with a `recommended` option and **no self-merge option** (§4.3). The journal makes every dispatched op resumable.
- **Legibility (law §13.9):** the developer can always see active / queued-and-why / open-findings / floor-pending / enforcement-and-why, and can interject at any point — the decision-bearing spine stays visible (VISION §13.9).

---

## 15. Validation strategy (TDD scenarios)

Ring-1 forward-edge helpers + the capability seam are pure logic + typed contracts — so validation is **deterministic `node --test`** at the golden-gate layer, plus the harness's own regression on the procedures (§11). Distinguish: this spec's teeth are the golden gates below; the *procedure-level* proof (does the whole worker/orchestrator run correctly under the capabilities) is the `benchmark-backlog` corpus (§11), whose deterministic golden + call-log/state planes bite and whose judge layer is honestly partial.

Each scenario is `given / when / then`; assertions pin **outcomes and named guarantees**, positive **and** negative.

**A. `journal` — idempotent replay & resume ×6**

1. *given* a fresh `runId` · *when* the procedure runs a `keyed-effect` step once · *then* the ledger has one `complete` record; the effect ran once.
2. *given* a `runId` whose ledger already records step `E1.promote` as `complete` · *when* the procedure re-runs (resume) · *then* `journal.step('E1.promote', fn)` returns the recorded value and **`fn` is NOT invoked** (no double-promote — the F-scenario the current save-point model risks).
3. *given* a `pure-rederive` step (member selection) · *when* resume · *then* it recomputes from frontmatter and is **never ledgered** (replay is free).
4. *given* a ledger whose **final line is torn** (crash mid-append) · *when* `journal.read` · *then* the torn tail is dropped, all prior `complete` steps survive, **no throw** (tail-heal — generalizes `parseRunState` F-11; shrinks `resume-corrupt-stop`).
5. *given* a parked `ask` (`awaiting`) whose `Choice` was `fulfil`'d · *when* resume · *then* replay reaches the decision point and continues with the recorded choice — the human is **not** re-asked (§4.3).
6. *given* a resume where HEAD moved since the recorded `E6.batched-e2e` sha · *when* the ship gate reads e2e freshness · *then* it forces a return to E6 (`e2eIsFresh` false — F-14 kept).

**B. `scope-gate` — distraction closed structurally ×4**

1. *given* an active item with `scope: ["services/foo/**"]` and a diff touching only `services/foo/bar.ts` · *when* `scopeGate` · *then* `withinScope: true`, `escapes: []`, exit 0 (in-scope — positive).
2. *given* the same item and a diff also touching `services/baz/qux.ts` · *when* `scopeGate` · *then* `withinScope: false`, one `inconsistency` `Finding` naming the escaped path, exit 1 (**the gate bites** — the failure-mode-3 closure).
3. *given* two items in `status: active` · *when* `scopeGate` · *then* exit 1 (single-active also asserted — reuses lint rule 2's property).
4. *given* the scope-gate check entry · *when* `metaCheck` · *then* it passes the cheap-by-construction assertion (`contexts` includes `invariant` ⇒ `cost_tier: cheap`) — negative: a mis-declared `expensive` scope-gate would file an `inconsistency` (SPEC 1 §8).

**C. `runWatch` — cadence tiering & scoped-wake/global-safety ×5**

1. *given* a `commit` trigger (`cost_ceiling: cheap`) and a `cheap` global invariant whose scope does **not** overlap the changed files · *when* `runWatch` · *then* the invariant **fires anyway** (global invariants always ride the wake — tension (b) positive).
2. *given* a `commit` trigger and an `expensive` audit · *when* `runWatch` · *then* the audit does **not** fire (`cost_ceiling` refuses it — deferred to the epic boundary; negative).
3. *given* an `epic-pre-done` trigger (`cost_ceiling: expensive`) · *when* `runWatch` · *then* the live-e2e/heavy-judgment audits fire **once** (grounding: E6 batched-once).
4. *given* a `schedule` trigger (`cost_ceiling: moderate`) · *when* `runWatch` · *then* `moderate` audits (`read-model-drift`, `card-drift`) fire; `expensive` ones do not.
5. *given* a check that raises a finding · *when* `run-watch.mjs` CLI · *then* **exit 1** (fails loudly); a clean run → **exit 0** — and *exit 0 ≠ pass* is enforced by the finding count, not the child exit code.

**D. `intake` — the router & item shape ×4**

1. *given* a finding thematically near the active epic whose undone state falsifies a `done_when` clause · *when* `intake` · *then* `route: 'fold'`, one item, `epic_role: 'core'` (default-core when load-bearing — positive).
2. *given* a finding sharing a root cause with 2 parking orphans · *when* `intake` · *then* `route: 'mint-aggregation'`, an epic suggested (grounding: `add-mint-aggregation` scenario).
3. *given* a finding whose sub-parts split across the closure verdict · *when* `intake` · *then* `route: 'split'`, **many** items (atomicity — never one mixed item).
4. *given* an already-covered false-positive finding · *when* `intake` · *then* `route: 'discard'`, **zero** items (logged, no write — negative).

Run: `node --test runtime/engine/test/*.test.mjs` (ring-1 golden gates) + the `benchmark-backlog` corpus for procedure-level regression (§11). All ring-1 gates deterministic; the live/judgment coverage is the harness's, honestly partial (§11.2).

---

## 16. Out of scope

**In scope (this spec):** the six capability interfaces + the `<<HARNESS-PAUSE>>` sentinel protocol; the `journal` idempotency contract (keying, step strategies, resume-as-replay); the watch engine + trigger-config schema + cost→cadence reconciliation; intake's decision contract + router; the planner's `next`/`rank`/read-time `impact`; the execution worker + orchestrator behind the capabilities; the scope-gate as a concrete `CheckEntry`; the gates in `gate` context; the eval harness's four-layer/three-plane structure + the SPEC 2 handoff seam; the no-lost-value equivalence map (forward-edge + capability rows); the starter check library + on-ramp; the operational surface recommendation.

**Out of scope (owned elsewhere):**

- **The check-entry schema, the four kinds, the three contexts, the lifecycle state machine, the meta-check, and the ring-1 helpers** (`loadRegistry`/`resolveEvaluator`/`runCheck`/`metaCheck`/`findByScope`/`advanceLifecycle`). → **SPEC 1** (consumed verbatim; §4/§7/§10/§11). This spec *uses* them; it does not re-shape them.
- **The starter-check `Provenance` convention** — the reserved `minted_by: "starter-pack"` sentinel + the "starter checks ship pre-ratified" note (§13). **Absorbed into SPEC 1 §15 (re-freeze delta 3)** — SPEC 1's frozen `Provenance` now carries the sentinel; this spec consumes it verbatim (§9.2/§13) rather than re-shaping SPEC 1's semantics.
- **The backward edge — mint/curate procedures, the floor presentation of a candidate check, lesson `mints:` reconciliation, minting-vs-judgment heuristics, and the *authoring + calibration* of a minted check's eval scenario.** → **SPEC 2.** This spec owns only where a minted scenario *lands* (§11.3) and the `ask`/`journal` seam the floor drives.
- **Migrating the 34 live surfaces into YAML, physically relocating `tools/*-exclusions.json`, and porting the `backlog-*` prose into ring-1 helpers.** That is realization/implementation, not this design.
- **Building the Claude Code adapter's concrete bindings** (the `runtime/adapters/claude-code/*.mjs` bodies). This spec fixes their *contract* (§4); the plan builds them.
- **A second host adapter** (proving harness-fungibility on a non-Claude-Code host). Deferred until the first adapter + content ring are dogfooded.
- **Product name.**

---

## 17. Build sequence / dependencies

This spec depends on SPEC 1's frozen contract and is built **after** it; it is built **alongside/after** SPEC 2 (the moat is proven first — SPEC REVIEW C3). Build order:

1. **SPEC 1 — schema & ring-1 helpers** (done; frozen). Nothing here typechecks without it.
2. **SPEC 2 — the backward edge, proven first on ~5 real lessons.** Independent of this spec's forward-edge helpers except for the shared `ask`/`journal` seam (§4/§5) and the eval-scenario home (§11.3), which this spec's contract fixes.
3. **SPEC 3 (this) — forward edge & capability seams.** Build inside-out:
   1. **The capability contract** (`runtime/engine/capabilities/index.ts`, §4) — types first; everything else compiles against it.
   2. **The `journal` contract** (`runtime/engine/lib/journal.mjs`, §5) — the idempotent step + resume-as-replay, with TDD block A. Generalize `runstate.mjs`/`resume-gate.mjs` behind it (equivalence map §12).
   3. **The forward-edge helpers** — `run-watch.mjs` (§6), `intake.mjs` (§7), `plan-next.mjs` (§8), `scope-gate.mjs` + `run-gate.mjs` (§9/§10) — each pure core + thin `main()`, with TDD blocks B/C/D. All reuse SPEC 1's `findByScope`/`runCheck`.
   4. **The worker + orchestrator spine** (`runtime/engine/loop/*.mjs`, §9) — calling *only* the capabilities.
   5. **The first adapter** (`runtime/adapters/claude-code/*.mjs`, §4) — bind each capability to its maximal Claude Code primitive; degrade `ask` to the sentinel (§4.3).
   6. **The eval harness carry-forward** (§11) — the `defineSuite` seam + the SPEC 2 scenario-home seam.
   7. **The starter pack + on-ramp** (§13) and **the operational surface** (§14, Option B).

## 18. Re-freeze delta — 2026-07-03 (runtime-seam-probe)

Contract deltas from the red-team + seam probe (full rationale:
`docs/superpowers/specs/2026-07-03-runtime-seam-probe-design.md`):
`TaskResult` is a discriminated union (paused REQUIRES `decision`); `Task` gains `choices`/`locus`;
`Summary` gains `findings`/`paused`/`decision` (the §4.2 bubbling carrier); `RunMeta.branch/worktree`
optional; `journal.step` parks a paused TaskResult as `awaiting` under the STEP key (park-not-complete;
fulfilling = completing the key); floor asks run through `askStep` (replay a fulfilled Choice; park a
PAUSE; `recordWhen` gates durable recording so 'hold' re-asks); gates are CHECKS (never `step()`ed —
re-run each wake, `record()` evidence; the sha-conditional e2e batch is the deliberate exception);
judgment derives from the DECLARED `runProcedure` (`deriveJudge`) — no seventh capability; `gitHeadSha`
is not a capability. §4.3's protocol is now the *interactive* binding too: the driver
(`adapters/claude-code/run-item.mjs`) parks, the session performs/fulfils, replay advances.

**Dependency rule:** ring-1 (this spec's helpers + the capability *types*) **never depends outward** — not on any adapter (`runtime/adapters/**`) and not on any project content (`runtime/content/**`). If the realization needs a schema change, it comes *back* to SPEC 1 and re-freezes the contract; this spec pins the frozen block and does not re-shape it unilaterally.

**Fulfil-key convention.** Always fulfil by the pending record's `key` (as printed in `pending[].key`), never by the bubbled `decision.id` — they coincide for a worker's execute-park (`execute:<id>`) but differ for an epic member park (journal key `member.<id>` vs. the adapter's decision id `execute:<id>`).
