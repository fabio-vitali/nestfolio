# Runtime SPEC 3 — Forward Edge & Capability Seams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ring-1's **forward edge** (watch → intake → planner → execution → gates), the **six capability interfaces** (the harness seam), the **`journal` idempotency contract**, unify SPEC 2's backward edge onto that formal seam, carry the eval harness forward through the live `defineSuite` seam, ship the project-agnostic **starter check library**, and **discharge the no-lost-value equivalence map** — all TDD-first, all against the *merged* SPEC 1 + SPEC 2 contract.

**Architecture:** Three concentric rings (VISION §12). **Ring 1** (`runtime/engine/**`) is pure and project-/harness-agnostic — it imports the six capability *types* (`capabilities/index.ts`) and nothing else about its host. **Ring 2** (`runtime/adapters/claude-code/**`) binds each capability to its maximal Claude Code primitive. **Ring 3** (`runtime/content/**`, `runtime/eval/**`) is Nestfolio's project content. The forward-edge helpers reuse SPEC 1's `loadRegistry`/`findByScope`/`runCheck`/`metaCheck`/`advanceLifecycle` **verbatim**; the `journal` generalizes today's `runstate.mjs`/`resume-gate.mjs` (a fresh git-native NDJSON impl — ring-1 cannot import `.claude/skills/**`); SPEC 2's backward edge migrates onto the formal `ask`/`journal` seam (decided fork Q1 — the strict-superset made literal). The decision-bearing spine stays inline and visible; `fanOut` returns summaries, never transcripts.

**Tech Stack:** Node ≥24 native TS type-stripping (zero build); `.ts` zod schemas (`zod` + `z.infer`, single source of truth) imported by `.mjs` helpers with the explicit `.ts` extension; `node:test` + `node:assert/strict`; `yaml` (parse/stringify); nx `run-commands` targets (`runtime:test`, `runtime:typecheck`). No bundler, no transpile step.

## Global Constraints

