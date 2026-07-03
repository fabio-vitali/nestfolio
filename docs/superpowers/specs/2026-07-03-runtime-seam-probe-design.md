# Runtime seam probe — p1 contract re-freeze + loop-driven tail (design)

**Workstream:** `runtime-seam-probe` (P1a of the `runtime-operationalization` probes-first roadmap)
**Inputs:** `runtime-design-redteam` verdict (solid-with-deltas, 2026-07-03) — p1 delta list; SPEC 3
§4/§4.3/§5 (the frozen contract this re-freezes); the shipped code under `runtime/engine/**`.
**Decision record:** three user-decided forks — probe shape = **loop-driven tail**; pause contract =
**pure-data seam**; judge = **via `runProcedure`** (no seventh capability).

---

## 1. Problem

The red-team confirmed that SPEC 3 §4.3's pause protocol ("a pause is a journaled `awaiting` step whose
Choice back-fills on the next wake") is **structurally unexpressible** through the built seam:

- `TaskResult` (`engine/capabilities/index.ts`) carries no `Decision` for a pause arising inside
  `execute`; `Task` has no resume input; `journal.step` records a paused result as `complete` — a paused
  epic member **wedges permanently** (replay returns the stale pause forever); an unjournaled paused
  worker **re-runs every side effect** on resume.
- `journal.awaiting`/`fulfil` have zero production callers — `<<HARNESS-PAUSE>>` is a sentinel with no
  receiver.
- Gate results are journaled as keyed effects under a stable runId — a **failed gate replays failed
  forever**; a re-run of a shipped item **silently bypasses both gates**. (Category error: a gate is a
  check, not an effect.)
- The spines read undeclared `capabilities.judge` / `capabilities.gitHeadSha` — a contract-conformant
  host fails every judgment check closed, permanently blocking epic-pre-done.
- `Summary` cannot carry `findings` or `paused` — §4.2's own bubbling rule has no carrier; fanned-out
  breadth work cannot feed intake.
- The worker hardcodes `feat/<id>`/`.wt/<id>` and ignores its own ship/hold answer.

This workstream re-freezes the contract to honor §4.3/§5 as written, implements it, and **proves it by
driving a real workstream tail through `runWorker`** with real gates, a real floor ask, and
resume-as-replay exercised on every step.

## 2. The key insight — park/fulfil IS the interactive binding

A node process cannot invoke AskUserQuestion, and cannot "call the session" to perform work. So in the
Claude Code host, the pause protocol is not merely the headless degradation — it is **the mechanization
of the interactive binding itself**:

> The loop driver runs as a short-lived process. When it reaches work or a decision it cannot perform
> (`execute` with no programmatic runner; any `ask`), it **parks** a durable `awaiting` record and
> exits. The session performs the work / surfaces the real AskUserQuestion, **fulfils** the record, and
> re-drives. Replay short-circuits every completed step; the first unfulfilled park is the next thing
> that happens.

Interactive = fast park/fulfil cycles driven by the session; headless = the same parks, awaiting a
human indefinitely. **One mechanism, two tempos.** This validates the pure-data pause contract: choices
are replay inputs (data), never callbacks — callbacks don't serialize, data replays. Every re-drive in
the probe run is a live resume-as-replay proof.

## 3. Contract re-freeze (ring-1 — `engine/capabilities/index.ts`)

```ts
export interface Task {
  id: string;
  prompt: string;
  scope: string[];
  procedure?: string;
  payload?: unknown;
  choices?: Choice[];                                  // NEW — fulfilled floor answers from prior wakes
  locus?: { branch?: string; worktree?: string };      // NEW — execution locus; no more hardcoding
}

export type TaskResult =                               // NEW — discriminated union
  | { taskId: string; status: 'done' | 'failed'; summary: string; findings?: Finding[] }
  | { taskId: string; status: 'paused'; summary: string; decision: Decision };

export interface Summary {                             // fanOut result — still transcript-free
  taskId: string;
  status: 'done' | 'failed' | 'paused';                // NEW — 'paused' bubbles, never answers inline
  summary: string;
  findings?: Finding[];                                // NEW — §4.2 bubbling rule's carrier
  decision?: Decision;                                 // NEW — present iff paused (bubbled to the spine)
}
```