- **Node ≥24, zero build.** Schemas are `.ts` (zod validator + `z.infer` = single source of truth); helpers/tests are `.mjs` importing schemas with the explicit `.ts` extension. Ring-1 runs via `node --test`; the `.ts` contract gate is `tsc --noEmit -p runtime/tsconfig.json`. Portability floor: Node ≥23.6. (SPEC 1 §15 realization clarification 1.)
- **The one dependency rule (seam #1).** Ring-1 (`runtime/engine/**`) imports the six capability *types* from `runtime/engine/capabilities/index.ts` and **nothing** from `runtime/adapters/**` or `runtime/content/**`. A ring-1 file importing a host primitive (a `@anthropic` skill, `execSync('claude …')`, a subagent handle, `.claude/skills/**`) is a seam violation the meta-check surfaces (§G, the ring-1 import-boundary check). (SPEC 3 §3, §4.1.)
- **`fanOut` returns summaries, never transcripts (the Tier-2 scar).** Any code path surfacing a human decision from inside a `fanOut` task is a violation; a decision bubbles to the inline spine as a `Finding`/`paused` result. (SPEC 3 §4.2; `feedback_no_worker_isolating_subagents`.)
- **The floor is a real `Decision`, never a prose "your call".** `ask` always carries options with **exactly one** `recommended:true`; **no option ever runs a merge/irreversible act** — the human performs those. Under headless (`claude -p`, no AskUserQuestion) `ask` degrades to the `<<HARNESS-PAUSE: reason>>` sentinel as the final line (§4.3). (SPEC 3 §4.3; LESSONS F-7/F-33.)
- **`exit 0 ≠ pass`.** Every gate reads the **finding/collected count**, never a bare child exit code. `passed = findings.length === 0 && ran === true`. (SPEC 3 §10; `feedback_e2e_nx_wrapper_strips_quotes`, `feedback_pipe_masks_exit_code`.)
- **Derive, don't store.** `impact`/`blocks`/`freshness` are recomputed at read time; the only stored priority knob is `rank`, itself validated by an active check. Any persisted priority is a law §13.2 violation the meta-check files. (SPEC 3 §8.)
- **Consume SPEC 1 frozen, do not re-shape.** The enums (`FindingKind·CostTier·Context·CheckStatus·EvaluatorKind`), the `CheckEntry·Provenance·FlakeContract·Finding·Item` shapes, and the six helpers are frozen. If the build needs a schema change it goes **back** to SPEC 1 §15 and re-freezes (Phase J); this plan pins the frozen block and does not re-shape it unilaterally. (SPEC 3 §7, §17.)
- **TDD, frequent commits.** Every task is failing-test → run-red → minimal-impl → run-green → commit. Worktree commits use `git commit --no-verify` (the pre-commit hook silently rejects worktree commits) and are verified with `git log --oneline -1` (never trust an echo). (`feedback_worktree_commit_no_verify`.)
- **Tier-0, no deploy.** `runtime/**` never deploys to AWS; validation is `node --test` + `tsc --noEmit` + the `benchmark-backlog` corpus. No integration/e2e/Playwright gates apply.

---

## File Structure

**Ring 1 — pure engine (`runtime/engine/`)** — CREATE:
- `capabilities/index.ts` — the six interfaces (TYPES ONLY): `Task·TaskResult·Summary·Decision·DecisionOption·Choice·TriggerEvent·TriggerSpec·Unsubscribe·Capabilities` + re-export `Journal` (§4.1).
- `schema/journal.schema.ts` — `RunId·StepKey·Json·StepStrategy·RunMeta·StepRecord·RunLedger·Journal` (§5). Imported by both `capabilities/index.ts` and `lib/journal.mjs` (defined once).
- `lib/journal.mjs` — the git-native, append-only, keyed NDJSON journal implementing `Journal` (begin/step/record/read/awaiting/fulfil) + tail-heal + resume-as-replay (§5).
- `lib/run-watch.mjs` — the watch engine: `runWatch({registry, trigger, changedScope, capabilities})→Finding[]`, completes partial `runCheck` findings (§6).
- `lib/intake.mjs` — `intake({finding, registry, backlog, capabilities})→Promise<IntakeDecision>`; `selectRoute` (judgment via `execute`) → `shapeItems` (pure) (§7).
- `lib/plan-next.mjs` — `planNext({backlog, registry, env})`, `renderIndex({backlog, registry})`, `computeImpact({item, backlog, registry, blastOf})` (§8).
- `lib/scope-gate.mjs` — `scopeGate({activeItem, diffPaths})→{withinScope, escapes, findings}` (§9.2).
- `lib/run-gate.mjs` — `runGate({registry, boundary, item, env})→{passed, findings}` (§10).
- `loop/worker.mjs` — the single-item spine; calls capabilities only (§9.1).
- `loop/orchestrator.mjs` — the epic spine; calls capabilities only (§9.3).
- `lib/find-by-scope.mjs`, `run-check.mjs`, `load-registry.mjs`, `meta-check.mjs`, `advance-lifecycle.mjs`, `glob-overlap.mjs`, `fs-walk.mjs`, `errors.mjs` — SPEC 1, consumed **verbatim** (a few gain new *exports*/errors, never reshaped).

**Ring 1 — backward edge (`runtime/engine/backward/`)** — MODIFY (fork Q1, unify onto the formal seam):
- `lib/capabilities.mjs` — reimplement `inMemoryJournal()` as a formal in-memory `Journal`; keep `headlessAsk` as the headless `ask(Decision)→Choice`-shaped default (now returning a pause marker, not the ad-hoc `{sentinel}`).
- `lib/present-floor.mjs` — the BRIDGE: build a formal `Decision` from the domain `FloorChoice`, call `ask(decision)`, map `Choice.value`→`{selected, sentinel}` (callers' return shape preserved).
- `lib/mint.mjs`, `curate.mjs`, `register-ratified.mjs`, `curate-guard.mjs` — migrate the `journal.has/get/record(key,decision)` idempotency pattern onto `journal.step(runId, key, fn)`.
- `test/*.test.mjs` — update capability injections to the formal shapes; all stay green (regression).

**Ring 2 — the Claude Code adapter (`runtime/adapters/claude-code/`)** — CREATE:
- `execute.mjs`, `fan-out.mjs`, `ask.mjs`, `on-trigger.mjs`, `run-procedure.mjs`, `journal.mjs` — bind each capability (§4, right column).
- `index.mjs` — assemble the `Capabilities` object (interactive `ask` + git-native `journal`).
- `test/*.test.mjs` — adapter TDD (incl. the `<<HARNESS-PAUSE>>` degradation).

**Ring-1-adjacent — the starter pack (`runtime/starter/`)** — CREATE:
- `checks/registry-integrity.yaml`, `active-item-scope-gate.yaml`, `single-active.yaml`, `references-valid.yaml`, `index-fresh.yaml`, `no-unsafe-casts.yaml` — the 6 project-agnostic structural checks (§13).

**Ring 3 — content (`runtime/content/`)** — CREATE:
- `triggers.yaml` — the watch-engine cadence config (§6.1).

**Eval carry-forward (`scripts/benchmark-backlog/`)** — MODIFY:
- `suite.mjs` — make `defineSuite` real (add the `stubs` producer); `run.mjs` routes through it (§11.3).
- `structural-lint.mjs` — document/reconcile the shape-vs-runtime split (§11.2).

**Config / wiring** — MODIFY:
- `runtime/runtime.config.json` — add `triggersFile: "runtime/content/triggers.yaml"`.
- `runtime/tsconfig.json` — add `engine/capabilities/**/*.ts` + `engine/schema/journal.schema.ts` to `include`.
- `runtime/project.json` — extend the `test` glob to cover `engine/loop/test` + `adapters/**/test`.
- `runtime/README.md` — forward-edge + seam docs.
- `docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md` — re-freeze any §15 delta the build surfaces (Phase J).

**Out of scope (mirrors the backlog file + epic):** the operational surface §14 UI (fork Q2 — deferred; filed via `backlog-add` at close); a second host adapter; the full 34-surface content-ring migration + the full production cutover of the live `backlog-*` skills onto the ring-1 spine; re-litigating the frozen specs (contract changes only re-freeze via SPEC 1 §15).

---

## Phase A — Infra & wiring

### Task A1: Wire the new ring-1 subtrees into nx test + typecheck + tsconfig + config

**Files:**
- Modify: `runtime/project.json` (the `test` command glob)
- Modify: `runtime/tsconfig.json` (`include`)
- Modify: `runtime/runtime.config.json` (add `triggersFile`)
- Create: `runtime/content/triggers.yaml`

**Interfaces:**
- Consumes: nothing (pure wiring).
- Produces: the `runtime:test` target now discovers `runtime/engine/test/*.test.mjs` + `runtime/engine/backward/test/*.test.mjs` + `runtime/adapters/**/test/*.test.mjs`; `runtime:typecheck` includes the new `.ts` contracts; `runtime.config.json` exposes `triggersFile`.

- [ ] **Step 1: Write the failing test** — a config/wiring guard so the nx globs and config keys can't silently drift.

Create `runtime/engine/test/wiring.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('runtime.config.json carries the triggersFile binding', () => {
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  assert.equal(cfg.checksDir, 'runtime/content/checks');
  assert.equal(cfg.triggersFile, 'runtime/content/triggers.yaml');
});

test('project.json test target discovers loop + adapter test trees', () => {
  const proj = JSON.parse(readFileSync('runtime/project.json', 'utf8'));
  const cmd = proj.targets.test.options.command;
  assert.match(cmd, /engine\/loop\/test\/\*\.test\.mjs/);
  assert.match(cmd, /adapters\/\*\*\/test\/\*\.test\.mjs/);
});

test('tsconfig includes the capability + journal .ts contracts', () => {
  const ts = JSON.parse(readFileSync('runtime/tsconfig.json', 'utf8'));
  assert.ok(ts.include.some((g) => g.includes('capabilities')));
  assert.ok(ts.include.some((g) => g.includes('journal.schema')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/wiring.test.mjs`
Expected: FAIL — `triggersFile` undefined; command lacks the new globs; include lacks capabilities/journal.

- [ ] **Step 3: Apply the wiring**

`runtime/runtime.config.json` — add the key (keep the established name `runtime.config.json`; the spec's `registry.config.json` is a rename we decline — the file is already referenced by `project.json` and every helper takes `checksDir` directly):

```json
{
  "checksDir": "runtime/content/checks",
  "exclusionsRoot": "runtime/content/exclusions",
  "triggersFile": "runtime/content/triggers.yaml"
}
```

`runtime/project.json` — extend ONLY the `test` command (leave `inputs`/`cache` intact, add the two globs):

```json
"command": "node --test runtime/engine/test/*.test.mjs runtime/engine/backward/test/*.test.mjs runtime/engine/loop/test/*.test.mjs runtime/adapters/**/test/*.test.mjs"
```

Also add `"{projectRoot}/adapters/**/*"` to the `test` target `inputs` array (so adapter edits bust the cache).

`runtime/tsconfig.json` — extend `include`:

```json
"include": ["engine/schema/**/*.ts", "engine/backward/schema/**/*.ts", "engine/capabilities/**/*.ts"]
```

(`engine/schema/**/*.ts` already covers `journal.schema.ts`; `engine/capabilities/**/*.ts` adds the new contract. The test asserts both patterns are present — `journal.schema` is matched by the existing `engine/schema/**` glob, so also add an explicit `"engine/schema/journal.schema.ts"`? No — keep globs; update the test to check the covering glob. Adjust the tsconfig test assertion to `ts.include.some(g => g.includes('schema'))` for journal, which the existing glob satisfies.)

Create `runtime/content/triggers.yaml` (§6.1) — the cadence config; itself a checked knob:

```yaml
# runtime/content/triggers.yaml — watch-engine cadence config (content ring, seam #2).
# Itself a stored knob ⇒ scope of the watch-config-valid check (law §13.2).
triggers:
  - on: commit
    contexts: [invariant, gate]
    cost_ceiling: cheap
  - on: merge
    contexts: [invariant, gate]
    cost_ceiling: cheap
  - on: schedule
    cron: "0 6 * * *"
    contexts: [audit]
    cost_ceiling: moderate
  - on: epic-pre-done
    contexts: [audit, gate]
    cost_ceiling: expensive
  - on: manual
    contexts: [gate, audit, invariant]
    cost_ceiling: expensive
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/wiring.test.mjs`
Expected: PASS (3/3). Also `pnpm nx run runtime:typecheck` still clean (no new `.ts` yet beyond the include globs, which match zero new files until Phase B — an empty match is not an error).

- [ ] **Step 5: Commit**

```bash
git add runtime/runtime.config.json runtime/project.json runtime/tsconfig.json runtime/content/triggers.yaml runtime/engine/test/wiring.test.mjs
git commit --no-verify -m "chore(runtime): wire forward-edge subtrees into nx + config + triggers.yaml (SPEC 3 A1)"
git --no-pager log --oneline -1
```

---

## Phase B — The capability + journal type contract (types first; everything compiles against these)

### Task B1: `schema/journal.schema.ts` — the journal TYPES (defined once, imported by both the capability surface and the impl)

**Files:**
- Create: `runtime/engine/schema/journal.schema.ts`
- Test: `runtime/engine/test/journal-schema.test.mjs`

**Interfaces:**
- Consumes: `Decision`, `Choice` from `../capabilities/index.ts` (type-only import — the cycle is erased at type level, §5).
- Produces: `RunId`, `StepKey`, `Json`, `StepStrategy` (`'pure-rederive'|'keyed-effect'|'external-idempotent'`), `RunMeta{runId,branch,worktree,auto}`, `StepRecord{key,status,value?,decision?,ts}`, `RunLedger{meta,steps:Map}`, `Journal` interface (begin/step/record/read/awaiting/fulfil). A zod `RunMetaSchema` + `StepRecordSchema` for the impl's validation.

- [ ] **Step 1: Write the failing test**

Create `runtime/engine/test/journal-schema.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStepRecord, validateRunMeta, STEP_STRATEGIES } from '../schema/journal.schema.ts';

test('StepRecord requires key/status/ts; status is complete|awaiting', () => {
  const ok = validateStepRecord({ key: 'E1.promote', status: 'complete', value: 42, ts: '2026-07-01T00:00:00Z' });
  assert.equal(ok.ok, true);
  const bad = validateStepRecord({ key: 'x', status: 'weird', ts: 'now' });
  assert.equal(bad.ok, false);
});

test('an awaiting step may carry a decision, a complete step a value', () => {
  const awaiting = validateStepRecord({ key: 'ship.merge', status: 'awaiting',
    decision: { id: 'd1', question: 'merge?', options: [{ label: 'Merge', value: 'merge', recommended: true }] }, ts: 't' });
  assert.equal(awaiting.ok, true);
});

test('RunMeta pins the runstate.mjs slice keys', () => {
  const ok = validateRunMeta({ runId: 'item-x', branch: 'feat/x', worktree: '.wt/x', auto: false });
  assert.equal(ok.ok, true);
  assert.equal(validateRunMeta({ runId: 'x' }).ok, false); // missing branch/worktree/auto
});

test('STEP_STRATEGIES is the closed three-value set', () => {
  assert.deepEqual([...STEP_STRATEGIES].sort(), ['external-idempotent', 'keyed-effect', 'pure-rederive']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/journal-schema.test.mjs`
Expected: FAIL — `../schema/journal.schema.ts` not found.

- [ ] **Step 3: Write the schema**

Create `runtime/engine/schema/journal.schema.ts`:

```ts
// runtime/engine/schema/journal.schema.ts — ring-1 journal TYPES (§5).
// SPEC 1 convention: *types* live in *.schema.ts, *helpers* in .mjs. The journal's shapes live
// HERE, imported by BOTH capabilities/index.ts (§4) and lib/journal.mjs (defined once).
import { z } from 'zod';
import type { Decision, Choice } from '../capabilities/index.ts'; // §4.1 — type-only; cycle erased
import { formatZodError } from './finding.schema.ts';

export type RunId = string;         // `item-<id>` | `epic-<id>` — STABLE across wakes
export type StepKey = string;       // `<phase>.<name>` e.g. "E1.promote"
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export const STEP_STRATEGIES = ['pure-rederive', 'keyed-effect', 'external-idempotent'] as const;
export type StepStrategy = (typeof STEP_STRATEGIES)[number];

export const RunMetaSchema = z.object({
  runId: z.string().min(1),
  branch: z.string().min(1),
  worktree: z.string().min(1),
  auto: z.boolean(),
}).strict();
export type RunMeta = z.infer<typeof RunMetaSchema>;

// A DecisionSchema-lite for record validation (the full Decision lives as a TS type in capabilities;
// here we validate just enough that a parked ask round-trips through NDJSON).
const RecordedDecisionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.object({ label: z.string(), value: z.string(), recommended: z.boolean().optional() }).strict()).min(1),
  irreversible: z.boolean().optional(),
  context: z.string().optional(),
}).strict();

export const StepRecordSchema = z.object({
  key: z.string().min(1),
  status: z.enum(['complete', 'awaiting']),
  value: z.unknown().optional(),           // Json at the type level; unknown at the zod edge (NDJSON round-trip)
  decision: RecordedDecisionSchema.optional(),
  ts: z.string().min(1),
}).strict();
export type StepRecord = { key: StepKey; status: 'complete' | 'awaiting'; value?: Json; decision?: Decision; ts: string };

export interface RunLedger { meta: RunMeta; steps: Map<StepKey, StepRecord>; }

export interface Journal {
  begin(runId: RunId, meta: RunMeta): void;                     // idempotent: existing run → NOOP (FRESH-vs-RESUME)
  step<T>(runId: RunId, key: StepKey, fn: () => Promise<T>, strategy?: StepStrategy): Promise<T>;
  record(runId: RunId, key: StepKey, value: Json): void;        // append-only annotation (decisions[], e2e)
  read(runId: RunId): RunLedger | null;                         // null ⇒ FRESH
  awaiting(runId: RunId, key: StepKey, decision: Decision): void;
  fulfil(runId: RunId, key: StepKey, choice: Choice): void;
}

export function validateStepRecord(obj: unknown) {
  const r = StepRecordSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
export function validateRunMeta(obj: unknown) {
  const r = RunMetaSchema.safeParse(obj);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/journal-schema.test.mjs`
Expected: PASS (4/4). (The `import type { Decision, Choice }` resolves once B2 exists; until then Node type-stripping erases it at runtime, so the `.mjs` test runs green even before `capabilities/index.ts` is written. `tsc` is deferred to B2's typecheck gate.)

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/schema/journal.schema.ts runtime/engine/test/journal-schema.test.mjs
git commit --no-verify -m "feat(runtime): journal.schema.ts — RunMeta/StepRecord/Journal types (SPEC 3 B1)"
git --no-pager log --oneline -1
```

### Task B2: `capabilities/index.ts` — the six interfaces (types only)

**Files:**
- Create: `runtime/engine/capabilities/index.ts`
- Test: `runtime/engine/test/capabilities-contract.test.mjs`

**Interfaces:**
- Consumes: `Finding` from `../schema/finding.schema.ts` (frozen); `Journal` from `../schema/journal.schema.ts` (§5, re-exported here).
- Produces: `Task`, `TaskResult`, `Summary`, `Decision`, `DecisionOption`, `Choice`, `TriggerEvent`, `TriggerSpec`, `Unsubscribe`, `Capabilities`; a runtime-visible `isRecommendedWellFormed(decision)` guard (exactly one `recommended:true`) so the house rule is testable without a type system at runtime.

- [ ] **Step 1: Write the failing test**

Create `runtime/engine/test/capabilities-contract.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRecommendedWellFormed, TRIGGER_KINDS } from '../capabilities/index.ts';

test('a Decision must carry exactly one recommended option (house rule)', () => {
  const good = { id: 'd', question: 'q', options: [{ label: 'A', value: 'a', recommended: true }, { label: 'B', value: 'b' }] };
  assert.equal(isRecommendedWellFormed(good), true);
  assert.equal(isRecommendedWellFormed({ ...good, options: [{ label: 'A', value: 'a' }] }), false); // zero
  assert.equal(isRecommendedWellFormed({ ...good, options: [
    { label: 'A', value: 'a', recommended: true }, { label: 'B', value: 'b', recommended: true }] }), false); // two
});

test('TRIGGER_KINDS excludes epic-pre-done (that is a WatchTrigger-only superset kind, §4.1)', () => {
  assert.deepEqual([...TRIGGER_KINDS].sort(), ['ci', 'commit', 'manual', 'merge', 'schedule']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/capabilities-contract.test.mjs`
Expected: FAIL — `../capabilities/index.ts` not found.

- [ ] **Step 3: Write the contract**

Create `runtime/engine/capabilities/index.ts` (verbatim from SPEC 3 §4.1, plus the two runtime guards the tests pin):

```ts
// runtime/engine/capabilities/index.ts — the ONLY host surface ring-1 depends on (§4.1).
import type { Finding } from '../schema/finding.schema.ts';   // SPEC 1 §3, frozen
import type { Journal } from '../schema/journal.schema.ts';   // §5, defined once, re-exported here

export interface Task {
  id: string;                 // stable idempotency-key seed (feeds journal, §5)
  prompt: string;             // the work instruction — prompt-shaped by the adapter
  scope: string[];            // paths the task may touch (feeds the scope-gate, §9)
  procedure?: string;         // optional named sub-procedure (runProcedure)
  payload?: unknown;
}
export interface TaskResult {
  taskId: string;
  status: 'done' | 'failed' | 'paused';
  summary: string;            // bounded prose — NEVER a transcript
  findings?: Finding[];
}
export interface Summary {    // the ONLY thing fanOut returns (the Tier-2 scar)
  taskId: string;
  status: 'done' | 'failed';
  summary: string;            // a transcript here is a SEAM VIOLATION
}

export interface Decision {
  id: string;
  question: string;
  options: DecisionOption[];   // exactly one MUST carry recommended:true (house rule)
  irreversible?: boolean;      // hard-floor: ALWAYS pauses, even in --auto
  context?: string;
}
export interface DecisionOption { label: string; value: string; recommended?: boolean; }
export interface Choice { decisionId: string; value: string; rationale?: string; }

export type TriggerEvent =
  | { kind: 'manual' }
  | { kind: 'commit'; sha: string; changed: string[] }
  | { kind: 'merge';  branch: string; changed: string[] }
  | { kind: 'ci';     ref: string;    changed: string[] }
  | { kind: 'schedule'; cron: string };
export interface TriggerSpec { on: TriggerEvent['kind']; cron?: string; }
export type Unsubscribe = () => void;

export type { Journal };       // §5 — NOT a placeholder; the one definition, re-exported
export interface Capabilities {
  execute(task: Task): Promise<TaskResult>;
  fanOut(tasks: Task[]): Promise<Summary[]>;
  ask(decision: Decision): Promise<Choice>;
  onTrigger(spec: TriggerSpec, handler: (e: TriggerEvent) => Promise<void>): Unsubscribe;
  runProcedure(name: string, args?: unknown): Promise<TaskResult>;
  journal: Journal;
}

// ── runtime guards (so the house rules are testable without a type system at runtime) ──
export const TRIGGER_KINDS = ['manual', 'commit', 'merge', 'ci', 'schedule'] as const;
export function isRecommendedWellFormed(decision: { options: DecisionOption[] }): boolean {
  return decision.options.filter((o) => o.recommended === true).length === 1;
}
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `node --test runtime/engine/test/capabilities-contract.test.mjs`
Expected: PASS (2/2).
Run: `pnpm nx run runtime:typecheck`
Expected: PASS — the `capabilities/index.ts` ↔ `journal.schema.ts` type-only cycle resolves under `tsc` (both are `import type`), and `Decision`/`Choice`/`Journal`/`Finding` all bind.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/capabilities/index.ts runtime/engine/test/capabilities-contract.test.mjs
git commit --no-verify -m "feat(runtime): capabilities/index.ts — the six interfaces (types) (SPEC 3 B2)"
git --no-pager log --oneline -1
```

---

## Phase C — The `journal` idempotency contract (TDD block A)

The one primitive everything downstream is built on. **Ring-1 owns it** — git is universal infrastructure, not a harness primitive, so the journal is self-sufficient here (the adapter §G merely instantiates it). It **generalizes** `runstate.mjs`'s 6-key snapshot (kept as `meta` + `record`ed `decisions`/`e2e`) by adding a per-step NDJSON ledger. `step` is **meta-independent** (reads `steps.ndjson` directly) so the backward edge (§D) uses it without `begin`; `read` is **meta-gated** (null ⇒ FRESH) so the worker (§F) gets a clean FRESH/RESUME signal. **Precision:** `runstate.mjs`'s `parseRunState` is *graceful-degrade-to-clean-error*, NOT tail-repair — the NDJSON tail-heal here is genuinely net-new, generalizing that crash-tolerance to per-line granularity.

### Task C1: `lib/journal.mjs` — the git-native + in-memory Journal (idempotent step, resume-as-replay, tail-heal)

**Files:**
- Create: `runtime/engine/lib/journal.mjs`
- Test: `runtime/engine/test/journal.test.mjs`

**Interfaces:**
- Consumes: `validateStepRecord`, `validateRunMeta` from `../schema/journal.schema.ts` (§B1).
- Produces: `makeJournal({root})→Journal` (git-native, persistent); `inMemoryJournal()→Journal` (tests + the headless backward-edge default); `gitCommonDir(exec?)→string`; `e2eIsFresh(ledger, headSha)→boolean`. Both journals implement `begin/step/record/read/awaiting/fulfil`; `step(runId,key,fn,strategy)` is async and meta-independent; `read(runId)` returns `null` iff no meta.

- [ ] **Step 1: Write the failing test** — TDD block A (§15), all six scenarios.

Create `runtime/engine/test/journal.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeJournal, inMemoryJournal, e2eIsFresh } from '../lib/journal.mjs';

const freshRoot = () => mkdtempSync(join(tmpdir(), 'jrnl-'));
const meta = (runId) => ({ runId, branch: 'feat/x', worktree: '.wt/x', auto: false });

test('A1: a keyed-effect step runs the effect once and records one complete line', async () => {
  const j = makeJournal({ root: freshRoot() });
  j.begin('item-a', meta('item-a'));
  let calls = 0;
  const v = await j.step('item-a', 'E1.promote', async () => { calls++; return 'sha1'; });
  assert.equal(v, 'sha1');
  assert.equal(calls, 1);
  assert.equal(j.read('item-a').steps.get('E1.promote').status, 'complete');
});

test('A2: resume replays a complete step — fn NOT invoked (no double-promote)', async () => {
  const root = freshRoot();
  const j1 = makeJournal({ root }); j1.begin('item-a', meta('item-a'));
  await j1.step('item-a', 'E1.promote', async () => 'sha1');
  const j2 = makeJournal({ root });                 // a fresh process/instance = resume
  let calls = 0;
  const v = await j2.step('item-a', 'E1.promote', async () => { calls++; return 'sha2'; });
  assert.equal(v, 'sha1');                          // recorded value returned
  assert.equal(calls, 0);                           // effect NOT re-run
});

test('A3: a pure-rederive step recomputes and is never ledgered', async () => {
  const j = makeJournal({ root: freshRoot() }); j.begin('item-a', meta('item-a'));
  let calls = 0;
  await j.step('item-a', 'select', async () => { calls++; return 'x'; }, 'pure-rederive');
  await j.step('item-a', 'select', async () => { calls++; return 'x'; }, 'pure-rederive');
  assert.equal(calls, 2);                           // recomputed each time
  assert.equal(j.read('item-a').steps.has('select'), false); // never written
});

test('A4: a torn final line is dropped; prior complete steps survive; no throw', async () => {
  const root = freshRoot(); const j = makeJournal({ root }); j.begin('item-a', meta('item-a'));
  await j.step('item-a', 'E1.promote', async () => 'sha1');
  const stepsFile = join(root, 'journal', 'item-a', 'steps.ndjson');
  writeFileSync(stepsFile, readFileSync(stepsFile, 'utf8') + '{ "key": "E2.torn", "sta');  // crash mid-append
  const ledger = j.read('item-a');                  // must not throw
  assert.equal(ledger.steps.get('E1.promote').value, 'sha1');
  assert.equal(ledger.steps.has('E2.torn'), false);
});

test('A5: a parked ask fulfilled by a Choice resumes with the recorded choice — no re-ask', async () => {
  const j = inMemoryJournal(); j.begin('item-a', meta('item-a'));
  const decision = { id: 'd', question: 'merge?', options: [{ label: 'Merge', value: 'merge', recommended: true }] };
  j.awaiting('item-a', 'ship.merge', decision);
  assert.equal(j.read('item-a').steps.get('ship.merge').status, 'awaiting');
  j.fulfil('item-a', 'ship.merge', { decisionId: 'd', value: 'merge' });
  let calls = 0;
  const v = await j.step('item-a', 'ship.merge', async () => { calls++; return 'x'; });
  assert.equal(v.value, 'merge');                   // the recorded choice
  assert.equal(calls, 0);                           // the human is NOT re-asked
});

test('A6: e2e freshness — a recorded e2e sha not matching HEAD is stale (forces return to E6)', () => {
  const j = inMemoryJournal(); j.begin('epic-b', meta('epic-b'));
  j.record('epic-b', 'e2e', { sha: 'abc', green: true });
  assert.equal(e2eIsFresh(j.read('epic-b'), 'abc'), true);
  assert.equal(e2eIsFresh(j.read('epic-b'), 'def'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/journal.test.mjs`
Expected: FAIL — `../lib/journal.mjs` not found.

- [ ] **Step 3: Write the journal**

Create `runtime/engine/lib/journal.mjs`:

```js
// runtime/engine/lib/journal.mjs — the git-native, append-only, keyed NDJSON journal (§5).
// Ring-1: git is universal infrastructure, NOT a harness primitive. Two backings share one contract:
// makeJournal({root}) (persistent) + inMemoryJournal() (tests/headless). Resume = replay: a 'complete'
// step short-circuits (fn NOT re-invoked); a torn tail line is dropped (crash-safe, generalizes F-11).
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateStepRecord, validateRunMeta } from '../schema/journal.schema.ts';

const isoNow = () => new Date().toISOString();

/** Resolve the git-common-dir (cwd-independent, shared across worktrees) — the runstate.mjs form. */
export function gitCommonDir(exec = (c) => execSync(c, { encoding: 'utf8' })) {
  return exec('git rev-parse --path-format=absolute --git-common-dir').trim().replace(/\/$/, '');
}

/** Parse an NDJSON step-ledger line-by-line; a torn/invalid line is DROPPED (tail-heal, §5). */
function parseSteps(text) {
  const steps = new Map();
  for (const line of text.split('\n')) {
    if (!line.length) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }   // torn line → drop
    const v = validateStepRecord(parsed);
    if (!v.ok) continue;                                       // malformed record → drop
    steps.set(v.value.key, v.value);                           // last-write-wins per key
  }
  return steps;
}

/** The one contract, over an injected storage backing. */
function makeBacking({ readMeta, writeMeta, readSteps, appendStep }) {
  return {
    begin(runId, meta) {
      const v = validateRunMeta(meta);
      if (!v.ok) throw new Error(`journal.begin: invalid RunMeta: ${v.error}`);
      if (readMeta(runId) == null) writeMeta(runId, v.value);   // idempotent: existing run → NOOP
    },
    async step(runId, key, fn, strategy = 'keyed-effect') {
      if (strategy === 'pure-rederive') return await fn();       // never ledgered — replay is free
      const existing = readSteps(runId).get(key);
      if (existing?.status === 'complete') return existing.value; // REPLAY — fn NOT invoked
      const value = await fn();                                   // execute exactly once
      appendStep(runId, { key, status: 'complete', value, ts: isoNow() });
      return value;
    },
    record(runId, key, value) { appendStep(runId, { key, status: 'complete', value, ts: isoNow() }); },
    read(runId) {
      const meta = readMeta(runId);
      if (meta == null) return null;                             // FRESH
      return { meta, steps: readSteps(runId) };
    },
    awaiting(runId, key, decision) { appendStep(runId, { key, status: 'awaiting', decision, ts: isoNow() }); },
    fulfil(runId, key, choice) { appendStep(runId, { key, status: 'complete', value: choice, ts: isoNow() }); },
  };
}

/** Git-native persistent journal. root defaults to <git-common-dir>; tests pass a temp root. */
export function makeJournal({ root = gitCommonDir() } = {}) {
  const runDir = (runId) => join(root, 'journal', runId);
  const metaPath = (runId) => join(runDir(runId), 'meta.json');
  const stepsPath = (runId) => join(runDir(runId), 'steps.ndjson');
  return makeBacking({
    readMeta: (runId) => (existsSync(metaPath(runId)) ? JSON.parse(readFileSync(metaPath(runId), 'utf8')) : null),
    writeMeta: (runId, meta) => { mkdirSync(runDir(runId), { recursive: true }); writeFileSync(metaPath(runId), JSON.stringify(meta, null, 2) + '\n'); },
    readSteps: (runId) => (existsSync(stepsPath(runId)) ? parseSteps(readFileSync(stepsPath(runId), 'utf8')) : new Map()),
    appendStep: (runId, rec) => { mkdirSync(runDir(runId), { recursive: true }); appendFileSync(stepsPath(runId), JSON.stringify(rec) + '\n'); },
  });
}

/** In-memory Journal (same contract) — tests + the headless backward-edge default. */
export function inMemoryJournal() {
  const metas = new Map();
  const lines = new Map();   // runId → StepRecord[]
  return makeBacking({
    readMeta: (runId) => metas.get(runId) ?? null,
    writeMeta: (runId, meta) => metas.set(runId, meta),
    readSteps: (runId) => { const m = new Map(); for (const r of lines.get(runId) ?? []) m.set(r.key, r); return m; },
    appendStep: (runId, rec) => { const a = lines.get(runId) ?? []; a.push(rec); lines.set(runId, a); },
  });
}

/** e2e-freshness helper (F-14): the recorded e2e step's sha must match HEAD. */
export function e2eIsFresh(ledger, headSha) {
  const rec = ledger?.steps?.get('e2e');
  return !!rec && rec.value?.sha === headSha;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/journal.test.mjs`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/journal.mjs runtime/engine/test/journal.test.mjs
git commit --no-verify -m "feat(runtime): git-native + in-memory journal — idempotent step, resume-replay, tail-heal (SPEC 3 C1)"
git --no-pager log --oneline -1
```

---

## Phase D — Seam unification: migrate SPEC 2's backward edge onto the formal `ask`/`journal` (fork Q1)

**Decision realized:** SPEC 2 shipped a placeholder seam (`inMemoryJournal` with `has/get/record`; `headlessAsk` returning `{sentinel}`). This phase makes SPEC 3's formal `Journal` + `Decision`/`Choice` the single contract — the strict-superset made literal. **The backward edge becomes `async`** (it now awaits `journal.step` + `ask`), gaining resume-by-replay for free. **Every task ends with the full backward-suite regression gate** (`node --test runtime/engine/backward/test/*.test.mjs`) — the 16 shipped test files stay green throughout. **Migration invariants:** (a) `present-floor` preserves its `{choice, selected, sentinel}` return so `mint`/`curate` change only by `async`/`await`; (b) all backward idempotency uses a single `runId='backward'` with the existing composite keys (`mint:<id>:ratify`, `curate:<id>:<transition>`), so keys are unchanged; (c) the `<<HARNESS-PAUSE: <act> <id>>>` sentinel string is preserved verbatim (the runner's `PAUSE_RE` depends on it).

### Task D1: `backward/lib/capabilities.mjs` — formal Journal default + `ask(Decision)→Choice` headless default

**Files:**
- Modify: `runtime/engine/backward/lib/capabilities.mjs`
- Test: `runtime/engine/backward/test/capabilities.test.mjs` (rewrite for the new shapes)

**Interfaces:**
- Consumes: `inMemoryJournal` from `../../lib/journal.mjs` (§C1); `Decision`/`Choice` shapes (§B2).
- Produces: `export const PAUSE`; `export async function headlessAsk(decision)→Choice` (returns `{decisionId, value: PAUSE}`); `export { inMemoryJournal }` (re-exported formal Journal — the backward-edge headless default).

- [ ] **Step 1: Rewrite the failing test**

Replace `runtime/engine/backward/test/capabilities.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headlessAsk, inMemoryJournal, PAUSE } from '../lib/capabilities.mjs';

test('headlessAsk returns a formal Choice whose value is the PAUSE sentinel (never a selection)', async () => {
  const choice = await headlessAsk({ id: 'mint-x', question: 'ratify?', options: [{ label: 'Ratify', value: 'ratify', recommended: true }] });
  assert.deepEqual(choice, { decisionId: 'mint-x', value: PAUSE });
});

test('inMemoryJournal is the formal Journal (step is idempotent by key)', async () => {
  const j = inMemoryJournal();
  let calls = 0;
  const a = await j.step('backward', 'mint:x:ratify', async () => { calls++; return { ok: true }; });
  const b = await j.step('backward', 'mint:x:ratify', async () => { calls++; return { ok: false }; });
  assert.deepEqual(a, { ok: true });
  assert.deepEqual(b, { ok: true });   // replay — second fn NOT run
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/capabilities.test.mjs`
Expected: FAIL — `PAUSE` undefined; `headlessAsk` returns the old `{sentinel}`; `inMemoryJournal` has no `step`.

- [ ] **Step 3: Rewrite the module**

Replace `runtime/engine/backward/lib/capabilities.mjs`:

```js
// runtime/engine/backward/lib/capabilities.mjs — the SPEC-3 capability seam, UNIFIED (fork Q1).
// The backward edge now speaks the formal Journal (../../lib/journal.mjs) + Decision/Choice shapes.
// Headless default: ask returns a Choice whose value is the PAUSE sentinel — the caller MUST pause.
import { fileURLToPath } from 'node:url';
export { inMemoryJournal } from '../../lib/journal.mjs';   // the formal Journal, memory-backed

export const PAUSE = '<<HARNESS-PAUSE>>';

/** Headless ask: a floor act NEVER self-resolves — returns a Choice carrying the PAUSE value. */
export async function headlessAsk(decision) {
  return { decisionId: decision.id, value: PAUSE };
}

function main() { console.error('capabilities.mjs is a library; the adapter injects the interactive ask/journal'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/capabilities.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/backward/lib/capabilities.mjs runtime/engine/backward/test/capabilities.test.mjs
git commit --no-verify -m "feat(runtime): unify backward seam — formal Journal + ask(Decision) headless default (SPEC 3 D1)"
git --no-pager log --oneline -1
```

### Task D2: `backward/lib/present-floor.mjs` — the async bridge (`FloorChoice`→`Decision`, `ask`→`Choice`)

**Files:**
- Modify: `runtime/engine/backward/lib/present-floor.mjs`
- Test: `runtime/engine/backward/test/present-floor.test.mjs` (rewrite)

**Interfaces:**
- Consumes: `headlessAsk`, `PAUSE` from `./capabilities.mjs` (§D1); a `FloorChoice` (`MintChoice`/`CurateChoice`, §floor-choice.ts).
- Produces: `export async function presentFloor({choice, ask})→{choice, selected, sentinel}` (return shape unchanged); `export function toDecision(choice)→Decision` (exported for the worker/adapter reuse).

- [ ] **Step 1: Rewrite the failing test**

Replace `runtime/engine/backward/test/present-floor.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentFloor, toDecision } from '../lib/present-floor.mjs';

const mintChoice = { act: 'mint', candidate: { id: 'no-x' }, lesson: 'feedback_x.md', rationale: 'because',
  recommended: 'ratify', options: ['ratify', 'edit', 'decline'] };

test('toDecision maps a FloorChoice to a well-formed Decision (exactly one recommended)', () => {
  const d = toDecision(mintChoice);
  assert.equal(d.id, 'mint-no-x');
  assert.equal(d.options.filter((o) => o.recommended).length, 1);
  assert.deepEqual(d.options.map((o) => o.value), ['ratify', 'edit', 'decline']);
});

test('a selection in options is returned as selected', async () => {
  const ask = async (d) => ({ decisionId: d.id, value: 'ratify' });
  const r = await presentFloor({ choice: mintChoice, ask });
  assert.equal(r.selected, 'ratify');
  assert.equal(r.sentinel, undefined);
});

test('a PAUSE-valued choice (headless) → sentinel, never a silent default', async () => {
  const r = await presentFloor({ choice: mintChoice });   // default headlessAsk → PAUSE
  assert.equal(r.selected, undefined);
  assert.equal(r.sentinel, '<<HARNESS-PAUSE: mint no-x>>');
});

test('an out-of-options answer is also treated as a pause', async () => {
  const ask = async (d) => ({ decisionId: d.id, value: 'bogus' });
  const r = await presentFloor({ choice: mintChoice, ask });
  assert.equal(r.sentinel, '<<HARNESS-PAUSE: mint no-x>>');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/present-floor.test.mjs`
Expected: FAIL — `toDecision` not exported; `presentFloor` is sync + expects `ask({choice})`.

- [ ] **Step 3: Rewrite the module**

Replace `runtime/engine/backward/lib/present-floor.mjs`:

```js
// present-floor.mjs — the floor BRIDGE (§4.3, fork Q1). Builds a formal Decision from the domain
// FloorChoice, awaits the formal ask(Decision)→Choice, maps back to {choice, selected, sentinel}.
// A PAUSE value or an out-of-options answer is a pause (never a silent default) — the recommended-
// bearing-choice discipline. The <<HARNESS-PAUSE: act id>> string is preserved (runner PAUSE_RE).
import { headlessAsk, PAUSE } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export function toDecision(choice) {
  const id = choice.act === 'mint' ? choice.candidate.id : choice.guard.id;
  const question = choice.act === 'mint'
    ? `Ratify candidate check "${id}" minted from lesson ${choice.lesson}?`
    : `Curate check "${id}" (${choice.trigger})?`;
  return {
    id: `${choice.act}-${id}`,
    question,
    options: choice.options.map((v) => ({ label: v, value: v, recommended: v === choice.recommended })),
    context: choice.rationale,
  };
}

export async function presentFloor({ choice, ask = headlessAsk }) {
  const answer = (await ask(toDecision(choice))) ?? {};
  const id = choice.act === 'mint' ? choice.candidate.id : choice.guard.id;
  if (answer.value === PAUSE || !choice.options.includes(answer.value)) {
    return { choice, selected: undefined, sentinel: `<<HARNESS-PAUSE: ${choice.act} ${id}>>` };
  }
  return { choice, selected: answer.value, sentinel: undefined };
}

function main() { console.error('present-floor.mjs is a library; import presentFloor'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/present-floor.test.mjs`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/backward/lib/present-floor.mjs runtime/engine/backward/test/present-floor.test.mjs
git commit --no-verify -m "feat(runtime): present-floor async bridge FloorChoice→Decision→Choice (SPEC 3 D2)"
git --no-pager log --oneline -1
```

### Task D3: `backward/lib/register-ratified.mjs` — async + `journal.step`

**Files:**
- Modify: `runtime/engine/backward/lib/register-ratified.mjs`
- Test: `runtime/engine/backward/test/register-ratified.test.mjs` (add `await`; assert replay via re-invocation)

**Interfaces:**
- Consumes: `inMemoryJournal` (default); `landEvalScenario`, `advanceLifecycle`, `reconcileLesson` (unchanged, sync).
- Produces: `export async function registerRatified({draft, floorApproval, journal, checksDir, dossierRoot, scenariosDir})→Promise<{check, decision, landing, mints}>`. The atomic unit is `journal.step('backward', 'mint:<id>:ratify', fn)`: replay ⇒ the recorded result, side effects skipped.

- [ ] **Step 1: Update the failing test** — add the replay assertion (the resume-by-replay bonus):

In `register-ratified.test.mjs`, make every `registerRatified(...)` call `await`ed, and add:

```js
test('a second registerRatified with the same journal replays — no double land/advance/reconcile', async () => {
  const journal = inMemoryJournal();
  const first = await registerRatified({ draft, floorApproval: true, journal, checksDir, dossierRoot, scenariosDir });
  let landed = 0;
  const scenariosDir2 = /* a dir a spy wraps, or re-count files */ scenariosDir;
  const second = await registerRatified({ draft, floorApproval: true, journal, checksDir, dossierRoot, scenariosDir: scenariosDir2 });
  assert.deepEqual(second, first);   // recorded value returned; effects not repeated
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/register-ratified.test.mjs`
Expected: FAIL — `registerRatified` returns a plain object (not a Promise) / no replay short-circuit.

- [ ] **Step 3: Wrap the atomic unit in `journal.step`**

In `register-ratified.mjs`, change the signature to `export async function registerRatified(...)` and wrap the existing land→advance→write→reconcile body:

```js
export async function registerRatified({ draft, floorApproval, journal = inMemoryJournal(), checksDir, dossierRoot, scenariosDir }) {
  const id = draft.entry.id;
  return await journal.step('backward', `mint:${id}:ratify`, async () => {
    const landing = landEvalScenario({ draft, scenariosDir });                 // (1) FIRST — satisfies a judgment ratify guard
    const advanced = advanceLifecycle({ check: draft.entry, transition: 'ratify', floorApproval }); // (2)
    if (advanced.check == null) throw new Error(`ratify refused: ${advanced.event}`);
    writeFileSync(join(checksDir, `${id}.yaml`), yaml.stringify(advanced.check));
    const { mints } = reconcileLesson({ lesson: draft.entry.provenance.lesson, check: id,
      transition: 'ratify', ratified: advanced.check.provenance.ratified, dossierRoot });          // (3)
    const decision = { act: 'mint', transition: 'ratify', check: id, /* …existing FloorDecision fields… */ };
    return { check: advanced.check, decision, landing, mints };
  });
}
```

(Preserve the existing imports `writeFileSync`, `join`, `yaml`, and the exact `decision` FloorDecision fields already in the file — only the async wrap + `journal.step` are new. The order (1→2→3) is load-bearing and unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/register-ratified.test.mjs`
Expected: PASS (existing + the new replay test).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/backward/lib/register-ratified.mjs runtime/engine/backward/test/register-ratified.test.mjs
git commit --no-verify -m "feat(runtime): registerRatified async atomic unit via journal.step (SPEC 3 D3)"
git --no-pager log --oneline -1
```

### Task D4: `backward/lib/curate-guard.mjs` — async + `journal.step`

**Files:**
- Modify: `runtime/engine/backward/lib/curate-guard.mjs`
- Test: `runtime/engine/backward/test/curate-guard.test.mjs` (add `await`; keep-is-a-noop stays; replay assertion)

**Interfaces:**
- Produces: `export async function curateGuard({guard, trigger, transition, successor, floorApproval, rationale, retiredReason, journal, checksDir, dossierRoot})→Promise<{check, successor?, decision, mints}>`. `keep` is a procedure-level NO-OP (returns without journaling); `retire`/`supersede` run inside `journal.step('backward', 'curate:<id>:<transition>', fn)`.

- [ ] **Step 1: Update the failing test** — `await` every call; assert `keep` never journals; add a replay assertion for `retire`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/curate-guard.test.mjs`
Expected: FAIL — sync return / no replay.

- [ ] **Step 3: Wrap retire/supersede in `journal.step`**

```js
export async function curateGuard({ guard, trigger, transition, successor, floorApproval, rationale, retiredReason,
                                    journal = inMemoryJournal(), checksDir, dossierRoot }) {
  if (transition === 'keep') return { check: guard, kept: true, decision: /* …existing keep decision… */ };
  return await journal.step('backward', `curate:${guard.id}:${transition}`, async () => {
    /* …the existing advanceLifecycle(retire|supersede) + write ${checksDir}/<id>.yaml (+ successor yaml)
       + reconcileLesson body, verbatim… */
    return { check, successor, decision, mints };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/backward/test/curate-guard.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/backward/lib/curate-guard.mjs runtime/engine/backward/test/curate-guard.test.mjs
git commit --no-verify -m "feat(runtime): curateGuard async retire/supersede via journal.step (SPEC 3 D4)"
git --no-pager log --oneline -1
```

### Task D5: `mint.mjs` + `curate.mjs` async composition + full backward-suite regression

**Files:**
- Modify: `runtime/engine/backward/lib/mint.mjs`, `runtime/engine/backward/lib/curate.mjs`
- Test: `runtime/engine/backward/test/{mint,curate,dogfood,content-ring,retire-proof,supersede-proof}.test.mjs` (add `await`)

**Interfaces:**
- Produces: `export async function runMint({item, lesson, proposal, ask, journal, checksDir, dossierRoot, scenariosDir})→Promise<{kind, …}>` and `export async function runCurate({guard, trigger, finding, proposedSuccessor, rationale, ask, journal, checksDir, dossierRoot})→Promise<{kind, …}>` — same result shapes, now awaited.

- [ ] **Step 1: Update the failing tests** — every `runMint(...)`/`runCurate(...)` call across the six test files gets `await` (they run inside `async` `test(...)` callbacks). No assertion changes beyond awaiting.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test runtime/engine/backward/test/mint.test.mjs runtime/engine/backward/test/curate.test.mjs`
Expected: FAIL — `runMint`/`runCurate` return Promises the sync tests didn't await (assertions see a Promise, not the result).

- [ ] **Step 3: Make the compositions async**

In `mint.mjs`: `export async function runMint(...)`; `const { selected, sentinel } = await presentFloor({ choice, ask });`; `return await registerRatified({...})` on ratify; `advanceLifecycle` decline path unchanged (sync). In `curate.mjs`: `export async function runCurate(...)`; `await presentFloor(...)`; `return await curateGuard({...})`.

- [ ] **Step 4: Run the FULL backward suite to verify green (regression gate)**

Run: `node --test runtime/engine/backward/test/*.test.mjs`
Expected: PASS — all 16 files green. This is the Phase-D exit gate: the unification preserved every SPEC 2 behavior.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/backward/lib/mint.mjs runtime/engine/backward/lib/curate.mjs runtime/engine/backward/test/*.test.mjs
git commit --no-verify -m "feat(runtime): runMint/runCurate async; full backward suite green on unified seam (SPEC 3 D5)"
git --no-pager log --oneline -1
```

---

## Phase E — The forward-edge helpers (pure cores + thin CLIs)

Each helper is a pure core + a thin `main()`. All reuse SPEC 1's `findByScope`/`runCheck`/`loadRegistry` **verbatim** (E0 is the one anticipated SPEC-1 extension — the deferred judge param). TDD blocks B (scope-gate), C (watch), D (intake) come from §15.

### Task E0: Wire the deferred judge param into `resolveEvaluator` + `runCheck` (SPEC 1 §15 clarification 3 — re-freeze delta)

SPEC 1 §15 clarification 3 froze: *"`skill:` resolves but its `invoke` throws `JudgeCapabilityUnavailable` … the judge capability is SPEC 3's seam #1 … only invocation defers."* This task realizes that deferred invocation with a **backward-compatible optional `judge` param** — without it, the throw is unchanged, so every SPEC 1 test stays green. **Phase J re-freezes this delta into SPEC 1 §15.**

**Files:**
- Modify: `runtime/engine/lib/resolve-evaluator.mjs`, `runtime/engine/lib/run-check.mjs`
- Test: `runtime/engine/test/resolve-evaluator.test.mjs` (add a judge-wired case; the existing throw case stays)

**Interfaces:**
- Produces: `resolveEvaluator({check, judge})` — for `skill:`, `invoke = judge ? () => judge(check) : () => { throw new JudgeCapabilityUnavailable(run) }`. `runCheck({check, context, judge})` threads `judge` through. `judge` signature: `(check) => Promise<Array<{detail, evidence?, scope?}>>` (partial-finding array; `toFindings` stamps `kind`).

- [ ] **Step 1: Write the failing test** — add to `resolve-evaluator.test.mjs`:

```js
test('a skill: check with an injected judge invokes it instead of throwing', async () => {
  const check = { id: 'j', property: 'p', kind: 'inconsistency', cost_tier: 'expensive', contexts: ['audit'],
    status: 'active', scope: { paths: ['**/*'] }, evaluator: { type: 'judgment', run: 'skill:audit-x' },
    flake_contract: { eval_scenario: 'runtime/eval/scenarios/j.scenario.mjs', allowed_flake_rate: 0.1, calibration: 'x' },
    provenance: { minted_by: 'x' } };
  const judge = async () => [{ detail: 'judged violation', scope: ['a'] }];
  const { kind, invoke } = resolveEvaluator({ check, judge });
  assert.equal(kind, 'judgment');
  const findings = await invoke();
  assert.equal(findings[0].detail, 'judged violation');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/resolve-evaluator.test.mjs`
Expected: FAIL — `resolveEvaluator` ignores `judge`; the skill: invoke throws.

- [ ] **Step 3: Thread the optional judge**

In `resolve-evaluator.mjs`, change the signature to `export function resolveEvaluator({ check, judge })` and the `skill:` branch:

```js
// skill: (judgment) — the judge is SPEC 3 seam #1 (§15 clarification 3, now wired)
if (scheme === 'skill') {
  if (!check.flake_contract) throw new JudgmentContractMissing(check.id);
  return { kind: 'judgment', invoke: judge
    ? async () => toFindings(await judge(check), check)
    : () => { throw new JudgeCapabilityUnavailable(check.evaluator.run); } };
}
```

In `run-check.mjs`, change to `export async function runCheck({ check, context, judge })` and pass it: `const { invoke } = resolveEvaluator({ check, judge });` (the rest — the context-not-declared honesty guard, the `f.kind` stamping — unchanged).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test runtime/engine/test/resolve-evaluator.test.mjs runtime/engine/test/run-check.test.mjs`
Expected: PASS — the new judge case + every existing case (the no-judge throw path is untouched).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/resolve-evaluator.mjs runtime/engine/lib/run-check.mjs runtime/engine/test/resolve-evaluator.test.mjs
git commit --no-verify -m "feat(runtime): wire deferred judge param into resolveEvaluator/runCheck (SPEC 3 E0; §15 delta)"
git --no-pager log --oneline -1
```

### Task E1: `lib/run-watch.mjs` — the watch engine (TDD block C)

**Files:**
- Create: `runtime/engine/lib/run-watch.mjs`
- Test: `runtime/engine/test/run-watch.test.mjs`

**Interfaces:**
- Consumes: `findByScope` (§SPEC 1 — `{checks, invariants}`), `runCheck` (§E0 — partial findings), `loadRegistry`.
- Produces: `selectChecks({registry, trigger, changedScope})→CheckEntry[]` (pure selection); `runWatch({registry, trigger, changedScope, judge})→Promise<Finding[]>` (completes partial findings — stamps `id`/`check`/`raised_at`); `loadTriggers(triggersFile)→WatchTrigger[]`. CLI `run-watch.mjs --on=<trigger> [--changed=…]`: exit 0 none, 1 findings, 2 usage.

- [ ] **Step 1: Write the failing test** — TDD block C (§15):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectChecks, runWatch } from '../lib/run-watch.mjs';

const check = (over) => ({ id: 'c', property: 'p', kind: 'inconsistency', cost_tier: 'cheap',
  contexts: ['invariant'], status: 'active', scope: { paths: ['services/foo/**'] },
  evaluator: { type: 'deterministic', run: 'cmd:true' }, provenance: { minted_by: 'x' }, ...over });
const registry = (checks) => ({ checks, byId: new Map(checks.map((c) => [c.id, c])), errors: [] });

test('C1: a cheap global invariant fires even when its scope does not overlap changed files', () => {
  const inv = check({ id: 'inv', contexts: ['invariant'], cost_tier: 'cheap' });
  const sel = selectChecks({ registry: registry([inv]), trigger: { on: 'commit', contexts: ['invariant', 'gate'], cost_ceiling: 'cheap' }, changedScope: ['services/other/x.ts'] });
  assert.deepEqual(sel.map((c) => c.id), ['inv']);   // global invariants always ride
});

test('C2: an expensive audit does NOT fire on a cheap-ceiling commit trigger', () => {
  const aud = check({ id: 'aud', contexts: ['audit'], cost_tier: 'expensive', scope: { paths: ['services/other/x.ts'] } });
  const sel = selectChecks({ registry: registry([aud]), trigger: { on: 'commit', contexts: ['invariant', 'gate'], cost_ceiling: 'cheap' }, changedScope: ['services/other/x.ts'] });
  assert.deepEqual(sel, []);   // cost_ceiling refuses it
});

test('C3: an epic-pre-done trigger fires an expensive audit', () => {
  const aud = check({ id: 'aud', contexts: ['audit'], cost_tier: 'expensive', scope: { paths: ['a/**'] } });
  const sel = selectChecks({ registry: registry([aud]), trigger: { on: 'epic-pre-done', contexts: ['audit', 'gate'], cost_ceiling: 'expensive' }, changedScope: ['a/x'] });
  assert.deepEqual(sel.map((c) => c.id), ['aud']);
});

test('C4: a schedule/moderate trigger fires moderate audits but not expensive ones', () => {
  const mod = check({ id: 'mod', contexts: ['audit'], cost_tier: 'moderate', scope: { paths: ['a/**'] } });
  const exp = check({ id: 'exp', contexts: ['audit'], cost_tier: 'expensive', scope: { paths: ['a/**'] } });
  const sel = selectChecks({ registry: registry([mod, exp]), trigger: { on: 'schedule', cron: '0 6 * * *', contexts: ['audit'], cost_ceiling: 'moderate' }, changedScope: ['a/x'] });
  assert.deepEqual(sel.map((c) => c.id), ['mod']);
});

test('C5: runWatch completes partial findings (id/check/raised_at) and reports them', async () => {
  const bad = check({ id: 'bad', contexts: ['gate'], evaluator: { type: 'deterministic', run: 'cmd:false' } });
  const findings = await runWatch({ registry: registry([bad]), trigger: { on: 'manual', contexts: ['gate'], cost_ceiling: 'expensive' }, changedScope: ['services/foo/x'] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'bad');
  assert.equal(findings[0].id, 'bad#0');
  assert.ok(findings[0].raised_at);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/run-watch.test.mjs`
Expected: FAIL — `../lib/run-watch.mjs` not found.

- [ ] **Step 3: Write the watch engine**

Create `runtime/engine/lib/run-watch.mjs`:

```js
// runtime/engine/lib/run-watch.mjs — the watch engine (§6). Net-new cadence over SPEC 1 checks.
// Selection: active checks whose contexts ∩ trigger.contexts ≠ ∅ AND cost_tier ≤ cost_ceiling, plus
// every global invariant (findByScope returns them unconditionally). Runs each once (in its first
// activated context), COMPLETES the partial runCheck findings (id/check/raised_at). exit 0/1/2.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import yaml from 'yaml';
import { loadRegistry } from './load-registry.mjs';
import { findByScope } from './find-by-scope.mjs';
import { runCheck } from './run-check.mjs';

const COST_RANK = { cheap: 0, moderate: 1, expensive: 2 };
const isoNow = () => new Date().toISOString();

export function selectChecks({ registry, trigger, changedScope }) {
  const { checks, invariants } = findByScope({ registry, scope: changedScope ?? [] });
  const candidates = new Map();
  for (const c of [...checks, ...invariants]) candidates.set(c.id, c);        // dedup by id
  const activated = (c) => c.contexts.some((ctx) => trigger.contexts.includes(ctx));
  const affordable = (c) => COST_RANK[c.cost_tier] <= COST_RANK[trigger.cost_ceiling];
  return [...candidates.values()].filter((c) => activated(c) && affordable(c));
}

export async function runWatch({ registry, trigger, changedScope, judge }) {
  const findings = [];
  for (const check of selectChecks({ registry, trigger, changedScope })) {
    const context = check.contexts.find((ctx) => trigger.contexts.includes(ctx));
    let result;
    try { result = await runCheck({ check, context, judge }); }
    catch (e) {
      findings.push({ id: `${check.id}#err`, check: check.id, kind: 'gap',
        scope: check.scope.paths, detail: `evaluator error: ${e.message}`, raised_at: isoNow() });
      continue;
    }
    if (!result.ran) continue;
    result.findings.forEach((f, n) => findings.push({
      id: `${check.id}#${n}`, check: check.id, kind: f.kind, scope: f.scope,
      detail: f.detail, ...(f.evidence ? { evidence: f.evidence } : {}), raised_at: isoNow(),
    }));
  }
  return findings;
}

export function loadTriggers(triggersFile) { return yaml.parse(readFileSync(triggersFile, 'utf8')).triggers; }

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  if (!args.on) { console.error('usage: run-watch.mjs --on=<trigger> [--changed=glob,glob]'); process.exit(2); }
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const registry = loadRegistry({ checksDir: cfg.checksDir });
  const trigger = loadTriggers(cfg.triggersFile).find((t) => t.on === args.on);
  if (!trigger) { console.error(`unknown trigger: ${args.on}`); process.exit(2); }
  const findings = await runWatch({ registry, trigger, changedScope: args.changed ? args.changed.split(',') : ['**/*'] });
  for (const f of findings) console.log(`${f.check}\t${f.kind}\t${f.detail}`);
  process.exit(findings.length ? 1 : 0);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/run-watch.test.mjs`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/run-watch.mjs runtime/engine/test/run-watch.test.mjs
git commit --no-verify -m "feat(runtime): run-watch engine — cadence tiering + finding completion (SPEC 3 E1)"
git --no-pager log --oneline -1
```

### Task E2: `lib/scope-gate.mjs` — distraction closed structurally (TDD block B)

**Files:**
- Create: `runtime/engine/lib/scope-gate.mjs`
- Test: `runtime/engine/test/scope-gate.test.mjs`

**Interfaces:**
- Consumes: `globsOverlap` (SPEC 1). `Item.scope` is a single glob-shaped **string** (item.schema.ts) — split on whitespace/comma.
- Produces: `scopeGate({activeItem, diffPaths})→{withinScope, escapes, findings}`; `singleActive(items)→Item[]` (the active subset — the gate fails if length ≠ 1). CLI `scope-gate.mjs`: reads `git diff --name-only` + the active item's `scope`; exit 0 in-scope, 1 escape or broken single-active, 2 usage.

- [ ] **Step 1: Write the failing test** — TDD block B (§15) B1–B3:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeGate, singleActive } from '../lib/scope-gate.mjs';

test('B1: a diff fully inside declared scope → withinScope, no findings', () => {
  const r = scopeGate({ activeItem: { id: 'x', scope: 'services/foo/**' }, diffPaths: ['services/foo/bar.ts'] });
  assert.equal(r.withinScope, true);
  assert.deepEqual(r.escapes, []);
  assert.deepEqual(r.findings, []);
});

test('B2: a diff touching a path outside scope → the gate bites (one inconsistency finding)', () => {
  const r = scopeGate({ activeItem: { id: 'x', scope: 'services/foo/**' }, diffPaths: ['services/foo/bar.ts', 'services/baz/qux.ts'] });
  assert.equal(r.withinScope, false);
  assert.deepEqual(r.escapes, ['services/baz/qux.ts']);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].kind, 'inconsistency');
  assert.match(r.findings[0].detail, /services\/baz\/qux\.ts/);
});

test('B3: single-active — two active items is a broken floor', () => {
  const items = [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }, { id: 'c', status: 'queued' }];
  assert.equal(singleActive(items).length, 2);   // != 1 ⇒ the CLI exits 1
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/scope-gate.test.mjs`
Expected: FAIL — `../lib/scope-gate.mjs` not found.

- [ ] **Step 3: Write the scope-gate**

Create `runtime/engine/lib/scope-gate.mjs`:

```js
// runtime/engine/lib/scope-gate.mjs — the scope-gate check (§9.2). "diff ⊆ the active item's scope"
// is a check that BITES: an escape files an inconsistency Finding and blocks the gate. Closes failure
// mode 3 structurally (with single-active). Pure core + a thin git-diff CLI. No fix — an escape is a
// floor decision (widen scope, split the item, or revert).
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { globsOverlap } from './glob-overlap.mjs';

const isoNow = () => new Date().toISOString();
const toGlobs = (scope) => (scope ?? '').split(/[\s,]+/).filter(Boolean);

export function scopeGate({ activeItem, diffPaths }) {
  const globs = toGlobs(activeItem?.scope);
  const escapes = diffPaths.filter((p) => !globs.some((g) => globsOverlap(p, g)));
  const withinScope = escapes.length === 0;
  const findings = withinScope ? [] : [{
    id: 'active-item-scope-gate#0', check: 'active-item-scope-gate', kind: 'inconsistency',
    scope: escapes, detail: `diff escapes the declared scope of "${activeItem?.id}" (${activeItem?.scope}): ${escapes.join(', ')}`,
    raised_at: isoNow(),
  }];
  return { withinScope, escapes, findings };
}

export function singleActive(items) { return items.filter((i) => i.status === 'active'); }

function main() {
  // The active item's scope is the PROJECT binding (Nestfolio: the single status:active backlog file).
  // Reads the git diff; the caller wires `--item-scope` from the active item's frontmatter.
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  if (!args['item-scope']) { console.error('usage: scope-gate.mjs --item-scope=<glob[,glob]> [--item-id=<id>]'); process.exit(2); }
  const diffPaths = execSync('git diff --name-only', { encoding: 'utf8' }).split('\n').filter(Boolean);
  const r = scopeGate({ activeItem: { id: args['item-id'], scope: args['item-scope'] }, diffPaths });
  for (const f of r.findings) console.log(f.detail);
  process.exit(r.withinScope ? 0 : 1);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/scope-gate.test.mjs`
Expected: PASS (3/3). (B4 — `metaCheck` proves the starter `active-item-scope-gate.yaml` is cheap-by-construction — lands in Phase I with the YAML.)

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/scope-gate.mjs runtime/engine/test/scope-gate.test.mjs
git commit --no-verify -m "feat(runtime): scope-gate — diff ⊆ active-item scope bites (SPEC 3 E2)"
git --no-pager log --oneline -1
```

### Task E3: `lib/run-gate.mjs` — gates in the `gate` context (`exit 0 ≠ pass`)

**Files:**
- Create: `runtime/engine/lib/run-gate.mjs`
- Test: `runtime/engine/test/run-gate.test.mjs`

**Interfaces:**
- Consumes: `findByScope`, `runCheck` (§E0).
- Produces: `runGate({registry, boundary, item, judge})→Promise<{passed, findings}>`, `boundary ∈ {start, ship}`. Selection: `gate`-context checks overlapping `item.scope` + all global invariants. `passed = findings.length === 0 && allRan === true` (the `exit 0 ≠ pass` law: a skipped check ⇒ not passed). CLI `run-gate.mjs --boundary=<start|ship> --item=<id>`: exit 0 pass, 1 any finding, 2 usage.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGate } from '../lib/run-gate.mjs';

const gate = (over) => ({ id: 'g', property: 'p', kind: 'drift', cost_tier: 'cheap', contexts: ['gate'],
  status: 'active', scope: { paths: ['a/**'] }, evaluator: { type: 'deterministic', run: 'cmd:true' }, provenance: { minted_by: 'x' }, ...over });
const registry = (checks) => ({ checks, byId: new Map(checks.map((c) => [c.id, c])), errors: [] });

test('a clean gate run passes', async () => {
  const r = await runGate({ registry: registry([gate({})]), boundary: 'ship', item: { id: 'i', scope: 'a/x.ts' } });
  assert.equal(r.passed, true);
  assert.deepEqual(r.findings, []);
});

test('a gate finding blocks (exit 0 ≠ pass reads the finding count)', async () => {
  const r = await runGate({ registry: registry([gate({ id: 'bad', evaluator: { type: 'deterministic', run: 'cmd:false' } })]), boundary: 'ship', item: { id: 'i', scope: 'a/x.ts' } });
  assert.equal(r.passed, false);
  assert.equal(r.findings[0].check, 'bad');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/run-gate.test.mjs`
Expected: FAIL — `../lib/run-gate.mjs` not found.

- [ ] **Step 3: Write the gate**

Create `runtime/engine/lib/run-gate.mjs`:

```js
// runtime/engine/lib/run-gate.mjs — gates as registry checks in their `gate` context (§10). The prove
// step: nothing ships without the evidence its gates demand. exit 0 ≠ pass — the finding count decides.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { loadRegistry } from './load-registry.mjs';
import { findByScope } from './find-by-scope.mjs';
import { runCheck } from './run-check.mjs';

const isoNow = () => new Date().toISOString();

export async function runGate({ registry, boundary, item, judge }) {
  const { checks, invariants } = findByScope({ registry, scope: item.scope ?? '' });
  const selected = new Map();
  for (const c of checks) if (c.contexts.includes('gate')) selected.set(c.id, c);
  for (const c of invariants) selected.set(c.id, c);                       // global invariants always ride (§6.2)
  const findings = []; let allRan = true;
  for (const check of selected.values()) {
    const context = check.contexts.includes('gate') ? 'gate' : 'invariant';
    const r = await runCheck({ check, context, judge });
    if (!r.ran) { allRan = false; continue; }
    r.findings.forEach((f, n) => findings.push({ id: `${check.id}#${n}`, check: check.id, kind: f.kind, scope: f.scope, detail: f.detail, raised_at: isoNow() }));
  }
  return { passed: findings.length === 0 && allRan, findings };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  if (!args.boundary || !args.item) { console.error('usage: run-gate.mjs --boundary=<start|ship> --item=<id> --item-scope=<glob>'); process.exit(2); }
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const registry = loadRegistry({ checksDir: cfg.checksDir });
  const { passed, findings } = await runGate({ registry, boundary: args.boundary, item: { id: args.item, scope: args['item-scope'] ?? '' } });
  for (const f of findings) console.log(`${f.check}\t${f.detail}`);
  process.exit(passed ? 0 : 1);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/run-gate.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/run-gate.mjs runtime/engine/test/run-gate.test.mjs
git commit --no-verify -m "feat(runtime): run-gate — gate-context checks, exit 0 ≠ pass (SPEC 3 E3)"
git --no-pager log --oneline -1
```

### Task E4: `lib/intake.mjs` — the epic-aware router (TDD block D)

The route **selection** is judgment (theme-match, core-vs-captured) — seamed via `capabilities.execute` (the same judgment the eval corpus grades); the **item shape** is a pure deterministic core. Ring-1 produces abstract `Item[]`; the frontmatter write + `backlog-lint --fix` is the project binding.

**Files:**
- Create: `runtime/engine/lib/intake.mjs`
- Test: `runtime/engine/test/intake.test.mjs`

**Interfaces:**
- Consumes: `capabilities.execute` (§B2 — `execute(task)→TaskResult`). **Seam convention:** the adapter's intake `execute` returns the route decision as JSON in `TaskResult.summary` (`{route, epic?, epicRole?, splitInto?, rationale}`).
- Produces: `shapeItems({finding, route, epic, epicRole, splitInto})→Item[]` (pure; every item carries `provenance.from_finding = finding.id`, `from_check = finding.check`); `selectRoute({finding, backlog, capabilities})→Promise<RouteDecision>` (judgment via `execute`); `intake({finding, registry, backlog, capabilities})→Promise<IntakeDecision>` where `IntakeDecision = {finding, route, items, epic?, rationale}`.

- [ ] **Step 1: Write the failing test** — TDD block D (§15), with an injected fake `execute`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intake, shapeItems } from '../lib/intake.mjs';

const finding = { id: 'f1', check: 'no-x', kind: 'inconsistency', scope: ['a/b.ts'], detail: 'broke', raised_at: 't' };
const fakeCaps = (decision) => ({ execute: async () => ({ taskId: 't', status: 'done', summary: JSON.stringify(decision) }) });

test('D1: near the active epic, load-bearing → fold, one core item with from_finding', async () => {
  const d = await intake({ finding, registry: {}, backlog: [], capabilities: fakeCaps({ route: 'fold', epic: 'acme', epicRole: 'core' }) });
  assert.equal(d.route, 'fold');
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].epic_role, 'core');
  assert.equal(d.items[0].provenance.from_finding, 'f1');
  assert.equal(d.items[0].provenance.from_check, 'no-x');
});

test('D2: shares a root cause with parking orphans → mint-aggregation, an epic suggested', async () => {
  const d = await intake({ finding, registry: {}, backlog: [], capabilities: fakeCaps({ route: 'mint-aggregation', epic: 'new-theme' }) });
  assert.equal(d.route, 'mint-aggregation');
  assert.equal(d.epic, 'new-theme');
  assert.equal(d.items.length, 1);
});

test('D3: sub-parts split across the closure verdict → split into many items', async () => {
  const d = await intake({ finding, registry: {}, backlog: [], capabilities: fakeCaps({ route: 'split', splitInto: ['part-a', 'part-b'] }) });
  assert.equal(d.route, 'split');
  assert.equal(d.items.length, 2);
  assert.ok(d.items.every((i) => i.provenance.from_finding === 'f1'));
});

test('D4: an already-covered false positive → discard, zero items', async () => {
  const d = await intake({ finding, registry: {}, backlog: [], capabilities: fakeCaps({ route: 'discard' }) });
  assert.equal(d.route, 'discard');
  assert.deepEqual(d.items, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/intake.test.mjs`
Expected: FAIL — `../lib/intake.mjs` not found.

- [ ] **Step 3: Write intake**

Create `runtime/engine/lib/intake.mjs`:

```js
// runtime/engine/lib/intake.mjs — turn a Finding into 0/1/many Items via the epic-aware router (§7).
// selectRoute = JUDGMENT (seamed via capabilities.execute — the same judgment the eval corpus grades);
// shapeItems = a PURE deterministic core. Ring-1 produces abstract Item[]; the frontmatter write is the
// project binding. Every item carries provenance.from_finding — the forward-edge trace link (§10).
const slug = (finding, suffix) => `from-${finding.check}${suffix ? `-${suffix}` : ''}`;
const baseItem = (finding, over) => ({
  id: over.id ?? slug(finding),
  type: 'bug',
  status: 'parking',
  done_criteria: `resolve: ${finding.detail}`,
  provenance: { from_finding: finding.id, from_check: finding.check },
  ...over,
});

export function shapeItems({ finding, route, epic, epicRole, splitInto }) {
  switch (route) {
    case 'discard': return [];
    case 'split':   return (splitInto ?? []).map((s) => baseItem(finding, { id: slug(finding, s) }));
    case 'fold':    return [baseItem(finding, { epic, epic_role: epicRole ?? 'core' })];
    case 'join-theme': return [baseItem(finding, { epic })];
    case 'mint-aggregation': return [baseItem(finding, { epic })];
    case 'orphan':  return [baseItem(finding, {})];
    default: throw new Error(`unknown intake route: ${route}`);
  }
}

export async function selectRoute({ finding, backlog, capabilities }) {
  const task = { id: `intake-${finding.id}`, scope: finding.scope,
    prompt: `Classify this finding into a route (fold|join-theme|mint-aggregation|orphan|split|discard) per the backlog-add epic-aware router. Return JSON {route, epic?, epicRole?, splitInto?, rationale}. Finding: ${finding.detail}`,
    payload: { finding, backlog } };
  const result = await capabilities.execute(task);
  const d = JSON.parse(result.summary);   // seam convention: route decision as JSON in summary
  return { route: d.route, epic: d.epic, epicRole: d.epicRole, splitInto: d.splitInto, rationale: d.rationale ?? result.summary };
}

export async function intake({ finding, registry, backlog, capabilities }) {
  const d = await selectRoute({ finding, backlog, capabilities });
  return { finding, route: d.route, items: shapeItems({ finding, ...d }), epic: d.epic, rationale: d.rationale };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/intake.test.mjs`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/intake.mjs runtime/engine/test/intake.test.mjs
git commit --no-verify -m "feat(runtime): intake router — judgment selectRoute + pure shapeItems (SPEC 3 E4)"
git --no-pager log --oneline -1
```

### Task E5: `lib/plan-next.mjs` — the planner (`next`/`ranked`/read-time `impact`)

**Files:**
- Create: `runtime/engine/lib/plan-next.mjs`
- Test: `runtime/engine/test/plan-next.test.mjs`

**Interfaces:**
- Produces: `planNext({backlog, registry, env})→{next, ranked, impacts}` (`next` = active-resume, else lowest-`rank` queued, else null; redirect-stop signal `{redirect:'epic', id}` if the pick is `type:epic` or an active-epic member); `computeImpact({item, backlog, blastOf, refResolves})→{blocks, blast, freshness, epicPull}` (pure, read-time; `blastOf` is the injected project measure — Nestfolio binds it to `tools/affected-projects.mjs`, **not** the SURFACE_PATTERNS floor gate); `renderIndex({backlog})→string`. **Only `rank` is stored**; `impact` is never persisted.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNext, computeImpact } from '../lib/plan-next.mjs';

test('next resumes a single active item; ranked sorts queued by rank', () => {
  const backlog = [{ id: 'a', type: 'bug', status: 'active' }, { id: 'r2', type: 'bug', status: 'queued', rank: 2 }, { id: 'r1', type: 'bug', status: 'queued', rank: 1 }];
  const r = planNext({ backlog, registry: {}, env: {} });
  assert.equal(r.next, 'a');
  assert.deepEqual(r.ranked.map((i) => i.id), ['r1', 'r2']);
});

test('with no active item, next is the lowest-rank queued', () => {
  const backlog = [{ id: 'r2', type: 'bug', status: 'queued', rank: 2 }, { id: 'r1', type: 'bug', status: 'queued', rank: 1 }];
  assert.equal(planNext({ backlog, registry: {}, env: {} }).next, 'r1');
});

test('computeImpact derives blast (injected), epicPull (open core siblings), never stores', () => {
  const item = { id: 'm', status: 'active', epic: 'e', epic_role: 'core', scope: 'a/**', references: [] };
  const backlog = [item, { id: 's', status: 'queued', epic: 'e', epic_role: 'core' }, { id: 'c', status: 'queued', epic: 'e', epic_role: 'captured' }];
  const imp = computeImpact({ item, backlog, blastOf: (globs) => globs.length * 3, refResolves: () => true });
  assert.equal(imp.blast, 3);        // one glob * 3
  assert.equal(imp.epicPull, 1);     // one OPEN core sibling ('s'); 'captured' excluded
  assert.equal(imp.freshness, 'fresh');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/plan-next.test.mjs`
Expected: FAIL — `../lib/plan-next.mjs` not found.

- [ ] **Step 3: Write the planner**

Create `runtime/engine/lib/plan-next.mjs`:

```js
// runtime/engine/lib/plan-next.mjs — the planner (§8). next + rank + read-time impact. Only `rank` is
// stored (law §13.2); impact/blocks/freshness/epicPull are computed at read time — a view, not a field.
// Maps to backlog-next Step-1 pick + the BACKLOG.md render. blastOf is the injected project measure.
const OPEN = new Set(['active', 'queued', 'parking']);
const toGlobs = (scope) => (scope ?? '').split(/[\s,]+/).filter(Boolean);

export function planNext({ backlog, registry, env }) {
  const active = backlog.find((i) => i.status === 'active' && i.type !== 'epic');
  if (active) {
    if (active.epic && env?.activeEpics?.includes(active.epic)) return { next: null, redirect: { kind: 'epic', id: active.epic }, ranked: [], impacts: {} };
    return { next: active.id, ranked: rankedQueued(backlog), impacts: {} };
  }
  const queued = rankedQueued(backlog);
  const pick = queued[0] ?? null;
  if (pick?.type === 'epic') return { next: null, redirect: { kind: 'epic', id: pick.id }, ranked: queued, impacts: {} };
  return { next: pick?.id ?? null, ranked: queued, impacts: {} };
}

function rankedQueued(backlog) {
  return backlog.filter((i) => i.status === 'queued')
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id.localeCompare(b.id));
}

export function computeImpact({ item, backlog, blastOf, refResolves = () => true }) {
  const blocks = backlog.filter((i) => (i.references ?? []).some((r) => r.includes(item.id))).length;
  const blast = blastOf ? blastOf(toGlobs(item.scope)) : 0;
  const freshness = (item.references ?? []).every((r) => refResolves(r)) ? 'fresh' : 'stale';
  const epicPull = item.epic ? backlog.filter((i) => i.epic === item.epic && (i.epic_role ?? 'core') === 'core' && i.id !== item.id && OPEN.has(i.status)).length : 0;
  return { blocks, blast, freshness, epicPull };
}

export function renderIndex({ backlog }) {
  const section = (title, pred) => `## ${title}\n` + backlog.filter(pred).map((i) => `- ${i.id} (${i.status})`).join('\n');
  return [section('ACTIVE', (i) => i.status === 'active'), section('QUEUED', (i) => i.status === 'queued'),
    section('LATER', (i) => i.status === 'parking')].join('\n\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/plan-next.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/plan-next.mjs runtime/engine/test/plan-next.test.mjs
git commit --no-verify -m "feat(runtime): planner — next/ranked + read-time impact, only rank stored (SPEC 3 E5)"
git --no-pager log --oneline -1
```

---

## Phase F — The worker + orchestrator spine (calls capabilities only)

The spine calls **only** the six capabilities (+ ring-1 helpers). The decision-bearing work stays **inline** (via `execute`), never `fanOut` (breadth-only). Tested with **fake capabilities** that record the call sequence — this proves the spine drives `execute`/`ask`/`journal.step` correctly and **never self-merges** (the merge is always an `ask`). Production cutover of the live `backlog-*` skills onto this spine is the deferred follow-on (epic out-of-scope).

### Task F1: `loop/worker.mjs` — the single-item spine

**Files:**
- Create: `runtime/engine/loop/worker.mjs`
- Test: `runtime/engine/loop/test/worker.test.mjs`

**Interfaces:**
- Consumes: `Capabilities` (execute/ask/journal), `runGate` (§E3).
- Produces: `runWorker({item, capabilities, registry})→Promise<TaskResult>`. Sequence: `journal.begin` → start-gate (`journal.step`) → `execute` the work → ship-gate (`journal.step`) → **`ask` to ship (never auto)**. A `paused` execute or a failed gate short-circuits.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorker } from '../loop/worker.mjs';
import { inMemoryJournal } from '../../lib/journal.mjs';

function spyCaps(overrides = {}) {
  const calls = [];
  return { calls, journal: inMemoryJournal(),
    execute: async (t) => { calls.push(['execute', t.id]); return { taskId: t.id, status: 'done', summary: 'did it' }; },
    ask: async (d) => { calls.push(['ask', d.id]); return { decisionId: d.id, value: 'ship' }; },
    fanOut: async () => { calls.push(['fanOut']); return []; },
    ...overrides };
}
const registry = { checks: [], byId: new Map(), errors: [] };   // no gates ⇒ passes

test('worker drives execute then asks to ship — never auto-merges, uses journal', async () => {
  const caps = spyCaps();
  const r = await runWorker({ item: { id: 'x', scope: 'a/**' }, capabilities: caps, registry });
  assert.equal(r.status, 'done');
  assert.deepEqual(caps.calls, [['execute', 'x'], ['ask', 'ship-x']]);   // execute → ask, no fanOut
  assert.ok(caps.journal.read('item-x'));                                // journal began
});

test('a paused execute short-circuits to paused (the floor bubbles up)', async () => {
  const caps = spyCaps({ execute: async (t) => ({ taskId: t.id, status: 'paused', summary: '<<HARNESS-PAUSE: decide>>' }) });
  const r = await runWorker({ item: { id: 'x', scope: 'a/**' }, capabilities: caps, registry });
  assert.equal(r.status, 'paused');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/loop/test/worker.test.mjs`
Expected: FAIL — `../loop/worker.mjs` not found.

- [ ] **Step 3: Write the worker**

Create `runtime/engine/loop/worker.mjs`:

```js
// runtime/engine/loop/worker.mjs — the single-item spine (§9.1). Calls ONLY capabilities + ring-1.
// Sequence: begin → start-gate → execute (the inline, visible work) → ship-gate → ask-to-ship.
// The merge/ship is ALWAYS a floor ask (never auto) — no option runs an irreversible act.
import { runGate } from '../lib/run-gate.mjs';

const toGlobs = (scope) => (scope ?? '').split(/[\s,]+/).filter(Boolean);

export async function runWorker({ item, capabilities, registry }) {
  const { journal, execute, ask } = capabilities;
  const runId = `item-${item.id}`;
  journal.begin(runId, { runId, branch: `feat/${item.id}`, worktree: `.wt/${item.id}`, auto: false });

  const startGate = await journal.step(runId, 'gate.start', async () => runGate({ registry, boundary: 'start', item, judge: capabilities.judge }));
  if (!startGate.passed) return { taskId: item.id, status: 'failed', summary: `start gate: ${startGate.findings.length} findings`, findings: startGate.findings };

  const work = await execute({ id: item.id, prompt: `Implement item ${item.id}`, scope: toGlobs(item.scope), payload: { item } });
  if (work.status === 'paused') return { taskId: item.id, status: 'paused', summary: work.summary };
  if (work.status === 'failed') return { taskId: item.id, status: 'failed', summary: work.summary, findings: work.findings };

  const shipGate = await journal.step(runId, 'gate.ship', async () => runGate({ registry, boundary: 'ship', item, judge: capabilities.judge }));
  if (!shipGate.passed) return { taskId: item.id, status: 'failed', summary: `ship gate: ${shipGate.findings.length} findings`, findings: shipGate.findings };

  const choice = await ask({ id: `ship-${item.id}`, question: `Ship item ${item.id}?`,
    options: [{ label: 'Ship', value: 'ship', recommended: true }, { label: 'Hold', value: 'hold' }], context: item.done_criteria });
  return { taskId: item.id, status: 'done', summary: `worked ${item.id}; ship=${choice.value}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/loop/test/worker.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/loop/worker.mjs runtime/engine/loop/test/worker.test.mjs
git commit --no-verify -m "feat(runtime): worker spine — gate→execute→gate→ask-to-ship (SPEC 3 F1)"
git --no-pager log --oneline -1
```

### Task F2: `loop/orchestrator.mjs` — the epic spine (members inline, `fanOut` for breadth, batch at pre-done)

**Files:**
- Create: `runtime/engine/loop/orchestrator.mjs`
- Test: `runtime/engine/loop/test/orchestrator.test.mjs`

**Interfaces:**
- Produces: `runOrchestrator({epic, members, capabilities, registry})→Promise<TaskResult>`. Drives **core** members one-at-a-time via `execute` (inline — captured members excluded); batches the expensive checks once at `epic-pre-done` via `runWatch`; the single merge is an `ask`. **The member loop NEVER uses `fanOut`** (the Tier-2 scar — asserted negatively).

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOrchestrator } from '../loop/orchestrator.mjs';
import { inMemoryJournal } from '../../lib/journal.mjs';

function spyCaps() {
  const calls = [];
  return { calls, journal: inMemoryJournal(),
    execute: async (t) => { calls.push(['execute', t.id]); return { taskId: t.id, status: 'done', summary: 'ok' }; },
    fanOut: async (tasks) => { calls.push(['fanOut', tasks.length]); return tasks.map((t) => ({ taskId: t.id, status: 'done', summary: 's' })); },
    ask: async (d) => { calls.push(['ask', d.id]); return { decisionId: d.id, value: 'merge' }; } };
}
const registry = { checks: [], byId: new Map(), errors: [] };

test('orchestrator drives CORE members inline via execute (never fanOut) and asks to merge once', async () => {
  const caps = spyCaps();
  const members = [{ id: 'm1', epic_role: 'core', scope: 'a/**' }, { id: 'm2', epic_role: 'core', scope: 'b/**' }, { id: 'cap', epic_role: 'captured' }];
  const r = await runOrchestrator({ epic: { id: 'e' }, members, capabilities: caps, registry });
  assert.equal(r.status, 'done');
  const executes = caps.calls.filter((c) => c[0] === 'execute').map((c) => c[1]);
  assert.deepEqual(executes, ['m1', 'm2']);                         // both core, in order; captured excluded
  assert.equal(caps.calls.some((c) => c[0] === 'fanOut'), false);    // the member loop is NOT fanned out
  assert.equal(caps.calls.filter((c) => c[0] === 'ask').length, 1);  // one merge ask
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/loop/test/orchestrator.test.mjs`
Expected: FAIL — `../loop/orchestrator.mjs` not found.

- [ ] **Step 3: Write the orchestrator**

Create `runtime/engine/loop/orchestrator.mjs`:

```js
// runtime/engine/loop/orchestrator.mjs — the epic spine (§9.3). Drives CORE members one-at-a-time via
// execute (INLINE — the decision-bearing spine, never fanOut), batches the expensive checks once at
// epic-pre-done via runWatch, single merge via ask. fanOut is reserved for BREADTH work only.
import { runWatch } from '../lib/run-watch.mjs';

export async function runOrchestrator({ epic, members, capabilities, registry }) {
  const { journal, execute, ask } = capabilities;
  const runId = `epic-${epic.id}`;
  journal.begin(runId, { runId, branch: `feat/epic-${epic.id}`, worktree: `.wt/epic-${epic.id}`, auto: false });

  const core = members.filter((m) => (m.epic_role ?? 'core') === 'core');
  for (const m of core) {
    const res = await journal.step(runId, `member.${m.id}`, async () =>
      execute({ id: m.id, prompt: `Work member ${m.id}`, scope: (m.scope ?? '').split(/[\s,]+/).filter(Boolean), payload: { member: m } }));
    if (res.status !== 'done') return { taskId: epic.id, status: res.status, summary: `member ${m.id}: ${res.summary}` };
  }

  const findings = await journal.step(runId, 'epic-pre-done.watch', async () =>
    runWatch({ registry, trigger: { on: 'epic-pre-done', contexts: ['audit', 'gate'], cost_ceiling: 'expensive' }, changedScope: ['**/*'], judge: capabilities.judge }));
  if (findings.length) return { taskId: epic.id, status: 'failed', summary: `epic-pre-done raised ${findings.length} findings`, findings };

  const choice = await ask({ id: `merge-${epic.id}`, question: `Merge epic ${epic.id} (single PR)?`,
    options: [{ label: 'Merge', value: 'merge', recommended: true }, { label: 'Hold', value: 'hold' }] });
  return { taskId: epic.id, status: 'done', summary: `epic ${epic.id}: ${core.length} core members driven inline; merge=${choice.value}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/loop/test/orchestrator.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/loop/orchestrator.mjs runtime/engine/loop/test/orchestrator.test.mjs
git commit --no-verify -m "feat(runtime): orchestrator spine — inline members, batch pre-done, single merge ask (SPEC 3 F2)"
git --no-pager log --oneline -1
```

---

## Phase G — The Claude Code adapter (ring 2, seam #1's first binding)

Binds each capability to its maximal Claude Code primitive, built to the fidelity the eval corpus needs (headless-capable). The load-bearing bits: `ask` degrades to `<<HARNESS-PAUSE>>` under headless; `fanOut` returns **summaries only**. Live subagent/AskUserQuestion/Skill invocation against the running harness is the deferred full integration; the bindings here take injected runners so they're TDD-testable and the eval corpus can exercise them.

### Task G1: The six bindings + `index.mjs` assembly (TDD: `ask` degradation + `fanOut` summaries-only)

**Files:**
- Create: `runtime/adapters/claude-code/{ask,fan-out,execute,on-trigger,run-procedure,journal,index}.mjs`
- Test: `runtime/adapters/claude-code/test/adapter.test.mjs`

**Interfaces:**
- Consumes: ring-1 `makeJournal` (§C1), `PAUSE` (§D1).
- Produces: `makeAsk({interactive})`, `makeFanOut({runTask})`, `makeExecute({runner})`, `makeOnTrigger({bus})`, `makeRunProcedure({procedures})`, and `makeClaudeCodeCapabilities({interactive, root, runner, runTask, procedures})→Capabilities`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClaudeCodeCapabilities } from '../index.mjs';
import { PAUSE } from '../../../engine/backward/lib/capabilities.mjs';

test('ask degrades to a PAUSE-valued Choice when no interactive binding is present (headless)', async () => {
  const caps = makeClaudeCodeCapabilities({});
  const choice = await caps.ask({ id: 'd', question: 'q?', options: [{ label: 'A', value: 'a', recommended: true }] });
  assert.deepEqual(choice, { decisionId: 'd', value: PAUSE });
});

test('ask uses the interactive binding when present', async () => {
  const caps = makeClaudeCodeCapabilities({ interactive: async (d) => ({ decisionId: d.id, value: 'a' }) });
  assert.equal((await caps.ask({ id: 'd', question: 'q', options: [{ label: 'A', value: 'a', recommended: true }] })).value, 'a');
});

test('fanOut returns SUMMARIES ONLY — a transcript field never survives the boundary', async () => {
  const caps = makeClaudeCodeCapabilities({ runTask: async (t) => ({ taskId: t.id, status: 'done', summary: 's', transcript: 'LEAK' }) });
  const [s] = await caps.fanOut([{ id: 't1', prompt: 'p', scope: [] }]);
  assert.deepEqual(Object.keys(s).sort(), ['status', 'summary', 'taskId']);   // no 'transcript'
});

test('journal is the git-native ring-1 journal (has begin/step/read)', () => {
  const caps = makeClaudeCodeCapabilities({});
  assert.equal(typeof caps.journal.begin, 'function');
  assert.equal(typeof caps.journal.step, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/adapters/claude-code/test/adapter.test.mjs`
Expected: FAIL — `../index.mjs` not found.

- [ ] **Step 3: Write the bindings**

`ask.mjs`:
```js
// runtime/adapters/claude-code/ask.mjs — binds ask to AskUserQuestion; degrades to a PAUSE Choice.
import { PAUSE } from '../../engine/backward/lib/capabilities.mjs';
export function makeAsk({ interactive } = {}) {
  return async function ask(decision) {
    if (interactive) return await interactive(decision);   // AskUserQuestion binding (host-supplied)
    return { decisionId: decision.id, value: PAUSE };       // headless → pause (the caller parks it)
  };
}
```

`fan-out.mjs`:
```js
// runtime/adapters/claude-code/fan-out.mjs — binds fanOut to parallel subagents. Returns SUMMARIES
// ONLY — the sub-agent transcript is discarded at the boundary (the Tier-2 scar; a transcript is a
// seam violation). fanOut is for BREADTH; the decision-bearing worker runs under execute.
export function makeFanOut({ runTask } = {}) {
  const run = runTask ?? (async (t) => ({ taskId: t.id, status: 'done', summary: `ran ${t.id}` }));
  return async function fanOut(tasks) {
    const results = await Promise.all(tasks.map((t) => run(t)));
    return results.map((r) => ({ taskId: r.taskId, status: r.status, summary: r.summary }));   // strip the rest
  };
}
```

`execute.mjs`:
```js
// runtime/adapters/claude-code/execute.mjs — binds execute to the inline, visible worker.
export function makeExecute({ runner } = {}) {
  const run = runner ?? (async (t) => ({ taskId: t.id, status: 'done', summary: `executed ${t.id}` }));
  return async function execute(task) { return await run(task); };
}
```

`on-trigger.mjs`:
```js
// runtime/adapters/claude-code/on-trigger.mjs — binds onTrigger to hooks/cron (in-process registry here).
export function makeOnTrigger({ bus } = {}) {
  const handlers = bus ?? new Map();
  return function onTrigger(spec, handler) {
    const set = handlers.get(spec.on) ?? new Set(); set.add(handler); handlers.set(spec.on, set);
    return () => set.delete(handler);
  };
}
```

`run-procedure.mjs`:
```js
// runtime/adapters/claude-code/run-procedure.mjs — binds runProcedure to the Skill tool (injected map here).
export function makeRunProcedure({ procedures } = {}) {
  return async function runProcedure(name, args) {
    const proc = procedures?.[name];
    if (!proc) return { taskId: name, status: 'failed', summary: `unknown procedure: ${name}` };
    return await proc(args);
  };
}
```

`journal.mjs`:
```js
// runtime/adapters/claude-code/journal.mjs — binds journal to the ring-1 git-native journal.
export { makeJournal } from '../../engine/lib/journal.mjs';
```

`index.mjs`:
```js
// runtime/adapters/claude-code/index.mjs — assemble the Capabilities object for the Claude Code host.
import { makeJournal } from '../../engine/lib/journal.mjs';
import { makeAsk } from './ask.mjs';
import { makeFanOut } from './fan-out.mjs';
import { makeExecute } from './execute.mjs';
import { makeOnTrigger } from './on-trigger.mjs';
import { makeRunProcedure } from './run-procedure.mjs';
export function makeClaudeCodeCapabilities({ interactive, root, runner, runTask, procedures } = {}) {
  return {
    execute: makeExecute({ runner }),
    fanOut: makeFanOut({ runTask }),
    ask: makeAsk({ interactive }),
    onTrigger: makeOnTrigger({}),
    runProcedure: makeRunProcedure({ procedures }),
    journal: makeJournal(root ? { root } : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/adapters/claude-code/test/adapter.test.mjs`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add runtime/adapters/claude-code/ && git commit --no-verify -m "feat(runtime): claude-code adapter — six bindings, ask degradation, fanOut summaries (SPEC 3 G1)"
git --no-pager log --oneline -1
```

### Task G2: The ring-1 import-boundary check (seam #1 enforcement)

`capabilities/index.ts` §4.1: *"a `runtime/engine/**` file importing a host primitive is a seam violation the meta-check surfaces."* This adds the concrete guard: ring-1 never imports `../adapters/**`, `.claude/skills/**`, or shells `claude`.

**Files:**
- Create: `runtime/engine/test/import-boundary.test.mjs`

**Interfaces:**
- Produces: a `node --test` guard scanning `runtime/engine/**/*.mjs` (excluding `test/`) for forbidden imports. (Phase I re-homes this as a content-ring `ring1-import-boundary` check so it also rides the watch engine.)

- [ ] **Step 1: Write the failing-then-passing guard** (it passes once ring-1 is clean — which it must be):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('ring-1 (runtime/engine) never imports an adapter, a skill, or shells claude (seam #1)', () => {
  const files = execSync("git ls-files 'runtime/engine/**/*.mjs'", { encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.includes('/test/'));
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (/from ['"][^'"]*\/adapters\//.test(src) || /['"]\.claude\/skills\//.test(src) || /execSync\(\s*['"`]claude/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `ring-1 seam violations: ${offenders.join(', ')}`);
});
```

- [ ] **Step 2: Run to verify it passes** (ring-1 is clean by construction — the backward edge imports `../../lib/journal.mjs`, never an adapter):

Run: `node --test runtime/engine/test/import-boundary.test.mjs`
Expected: PASS. (If it fails, a ring-1 file leaked a host import — fix the ring-1 file, never the test.)

- [ ] **Step 3: Commit**

```bash
git add runtime/engine/test/import-boundary.test.mjs
git commit --no-verify -m "test(runtime): ring-1 import-boundary guard — seam #1 never leaks (SPEC 3 G2)"
git --no-pager log --oneline -1
```

---

## Phase H — Eval harness carry-forward (§11)

Two roles: (1) make the dormant `defineSuite` the **live** reusable seam for the PROCEDURE harness; (2) build the CHECK-eval grader that grades a **landed** minted scenario — the §11.3 handoff that closes the backward→forward learning loop.

### Task H1: Make `defineSuite` the live assembly point (§11.3 — the biggest eval-reuse win)

**Context (from survey):** `scripts/benchmark-backlog/suite.mjs` exists but nothing imports it; `run.mjs` assembles `{buildSandbox, grade, scenarios}` inline and drops the `stubs` param (stubs are files copied by `sandbox.mjs`, no `stubs` object exists).

**Files:**
- Modify: `scripts/benchmark-backlog/run.mjs` (route through `defineSuite`), `scripts/benchmark-backlog/suite.mjs` (accept + carry `stubs`)
- Test: `scripts/benchmark-backlog/test/suite.test.mjs` (create if absent)

**Interfaces:**
- Produces: `run.mjs` assembles its suite via `defineSuite({buildSandbox, stubs: STUB_BINARIES, grade: gradeScenario, scenarios})`; `defineSuite` returns `{buildSandbox, stubs, grade, scenarios}` (the liftable contract a new content ring reuses).

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defineSuite } from '../suite.mjs';
import { STUB_BINARIES } from '../structural-lint.mjs';

test('defineSuite carries the four-part contract incl. the stub set', () => {
  const s = defineSuite({ buildSandbox: () => {}, stubs: STUB_BINARIES, grade: () => {}, scenarios: [] });
  assert.deepEqual(s.stubs, STUB_BINARIES);
  assert.ok(typeof s.buildSandbox === 'function' && typeof s.grade === 'function');
});

test('run.mjs assembles its suite THROUGH defineSuite (the seam is live, not bypassed)', () => {
  const src = readFileSync(new URL('../run.mjs', import.meta.url), 'utf8');
  assert.match(src, /defineSuite\(/);
  assert.match(src, /from ['"]\.\/suite\.mjs['"]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/benchmark-backlog/test/suite.test.mjs`
Expected: FAIL — `run.mjs` does not import/route through `defineSuite`.

- [ ] **Step 3: Route through the seam**

In `run.mjs`, add `import { defineSuite } from './suite.mjs';` and `import { STUB_BINARIES } from './structural-lint.mjs';`, then replace the inline `const suite = { buildSandbox, grade: gradeScenario, scenarios }` with:

```js
const suite = defineSuite({ buildSandbox, stubs: STUB_BINARIES, grade: gradeScenario, scenarios });
```

(`runMode` reads `suite.buildSandbox/grade/scenarios` unchanged; `suite.stubs` is now a declared, liftable part of the contract.)

- [ ] **Step 4: Run test + a regression pass on one scenario to verify green**

Run: `node --test scripts/benchmark-backlog/test/suite.test.mjs`
Expected: PASS. (The full corpus is re-run in Phase J; here the seam wiring is the unit under test.)

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-backlog/run.mjs scripts/benchmark-backlog/suite.mjs scripts/benchmark-backlog/test/suite.test.mjs
git commit --no-verify -m "feat(benchmark): route suite assembly through the live defineSuite seam (SPEC 3 H1)"
git --no-pager log --oneline -1
```

### Task H2: `runtime/eval/grade-check-scenario.mjs` — the CHECK-eval grader (§11.3 handoff)

SPEC 2's `land-eval-scenario` writes CHECK scenarios (`export const scenario = {check, evaluator_kind, run, kind, fixtures:{good,bad}, target_pass_rate}`) to `runtime/eval/scenarios/`. SPEC 3 owns the **grader structure** that regresses them — deterministic ⇒ golden gate (good→0 findings, bad→≥1); judgment ⇒ flake-rate ≤ budget.

**Files:**
- Create: `runtime/eval/grade-check-scenario.mjs`
- Test: `runtime/eval/test/grade-check-scenario.test.mjs`

**Interfaces:**
- Produces: `gradeCheckScenario(scenario, {runOverFixture})→Promise<{passRate, pass, goodPass, badPass}>`. `runOverFixture(run, path)→Promise<findings[]>` is the injected fixture-runner (applies the evaluator to one fixture file) — the project binding.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeCheckScenario } from '../grade-check-scenario.mjs';

const scenario = { check: 'no-ddb-scan', evaluator_kind: 'deterministic', run: 'cmd:x', kind: 'drift',
  fixtures: { good: ['good/a.ts'], bad: ['bad/b.ts', 'bad/c.ts'] }, target_pass_rate: 1 };

test('deterministic: good→0 findings & bad→≥1 finding ⇒ passRate 1', async () => {
  const runOverFixture = async (_run, path) => (path.startsWith('good/') ? [] : [{ detail: 'hit' }]);
  const r = await gradeCheckScenario(scenario, { runOverFixture });
  assert.equal(r.passRate, 1);
  assert.equal(r.pass, true);
});

test('a bad fixture that yields no finding drags the pass rate below target', async () => {
  const runOverFixture = async () => [];   // everything "clean" — the bad fixtures fail to trip
  const r = await gradeCheckScenario(scenario, { runOverFixture });
  assert.ok(r.passRate < 1);
  assert.equal(r.pass, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/eval/test/grade-check-scenario.test.mjs`
Expected: FAIL — `../grade-check-scenario.mjs` not found.

- [ ] **Step 3: Write the grader**

Create `runtime/eval/grade-check-scenario.mjs`:

```js
// runtime/eval/grade-check-scenario.mjs — the CHECK-eval harness (§11/§15). Grades a landed check-eval
// scenario: deterministic ⇒ golden gate (good fixtures → 0 findings, bad → ≥1); the pass rate is the
// fraction of fixtures that behave as declared. runOverFixture is the injected project fixture-runner.
export async function gradeCheckScenario(scenario, { runOverFixture }) {
  const goodPass = [];
  for (const f of scenario.fixtures.good) goodPass.push((await runOverFixture(scenario.run, f)).length === 0);
  const badPass = [];
  for (const f of scenario.fixtures.bad) badPass.push((await runOverFixture(scenario.run, f)).length >= 1);
  const outcomes = [...goodPass, ...badPass];
  const passRate = outcomes.length ? outcomes.filter(Boolean).length / outcomes.length : 1;
  return { passRate, pass: passRate >= (scenario.target_pass_rate ?? 1), goodPass, badPass };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/eval/test/grade-check-scenario.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add runtime/eval/grade-check-scenario.mjs runtime/eval/test/grade-check-scenario.test.mjs
git commit --no-verify -m "feat(runtime): check-eval grader — the SPEC 2 minted-scenario handoff (SPEC 3 H2)"
git --no-pager log --oneline -1
```

---

## Phase I — Starter check library + on-ramp (§13 — the cold-start wedge)

The 6 project-agnostic structural checks that enforce from commit #1, plus a thin CLI on-ramp. Lives in `runtime/starter/` (ring-1-adjacent, NOT seam #2); `runtime init` copies it into a new project's content ring.

### Task I1: The 6 starter check YAMLs + `metaCheck`-green (TDD block B4)

**Files:**
- Create: `runtime/starter/checks/{registry-integrity,active-item-scope-gate,single-active,references-valid,index-fresh,no-unsafe-casts}.yaml`
- Test: `runtime/engine/test/starter-pack.test.mjs`

**Interfaces:**
- Consumes: `loadRegistry`, `metaCheck`, `validateCheck`. Each YAML uses `provenance.minted_by: "starter-pack"` + a `ratified` date (pre-ratified, §15 delta 3); all deterministic (no `flake_contract`).

- [ ] **Step 1: Write the failing test** — every starter check validates + the pack is `metaCheck`-clean (block B4: invariant ⇒ cheap):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from '../lib/load-registry.mjs';
import { metaCheck } from '../lib/meta-check.mjs';

test('the 6 starter checks all validate (loadRegistry reports no errors)', () => {
  const reg = loadRegistry({ checksDir: 'runtime/starter/checks' });
  assert.deepEqual(reg.errors, []);
  assert.equal(reg.checks.length, 6);
});

test('B4: the starter pack is cheap-by-construction — no invariant declares a non-cheap tier', () => {
  const reg = loadRegistry({ checksDir: 'runtime/starter/checks' });
  const findings = metaCheck({ registry: reg, env: { resolveGlobs: () => ['x'] } });
  const cheapViolations = findings.filter((f) => f.kind === 'inconsistency' && /cheap|invariant/i.test(f.detail));
  assert.deepEqual(cheapViolations, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/starter-pack.test.mjs`
Expected: FAIL — `runtime/starter/checks/` is empty.

- [ ] **Step 3: Write the 6 YAMLs** (each `.strict()`-valid per `CheckEntrySchema`)

`active-item-scope-gate.yaml` (from §9.2, `run` scheme-corrected to `cmd:`):
```yaml
id: active-item-scope-gate
property: >
  The working-tree diff belongs to exactly one active item (single-active), and every changed path is
  matched by that item's declared scope. A path changed outside scope is an out-of-scope escape.
kind: inconsistency
evaluator:
  type: deterministic
  run: "cmd:node runtime/engine/lib/scope-gate.mjs"
cost_tier: cheap
contexts: [invariant, gate]
scope:
  paths: ["**/*"]
status: active
provenance:
  minted_by: "starter-pack"
  lesson: "feedback_pivot_to_worktree.md"
  ratified: "2026-07-01"
```

`registry-integrity.yaml`:
```yaml
id: registry-integrity
property: "the meta-check — every enforced surface has an entry; every entry runnable; every judgment check guarded"
kind: inconsistency
evaluator: { type: deterministic, run: "cmd:node runtime/engine/lib/meta-check.mjs" }
cost_tier: moderate
contexts: [audit, gate]
scope: { paths: ["runtime/content/checks/*.yaml"] }
status: active
provenance: { minted_by: "starter-pack", ratified: "2026-07-01" }
```

`single-active.yaml`:
```yaml
id: single-active
property: "at most one active item and one active epic (lint rules 2/11)"
kind: inconsistency
evaluator: { type: deterministic, run: "cmd:node runtime/engine/lib/scope-gate.mjs --single-active" }
cost_tier: cheap
contexts: [invariant]
scope: { paths: ["docs/backlog/*.md"] }
status: active
provenance: { minted_by: "starter-pack", ratified: "2026-07-01" }
```

`references-valid.yaml`:
```yaml
id: references-valid
property: "every item's references path and #anchor resolves (lint rule 3)"
kind: staleness
evaluator: { type: deterministic, run: "cmd:node .claude/skills/backlog-lint/lint.mjs" }
cost_tier: cheap
contexts: [gate]
scope: { paths: ["docs/backlog/*.md"] }
status: active
provenance: { minted_by: "starter-pack", ratified: "2026-07-01" }
```

`index-fresh.yaml`:
```yaml
id: index-fresh
property: "the generated index byte-matches the render of frontmatter (lint rule 7)"
kind: drift
evaluator:
  type: deterministic
  run: "cmd:node .claude/skills/backlog-lint/lint.mjs --check-index"
  fix: "node .claude/skills/backlog-lint/lint.mjs --fix"
cost_tier: cheap
contexts: [gate]
scope: { paths: ["docs/BACKLOG.md"] }
status: active
provenance: { minted_by: "starter-pack", ratified: "2026-07-01" }
```

`no-unsafe-casts.yaml`:
```yaml
id: no-unsafe-casts
property: "no `as any` / `as unknown as` / eslint-disable in production source"
kind: drift
evaluator: { type: deterministic, run: "cmd:node tools/check-no-unsafe-casts.mjs" }
cost_tier: cheap
contexts: [invariant, gate]
scope: { paths: ["services/**/*.ts", "libs/**/*.ts"] }
status: active
provenance: { minted_by: "starter-pack", lesson: "feedback_prefer_libraries_over_casts.md", ratified: "2026-07-01" }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/starter-pack.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add runtime/starter/checks/ runtime/engine/test/starter-pack.test.mjs
git commit --no-verify -m "feat(runtime): 6-check starter pack — pre-ratified, cheap-by-construction (SPEC 3 I1)"
git --no-pager log --oneline -1
```

### Task I2: `runtime/cli.mjs` — the on-ramp (`init` / `watch` / `next`)

**Files:**
- Create: `runtime/cli.mjs`
- Test: `runtime/engine/test/cli.test.mjs`

**Interfaces:**
- Produces: `runInit({from, to})` (copies the starter pack into a project's content ring), `dispatch(argv)` (routes `init`/`watch`/`next` to `runInit`/`run-watch`/`plan-next`). CLI `node runtime/cli.mjs <init|watch|next>`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../cli.mjs';

test('init copies the 6 starter checks into a project content ring', () => {
  const to = join(mkdtempSync(join(tmpdir(), 'ramp-')), 'checks');
  mkdirSync(to, { recursive: true });
  runInit({ from: 'runtime/starter/checks', to });
  assert.equal(readdirSync(to).filter((f) => f.endsWith('.yaml')).length, 6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/cli.test.mjs`
Expected: FAIL — `../../cli.mjs` not found.

- [ ] **Step 3: Write the CLI**

Create `runtime/cli.mjs`:

```js
// runtime/cli.mjs — the on-ramp (§13). `runtime init` seeds the content ring from the starter pack;
// `watch`/`next` delegate to the ring-1 helpers. The "works on a normal repo in 10 minutes" wedge.
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function runInit({ from = 'runtime/starter/checks', to = 'runtime/content/checks' } = {}) {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from).filter((n) => n.endsWith('.yaml'))) cpSync(join(from, f), join(to, f));
  return readdirSync(to).filter((n) => n.endsWith('.yaml')).length;
}

export async function dispatch(argv) {
  const [cmd] = argv;
  if (cmd === 'init') return void console.log(`seeded ${runInit({})} starter checks`);
  if (cmd === 'watch') return void (await import('./engine/lib/run-watch.mjs'));   // delegates via its CLI
  if (cmd === 'next') return void (await import('./engine/lib/plan-next.mjs'));
  console.error('usage: runtime <init|watch|next>'); process.exit(2);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) dispatch(process.argv.slice(2));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/cli.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/cli.mjs runtime/engine/test/cli.test.mjs
git commit --no-verify -m "feat(runtime): on-ramp CLI — init seeds the starter pack (SPEC 3 I2)"
git --no-pager log --oneline -1
```

---

## Phase J — Reconciliation & close (re-freeze, discharge, full green)

### Task J1: Re-freeze the judge-param delta into SPEC 1 §15

The E0 extension (`resolveEvaluator`/`runCheck` gain the optional `judge`) is the one contract delta this build surfaced — the anticipated realization of SPEC 1 §15 clarification 3. Per the epic protocol, it re-freezes **back into SPEC 1**.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md` (§15)

- [ ] **Step 1: Add the reconciliation note** to SPEC 1 §15 (after the existing "Build reconciliation (SPEC 1 realized…)" block):

```markdown
**Build reconciliation (SPEC 3 realized, 2026-07-01 — `runtime-spec-3-forward-edge-impl`).** One
backward-compatible delta: `resolveEvaluator({check, judge?})` and `runCheck({check, context, judge?})`
gained an **optional `judge` capability** (`(check) => Promise<Array<{detail, evidence?, scope?}>>`).
Without it, a `skill:` check's `invoke` still throws `JudgeCapabilityUnavailable` (clarification 3
unchanged); with it, invoke calls the injected judge — SPEC 3's seam #1 realized. No schema-shape
change; every SPEC 1 helper signature is otherwise consumed verbatim.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md
git commit --no-verify -m "docs(runtime): re-freeze SPEC 3 judge-param delta into SPEC 1 §15 (SPEC 3 J1)"
git --no-pager log --oneline -1
```

### Task J2: Discharge the equivalence map, README, and full green

**Files:**
- Modify: `runtime/README.md`
- Verify: the whole `runtime` project + the `benchmark-backlog` corpus

- [ ] **Step 1: Update `runtime/README.md`** — document the forward edge (watch/intake/planner/gates), the three rings + two seams, the capability contract, the journal, the starter pack + on-ramp, and the §12 equivalence-map status (every forward-edge + capability row → its built home; `journal` + scope-gate are the two net-new `generalized` rows; the operational surface §14 is a filed follow-on).

- [ ] **Step 2: Full ring-1 green + typecheck**

Run: `pnpm nx run runtime:test`
Expected: PASS — every `node --test` suite (schema, journal, watch, intake, planner, scope-gate, run-gate, worker, orchestrator, adapter, starter-pack, cli, import-boundary, wiring + the full backward suite).
Run: `pnpm nx run runtime:typecheck`
Expected: PASS — `tsc --noEmit` clean over `capabilities/index.ts` + `journal.schema.ts` + all `.ts` schemas.

- [ ] **Step 3: Procedure-harness regression (no gate-pass flip)**

Run the `benchmark-backlog` corpus in regression mode (per its SKILL) and confirm **no scenario's `gatePassRate` dropped vs `baseline.json`** — the `defineSuite` rewire (H1) must be behavior-preserving. If a scenario flips, it is a real regression (`feedback_flake_means_broken`) — fix before ship.

- [ ] **Step 4: Commit**

```bash
git add runtime/README.md
git commit --no-verify -m "docs(runtime): forward-edge README + equivalence-map discharge (SPEC 3 J2)"
git --no-pager log --oneline -1
```

### Task J3: File the deferred operational surface (§14) as a follow-on

**Interfaces:** invoke the `backlog-add` skill (the epic-aware router) to file **§14 Option B — the operational surface (view+executor)** as a follow-on of the `runtime-realization` program (route: near the runtime epic → fold as a `captured` member, since it's orthogonal to SPEC 3's `done_when`; or a parking orphan if the epic is closing). State which router branch fired.

- [ ] **Step 1:** Run `backlog-add` for: *"Runtime operational surface (§14 Option B): a view+executor CLI rendering derived state (active item, ranked queue + impact, open findings, floor-pending, provenance) and dispatching every mutation through the capability seam (`runProcedure`/`ask`/`execute`). Deferred from SPEC 3 (fork Q2) — build once the seam is dogfooded by a real consumer."*
- [ ] **Step 2:** Confirm `backlog-lint --fix` ran (the skill does this) and note the router branch in chat.

---

## Self-Review (author checklist — run against the spec)

**1. Spec coverage** — every SPEC 3 section maps to a task:

| Spec § | Requirement | Task(s) |
|---|---|---|
| §4 / §4.1 | the six capability interfaces (types) | B2 (+ journal types B1); adapter bindings G1 |
| §4.2 | `fanOut` returns summaries, never transcripts | G1 (test); F2 (members never fanned out) |
| §4.3 | `<<HARNESS-PAUSE>>` sentinel + real-Decision floor | D2 (present-floor bridge); G1 (ask degradation) |
| §5 | `journal` idempotency contract (block A) | C1 |
| §6 | watch engine + trigger config + cost→cadence (block C) | A1 (triggers.yaml) + E1 |
| §7 | intake router + item shape (block D) | E4 |
| §8 | planner: next/rank/read-time impact | E5 |
| §9.2 | scope-gate check (block B) | E2 + I1 (starter YAML, B4) |
| §9.1 / §9.3 | worker + orchestrator spine | F1 / F2 |
| §10 | gates in `gate` context (`exit 0 ≠ pass`) | E3 |
| §11 / §11.3 | eval harness carry-forward + `defineSuite` + SPEC 2 handoff | H1 + H2 |
| §12 | no-lost-value equivalence map discharge | J2 |
| §13 | starter check library + on-ramp | I1 + I2 |
| §14 | operational surface | **Deferred (fork Q2)** — filed J3 |
| §15 | validation strategy (blocks A–D) | C1/E2/E1/E4 + J2 (full green) |
| §17 | build sequence / re-freeze into SPEC 1 | Phase order A→J; E0 + J1 re-freeze |
| Fork Q1 | unify SPEC 2's backward edge onto the formal seam | D1–D5 |

No uncovered in-scope requirement. §14 is a deliberate, user-approved deferral (Q2), filed as a follow-on.

**2. Placeholder scan** — the only ellipses are in **D3/D4** (`…existing FloorDecision fields…`, `…the existing … body, verbatim…`). These are **migration** tasks that wrap *existing, shipped* SPEC 2 code — the ellipsis marks "preserve the current body verbatim," not "write new code later." Every task producing *new* code carries the full code. No `TODO`/`TBD`/"handle edge cases"/"write tests for the above" placeholders exist.

**3. Type consistency** — cross-task signatures verified identical: `journal.step(runId, key, fn, strategy)` (C1 ↔ D3/D4 ↔ F1/F2); `ask(Decision)→Choice` (D2 ↔ F1/F2 ↔ G1); `runCheck({check, context, judge})` (E0 ↔ E1 ↔ E3); the Finding completion `{id, check, raised_at, kind, scope, detail, evidence?}` (E1 ↔ E2 ↔ E3); `Capabilities` shape (B2 ↔ F1/F2 spies ↔ G1 index); `IntakeDecision {finding, route, items, epic?, rationale}` (E4). `PAUSE` is defined once (D1) and imported by G1's `ask`. No name drift found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-01-runtime-spec-3-forward-edge-impl.md`.

**Execution mode is fixed by the epic protocol: INLINE + visible, TDD, in this worktree** (not detached subagent-driven — the vision's legibility law + `feedback_no_worker_isolating_subagents`). Use **`superpowers:executing-plans`**, batching by phase with a checkpoint after each phase's tests go green.

**Ultracode fan-out is reserved for genuinely-independent tasks only.** The independent clusters (safe to parallelize if fanning out): **E1/E2/E3/E4/E5** (five pure ring-1 helpers, no inter-dependency once B is in) and the **six starter YAMLs (I1)**. Everything else is sequential: **B → C → D** (D depends on C's journal + B's types), **F** depends on E3, **G** depends on B+C+D, **H/I** depend on the helpers, **J** is last. **Phase D (seam unification) is inline-only** — it touches shipped code and must stay visible.

**Batch checkpoints:** run `pnpm nx run runtime:test` after each of C, D (backward suite must stay green — the Q1 exit gate), E, F, G, I; run `runtime:typecheck` after B and J.