- **`Capabilities` stays exactly six.** The spine derives its internal judge from the declared
  `runProcedure`: a `skill:<name>` evaluator runs as `runProcedure(name, { check, context })` and the
  findings return in `TaskResult.findings`. `resolveEvaluator`'s injected `judge` fn param is unchanged
  (ring-1 internal seam); only its *supplier* changes.
- **`gitHeadSha` stops being a pseudo-capability**: plain import from `journal.mjs` in the spines,
  test-injectable via an options parameter, never read off `capabilities`.
- **`RunMeta.branch`/`worktree` become optional** (journal.schema.ts) — "no worktree" is representable;
  the worker derives RunMeta from `item` + `task.locus`. `lane` is **deferred to P5** (YAGNI — noted so
  the re-plat member re-raises it).

## 4. Journal semantics (`engine/lib/journal.mjs` + `engine/schema/journal.schema.ts`)

1. **Park-not-complete, fulfil-is-completion (one uniform rule).** `step()` recognizes a paused
   `TaskResult` via an exported guard `isPaused(v)` (`v?.status === 'paused' && v?.decision?.id`). On a
   parked value it appends `{ key: <decision.id>, status: 'awaiting', decision }` and returns the value
   **without writing a `complete` record** — so replay re-parks/re-invokes until fulfilled.
   **Fulfilling a park = completing its key**: `fulfil(runId, key, value)` appends the `complete`
   record under the parked key, and the next replay's `step()` short-circuits on it. This is uniform
   across park kinds: an **ask-park** (the spine journals every floor ask as
   `step(runId, decision.id, () => ask(decision))`) is fulfilled with a `Choice`; an **execute-park**
   (the adapter's no-runner mode, keyed `execute:<task.id>`) is fulfilled with the performed work's
   `TaskResult`. Pure helpers: `pendingDecisions(ledger)` (awaiting records with no later completion)
   and `fulfilledChoices(ledger)` (the Choice records the spine threads into `Task.choices` for
   decisions that arose INSIDE a prior execute — the pure-data resume input for future mid-task
   pauses; exercised by unit test, trivially in the probe).
2. **Gates are checks, not effects.** The spines stop wrapping gate runs in `step()`. Gates re-run on
   every wake; their evidence is recorded via `record(runId, 'gate.<boundary>', { sha, passed,
   findings })` for legibility (append-only history in the file; last-write-wins on read). The
   epic-pre-done expensive batch keeps its existing sha-conditional `e2eIsFresh` mechanism — that one
   is *deliberately* recorded, keyed by sha, because it is expensive; cheap gates are not.
3. **Out of scope here** (owned by `runtime-redteam-hardening`): atomic `meta.json` writes, guarded
   parse, cross-process locking, ledger GC.

## 5. Spine + adapter + driver

- **Worker** (`engine/loop/worker.mjs`): RunMeta from `item` + `locus`; `execute` wrapped in a pausable
  `step()` (paused → parked; done → completed and replay-safe; a fulfilled execute-park short-circuits
  as the recorded `TaskResult`); `Task.choices` populated from `fulfilledChoices(ledger)` on every
  invocation; the ship ask journaled as `step(runId, decision.id, () => ask(decision))` and made
  honest — `choice.value === 'ship'` → `done`; `'hold'` or the PAUSE sentinel → `paused` with the
  decision parked. The worker still never performs the merge/ship itself (design law: the human does).
- **Orchestrator** (`engine/loop/orchestrator.mjs`): member steps get the same pausable treatment (a
  paused member parks and the epic run returns `paused`; a fulfilled choice re-invokes the member with
  `choices` — the wedge regression test). The merge ask gets the same ship/hold/pause honesty.
  `gitHeadSha` via import/options.
- **Adapter** (`adapters/claude-code/`): `makeExecute({ runner })` with **no runner now parks the
  Task** — it returns `paused` with a Task-shaped `Decision` (id = `execute:<task.id>`), instead of
  lying `done`. `makeFanOut` maps sub-results to the new `Summary` (findings bubble; a paused sub-task
  bubbles as `paused`, never answered in isolation). `makeAsk` unchanged (interactive passthrough /
  PAUSE sentinel).
- **Driver** (`engine/loop/run-item.mjs`, NEW, house module conventions): thin CLI —
  `node runtime/engine/loop/run-item.mjs <item-id> [--fulfil <key> --value <json>]` — loads the item
  from `docs/backlog` frontmatter, assembles `makeClaudeCodeCapabilities` with the git-native journal,
  invokes `runWorker`, prints the result + any pending decision as JSON, exit 0 done / 3 paused /
  1 failed / 2 usage. The session drives it repeatedly; `--fulfil` completes a parked key (a `Choice`
  for ask-parks, a `TaskResult` for execute-parks) before re-driving. (Ring-1 file; reads the config-declared backlog dir — the
  hardcoded-default question stays with `runtime-redteam-hardening`'s rebind-surface fix.)
- **Re-freeze record:** append a dated delta section to SPEC 3 (after §17) summarizing the §3/§4
  changes with a pointer to this design doc; add a one-line pointer in SPEC 1 §15. Ships in this PR
  (source + derived together).

## 6. The probe run (loop-driven tail — the validation)

Executed after the build is green on this branch, as the workstream's closing evidence:

1. `node runtime/engine/loop/run-item.mjs runtime-seam-probe` → begin + start-gate run live →
   `execute` parks (no programmatic runner). **Resume proof #1**: re-run the driver, observe replay
   (no duplicate begin, gates re-run, same park pending).
2. The session performs the **real victim fix** as the execute payload — `no-agent-result-fallback-
   check-overbroad`: scope `tools/check-no-agent-result-fallback.mjs` to AgentCore/orchestrator-result
   fallbacks only (per its filed property), update golden fixtures + the content-ring YAML — commits on
   this branch, then fulfils `execute:runtime-seam-probe` with a `done` TaskResult.
3. Re-drive → execute replays complete → ship-gate runs live over the branch → the ship ask parks.
4. **The floor**: the parked decision is surfaced to the user as a real AskUserQuestion ("Ship item
   runtime-seam-probe?" — ship/hold, one recommended). The choice is fulfilled via `--fulfil`;
   re-drive → `done`. A `hold` answer is also exercised once first (parks again → paused) so both
   branches are proven.
5. Evidence collected into the backlog file's `validation_gate`: the journal directory listing +
   key sequence, the driver's exit codes per phase, the gate `record` entries, and the contract-gap
   list (deliverable 3) — every place the seam still proved too thin, filed as p-deltas (or "none").
6. The victim member `no-agent-result-fallback-check-overbroad` → `status: shipped` in the same PR,
   `validation_gate` cross-referencing this run.

## 7. Testing (TDD, `node:test` + tsc, Tier-0 — no deploy, no e2e)

New/updated units (worktree gate: `node --test` globs + `npx tsc --noEmit -p runtime/tsconfig.json`):

- journal: park-not-complete (paused TaskResult → awaiting under decision id, step key absent);
  fulfil → `fulfilledChoices` threading; replay-with-choice re-invokes fn with the answer available;
  `pendingDecisions` derivation; gates absent from step ledger.
- worker: **failed-gate-re-runs-after-fix** (the replay-forever regression); shipped-item re-run
  re-verifies gates; ship/hold/sentinel → done/paused/paused honesty; locus threading into RunMeta;
  choices reach the Task.
- orchestrator: **the paused-member wedge regression** (red-team scenario A: member pauses → fulfil →
  re-drive resumes the member with the choice, epic completes); merge-ask honesty (no `done` on an
  unanswered merge).
- judge derivation: a `skill:` evaluator invokes `runProcedure` and maps `TaskResult.findings`; a host
  without a matching procedure fails closed with a gap finding (existing behavior, new supplier).
- adapter: park-on-execute; Summary findings/paused bubbling.
- driver: FRESH → parks execute; `--fulfil` + re-drive advances; exit codes.

Existing 187 tests stay green (shapes updated freely — no-deprecation applies; breaking changes free).

## 8. Out of scope

- The work-driver re-platform of the backlog skills (P5, `runtime-work-driver-replatform`) — this
  probe drives ONE workstream tail; `lane` semantics deferred there.
- Backward-edge procedural fixes — torn curate, successor guarantees, floor visibility, key epochs
  (`runtime-backward-edge-live`, P2).
- Mechanical hardening — fail-closed registry, ACMR, atomic meta.json, journal locking,
  registry-integrity CLI, single-active semantics, starter-pack self-containment, rebind surface
  (`runtime-redteam-hardening`, P2).
- Check migration, judge cadence (a live scheduled judge), operator surface, parity harness.
- A second-host adapter (portability proof lands with the adoption e2e).
