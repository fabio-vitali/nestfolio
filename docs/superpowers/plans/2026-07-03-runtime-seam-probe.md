# Runtime Seam Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-freeze the ring-1 capability contract so the SPEC 3 §4.3 pause/resume protocol is expressible, implement park/fulfil across journal + spines + adapter, add a session-driven loop CLI, and prove it by driving this workstream's own tail through `runWorker` with a real fix as the execute payload.

**Architecture:** Pure-data pause seam (`TaskResult` paused variant carries `decision`; parks are `awaiting` records under the parked step's key; fulfilling = completing the key; replay short-circuits). Gates become checks-not-effects (re-run every wake, `record()` evidence). Judge derives from the declared `runProcedure` capability — the six-interface contract stays frozen. The driver (ring-2) parks and the session performs/fulfils — park/fulfil IS the interactive binding.

**Tech Stack:** Node ≥24 (native TS type-stripping, zero build), `node:test`, zod v3 `.strict()` schemas in `.ts`, plain `.mjs` logic, yaml.

## Global Constraints

- Worktree: all paths relative to `/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/runtime-seam-probe` (the session cwd). Never write via the main-checkout absolute path.
- nx CANNOT run in this worktree. Test gate is always: `node --test runtime/engine/test/*.test.mjs runtime/engine/backward/test/*.test.mjs runtime/engine/loop/test/*.test.mjs runtime/adapters/claude-code/test/*.test.mjs runtime/adapters/git/test/*.test.mjs runtime/eval/test/*.test.mjs runtime/content/test/*.test.mjs` and typecheck is `npx tsc --noEmit -p runtime/tsconfig.json`. (Bare `node --test <dir>` does NOT discover on Node 24 — always the glob.)
- Commits: `git commit --no-verify` (worktree pre-commit is unreliable here) AND verify each landed via `git log --oneline -1`. Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- House module convention: `#!/usr/bin/env node` optional for libs, JSDoc header comment, pure named exports + thin `main()` guarded by `if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();`. NO default exports. Tests import pure cores.
- Ring boundary: `runtime/engine/**` must never import `runtime/adapters/**` (enforced by `engine/test/import-boundary.test.mjs`). The driver therefore lives in `adapters/claude-code/`.
- `.mjs` importing `.ts` uses the explicit `.ts` extension.
- Breaking type changes are free (no-deprecation policy); update existing tests rather than preserving old shapes.

---

### Task 1: Ring-1 type re-freeze (capabilities + RunMeta)

**Files:**
- Modify: `runtime/engine/capabilities/index.ts`
- Modify: `runtime/engine/schema/journal.schema.ts` (RunMetaSchema only)
- Test: `runtime/engine/test/journal-schema.test.mjs` (append), `runtime/engine/test/capabilities-contract.test.mjs` (append)

**Interfaces:**
- Consumes: existing `Finding` type, `Decision`/`Choice` types.
- Produces: `Task.choices?: Choice[]`, `Task.locus?: {branch?, worktree?}`, `TaskResult` discriminated union (paused requires `decision`), `Summary.status` incl `'paused'`, `Summary.findings?`, `Summary.decision?`, `RunMeta` with optional `branch`/`worktree`. Later tasks type against these exact names.

- [ ] **Step 1: Write the failing tests**

Append to `runtime/engine/test/journal-schema.test.mjs`:

```js
test('RF1 RunMeta accepts a locus-free run (no branch/worktree)', () => {
  const r = validateRunMeta({ runId: 'item-x', auto: false });
  assert.equal(r.ok, true);
});
test('RF2 RunMeta still rejects unknown keys', () => {
  assert.equal(validateRunMeta({ runId: 'item-x', auto: false, lane: 'complex' }).ok, false);
});
```

(Reuse the file's existing imports; `validateRunMeta` is already imported there — if not, add `import { validateRunMeta } from '../schema/journal.schema.ts';`.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test runtime/engine/test/journal-schema.test.mjs`
Expected: RF1 FAILS (branch/worktree currently required).

- [ ] **Step 3: Implement the type changes**

In `runtime/engine/schema/journal.schema.ts` replace the RunMetaSchema block:

```ts
export const RunMetaSchema = z.object({
  runId: z.string().min(1),
  branch: z.string().min(1).optional(),    // re-freeze 2026-07-03: "no worktree" is representable
  worktree: z.string().min(1).optional(),
  auto: z.boolean(),
}).strict();
```

In `runtime/engine/capabilities/index.ts` replace the `Task`, `TaskResult`, `Summary` declarations:

```ts
export interface Task {
  id: string;                 // stable idempotency-key seed (feeds journal, §5)
  prompt: string;             // the work instruction — prompt-shaped by the adapter
  scope: string[];            // paths the task may touch (feeds the scope-gate, §9)
  procedure?: string;         // optional named sub-procedure (runProcedure)
  payload?: unknown;
  choices?: Choice[];         // re-freeze 2026-07-03: fulfilled floor answers from prior wakes (pure-data resume)
  locus?: { branch?: string; worktree?: string };   // re-freeze: execution locus — spine stops hardcoding
}
export type TaskResult =      // re-freeze 2026-07-03: discriminated union — paused REQUIRES its Decision
  | { taskId: string; status: 'done' | 'failed'; summary: string; findings?: Finding[] }
  | { taskId: string; status: 'paused'; summary: string; decision: Decision };
export interface Summary {    // the ONLY thing fanOut returns (the Tier-2 scar)
  taskId: string;
  status: 'done' | 'failed' | 'paused';   // re-freeze: a paused sub-task BUBBLES, never answers in isolation
  summary: string;            // a transcript here is a SEAM VIOLATION
  findings?: Finding[];       // re-freeze: §4.2 bubbling rule's carrier (breadth work feeds intake)
  decision?: Decision;        // re-freeze: present iff paused
}
```

(`Decision`, `Choice`, `Finding` are already imported/declared in this file — no import changes.)

- [ ] **Step 4: Run tests + typecheck**

Run: `node --test runtime/engine/test/journal-schema.test.mjs && npx tsc --noEmit -p runtime/tsconfig.json`
Expected: journal-schema PASSES. tsc may surface downstream type errors in files not yet migrated — record them; they are fixed in Tasks 4–6. If tsc fails ONLY in `worker/orchestrator/adapter` consumers, proceed (they are queued); any error inside `capabilities/index.ts` or `journal.schema.ts` must be fixed now.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/capabilities/index.ts runtime/engine/schema/journal.schema.ts runtime/engine/test/journal-schema.test.mjs
git commit --no-verify -m "feat(runtime): re-freeze seam types — paused TaskResult union, Task.choices/locus, Summary bubbling, optional RunMeta locus" && git log --oneline -1
```

---

### Task 2: Journal park/fulfil semantics + askStep

**Files:**
- Modify: `runtime/engine/lib/journal.mjs`
- Modify: `runtime/engine/backward/lib/capabilities.mjs` (PAUSE becomes a re-export)
- Test: `runtime/engine/test/journal.test.mjs` (append a new `describe`-style block)

**Interfaces:**
- Consumes: Task 1 types.
- Produces (exact exports from `journal.mjs`): `PAUSE` (string const), `isPaused(v): boolean`, `pendingDecisions(ledger): StepRecord[]`, `fulfilledChoices(ledger): Choice[]`, `askStep({journal, runId, decision, ask, recordWhen?}): Promise<Choice|null>` (null ⇒ parked/deferred). `step()` gains park-not-complete. Task 4/5/7 call all of these.

- [ ] **Step 1: Write the failing tests** (append to `runtime/engine/test/journal.test.mjs`)

```js
import { inMemoryJournal, isPaused, pendingDecisions, fulfilledChoices, askStep, PAUSE } from '../lib/journal.mjs';

const DEC = { id: 'ship-x', question: 'Ship x?', options: [{ label: 'Ship', value: 'ship', recommended: true }, { label: 'Hold', value: 'hold' }] };
const PAUSED_RESULT = { taskId: 'x', status: 'paused', summary: 'parked', decision: { id: 'execute:x', question: 'Perform x', options: [{ label: 'Fulfil', value: 'fulfil', recommended: true }] } };

test('JP1 step parks a paused TaskResult: awaiting under the STEP key, no complete record', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  const v = await j.step('item-x', 'execute:x', async () => PAUSED_RESULT);
  assert.equal(v.status, 'paused');
  const rec = j.read('item-x').steps.get('execute:x');
  assert.equal(rec.status, 'awaiting');
  assert.equal(rec.decision.id, 'execute:x');
});
test('JP2 a parked step re-invokes fn on replay (not short-circuited)', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  let calls = 0;
  const fn = async () => { calls++; return PAUSED_RESULT; };
  await j.step('item-x', 'execute:x', fn); await j.step('item-x', 'execute:x', fn);
  assert.equal(calls, 2);
});
test('JP3 fulfil completes the parked key; replay short-circuits with the fulfilled value', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  await j.step('item-x', 'execute:x', async () => PAUSED_RESULT);
  j.fulfil('item-x', 'execute:x', { taskId: 'x', status: 'done', summary: 'performed by session' });
  let calls = 0;
  const v = await j.step('item-x', 'execute:x', async () => { calls++; return PAUSED_RESULT; });
  assert.equal(calls, 0); assert.equal(v.status, 'done');
});
test('JP4 pendingDecisions lists awaiting-only; fulfilment removes it', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  await j.step('item-x', 'execute:x', async () => PAUSED_RESULT);
  assert.equal(pendingDecisions(j.read('item-x')).length, 1);
  j.fulfil('item-x', 'execute:x', { taskId: 'x', status: 'done', summary: 'ok' });
  assert.equal(pendingDecisions(j.read('item-x')).length, 0);
});
test('JP5 fulfilledChoices returns Choice-shaped completions only', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  j.fulfil('item-x', 'ship-x', { decisionId: 'ship-x', value: 'ship' });
  j.record('item-x', 'gate.start', { passed: true, findings: [] });
  const cs = fulfilledChoices(j.read('item-x'));
  assert.equal(cs.length, 1); assert.equal(cs[0].value, 'ship');
});
test('JP6 askStep: PAUSE parks and returns null; fulfil then replay returns the Choice without re-asking', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  let asks = 0;
  const pausingAsk = async (d) => { asks++; return { decisionId: d.id, value: PAUSE }; };
  assert.equal(await askStep({ journal: j, runId: 'item-x', decision: DEC, ask: pausingAsk }), null);
  assert.equal(j.read('item-x').steps.get('ship-x').status, 'awaiting');
  j.fulfil('item-x', 'ship-x', { decisionId: 'ship-x', value: 'ship' });
  const c = await askStep({ journal: j, runId: 'item-x', decision: DEC, ask: pausingAsk });
  assert.equal(c.value, 'ship'); assert.equal(asks, 1);
});
test('JP7 askStep recordWhen: a non-terminal answer (hold) is NOT recorded complete — re-asked next wake', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  let asks = 0;
  const holdAsk = async (d) => { asks++; return { decisionId: d.id, value: 'hold' }; };
  const rw = (c) => c.value === 'ship';
  const c1 = await askStep({ journal: j, runId: 'item-x', decision: DEC, ask: holdAsk, recordWhen: rw });
  assert.equal(c1.value, 'hold');
  assert.equal(j.read('item-x').steps.get('ship-x').status, 'awaiting');
  const c2 = await askStep({ journal: j, runId: 'item-x', decision: DEC, ask: holdAsk, recordWhen: rw });
  assert.equal(c2.value, 'hold'); assert.equal(asks, 2);
});
test('JP8 isPaused guards shape', () => {
  assert.equal(isPaused(PAUSED_RESULT), true);
  assert.equal(isPaused({ status: 'paused' }), false);
  assert.equal(isPaused({ status: 'done', summary: 'x' }), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test runtime/engine/test/journal.test.mjs`
Expected: FAIL — `isPaused`/`pendingDecisions`/`fulfilledChoices`/`askStep`/`PAUSE` not exported; JP1/JP2 fail on old step semantics.

- [ ] **Step 3: Implement in `runtime/engine/lib/journal.mjs`**

Add near the top (after imports):

```js
export const PAUSE = '<<HARNESS-PAUSE>>';

/** Re-freeze 2026-07-03: a paused TaskResult (status 'paused' + a Decision) — step() parks it. */
export function isPaused(v) { return v?.status === 'paused' && typeof v?.decision?.id === 'string'; }
```

In `makeBacking`, replace the `step` method:

```js
async step(runId, key, fn, strategy = 'keyed-effect') {
  if (strategy === 'pure-rederive') return await fn();       // never ledgered — replay is free
  const existing = readSteps(runId).get(key);
  if (existing?.status === 'complete') return existing.value; // REPLAY — fn NOT invoked (incl. a fulfilled park)
  const value = await fn();                                   // execute (an awaiting record does NOT short-circuit)
  if (isPaused(value)) {                                      // PARK-not-complete: replay re-invokes until fulfilled
    appendStep(runId, { key, status: 'awaiting', decision: value.decision, ts: isoNow() });
    return value;
  }
  appendStep(runId, { key, status: 'complete', value, ts: isoNow() });
  return value;
},
```

Add at the bottom (before `e2eIsFresh`):

```js
/** Awaiting records with no later completion (parseSteps is last-write-wins per key). */
export function pendingDecisions(ledger) {
  return ledger ? [...ledger.steps.values()].filter((r) => r.status === 'awaiting') : [];
}

/** Choice-shaped step completions — the spine threads these into Task.choices (pure-data resume). */
export function fulfilledChoices(ledger) {
  return ledger ? [...ledger.steps.values()]
    .filter((r) => r.status === 'complete' && typeof r.value?.decisionId === 'string' && 'value' in (r.value ?? {}))
    .map((r) => r.value) : [];
}

/** The journaled floor ask (§4.3): replay a fulfilled Choice; park a PAUSE; record only terminal answers.
 *  recordWhen(choice) false ⇒ the answer is a deferral (e.g. 'hold') — parked as awaiting, re-asked next wake. */
export async function askStep({ journal, runId, decision, ask, recordWhen = () => true }) {
  const existing = journal.read(runId)?.steps.get(decision.id);
  if (existing?.status === 'complete') return existing.value;   // fulfilled — never re-ask
  const choice = await ask(decision);
  if (choice.value === PAUSE) { journal.awaiting(runId, decision.id, decision); return null; }
  if (recordWhen(choice)) journal.fulfil(runId, decision.id, choice);
  else journal.awaiting(runId, decision.id, decision);
  return choice;
}
```

In `runtime/engine/backward/lib/capabilities.mjs`, replace the local constant with a re-export (keeps the adapter's existing import path working):

```js
export { inMemoryJournal, PAUSE } from '../../lib/journal.mjs';   // the formal Journal + sentinel, one home
```

(Delete the local `export const PAUSE = '<<HARNESS-PAUSE>>';` line; `headlessAsk` body references `PAUSE` — add `import { PAUSE } from '../../lib/journal.mjs';` at the top so it still resolves.)

- [ ] **Step 4: Run tests**

Run: `node --test runtime/engine/test/journal.test.mjs runtime/engine/backward/test/*.test.mjs`
Expected: ALL PASS (backward suite proves the PAUSE move broke nothing).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/journal.mjs runtime/engine/backward/lib/capabilities.mjs runtime/engine/test/journal.test.mjs
git commit --no-verify -m "feat(runtime): journal park/fulfil — park-not-complete step, askStep, pendingDecisions/fulfilledChoices, PAUSE homed in ring-1 lib" && git log --oneline -1
```

---

### Task 3: deriveJudge — judgment via the declared runProcedure

**Files:**
- Create: `runtime/engine/lib/derive-judge.mjs`
- Test: `runtime/engine/test/derive-judge.test.mjs`

**Interfaces:**
- Consumes: `parseRun` from `../schema/check.schema.ts`; `runProcedure(name, args): Promise<TaskResult>`.
- Produces: `deriveJudge(runProcedure): (check) => Promise<Finding[]>` — the exact fn shape `resolveEvaluator({judge})` already expects. Tasks 4–5 call `deriveJudge(capabilities.runProcedure)`.

- [ ] **Step 1: Write the failing test** (`runtime/engine/test/derive-judge.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveJudge } from '../lib/derive-judge.mjs';

const CHECK = { id: 'itc', kind: 'gap', evaluator: { type: 'judgment', run: 'skill:audit-integration-test' } };

test('DJ1 maps a done TaskResult.findings through runProcedure(target,{check})', async () => {
  const calls = [];
  const rp = async (name, args) => { calls.push([name, args]); return { taskId: name, status: 'done', summary: 'ok', findings: [{ id: 'f1', check: 'itc', kind: 'gap', scope: [], detail: 'missing', raised_at: 'now' }] }; };
  const judge = deriveJudge(rp);
  const findings = await judge(CHECK);
  assert.equal(findings.length, 1);
  assert.deepEqual(calls[0][0], 'audit-integration-test');
  assert.equal(calls[0][1].check.id, 'itc');
});
test('DJ2 a done result with no findings key means zero findings', async () => {
  const judge = deriveJudge(async () => ({ taskId: 'x', status: 'done', summary: 'clean' }));
  assert.deepEqual(await judge(CHECK), []);
});
test('DJ3 a failed procedure throws (fails closed at the runGate layer)', async () => {
  const judge = deriveJudge(async () => ({ taskId: 'x', status: 'failed', summary: 'no such skill' }));
  await assert.rejects(() => judge(CHECK), /no such skill/);
});
test('DJ4 no runProcedure ⇒ judge is undefined (resolveEvaluator throws its usual JudgeCapabilityUnavailable)', () => {
  assert.equal(deriveJudge(undefined), undefined);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test runtime/engine/test/derive-judge.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`runtime/engine/lib/derive-judge.mjs`)

```js
// runtime/engine/lib/derive-judge.mjs — the judgment seam derived from the DECLARED runProcedure
// capability (re-freeze 2026-07-03): no seventh capability. A `skill:<name>` evaluator runs as
// runProcedure(name, { check }) and the findings return in TaskResult.findings.
import { fileURLToPath } from 'node:url';
import { parseRun } from '../schema/check.schema.ts';

/** @returns a judge fn for resolveEvaluator, or undefined when the host declares no runProcedure. */
export function deriveJudge(runProcedure) {
  if (!runProcedure) return undefined;
  return async function judge(check) {
    const parsed = parseRun(check.evaluator.run);
    const res = await runProcedure(parsed.target, { check });
    if (res.status !== 'done') throw new Error(`judge procedure ${parsed.target}: ${res.summary}`);
    return res.findings ?? [];
  };
}

function main() { console.error('derive-judge.mjs is a library; import deriveJudge'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run tests** — `node --test runtime/engine/test/derive-judge.test.mjs` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/derive-judge.mjs runtime/engine/test/derive-judge.test.mjs
git commit --no-verify -m "feat(runtime): deriveJudge — judgment checks reach the LLM via the declared runProcedure capability" && git log --oneline -1
```

---

### Task 4: Worker rewrite — gates as checks, pausable execute, honest ship ask

**Files:**
- Modify: `runtime/engine/loop/worker.mjs` (full rewrite below)
- Test: `runtime/engine/loop/test/worker.test.mjs` (rewrite the affected cases; keep the file's existing harness/fixture style — it builds fake capabilities + a registry; reuse its helpers)

**Interfaces:**
- Consumes: `runGate` (unchanged), `askStep`/`fulfilledChoices`/`isPaused` (Task 2), `deriveJudge` (Task 3), Task 1 types.
- Produces: `runWorker({ item, capabilities, registry, locus?, auto? }): Promise<TaskResult>` — the driver (Task 7) and orchestrator tests rely on: paused results carry `decision`; run id is `item-<id>`; execute step key is `execute:<item.id>`; ship decision id is `ship-<item.id>`; gate evidence at record keys `gate.start` / `gate.ship`.

- [ ] **Step 1: Write/adjust the failing tests** (in `runtime/engine/loop/test/worker.test.mjs`, keeping its existing fake-capability helpers; add these cases)

```js
// W-A failed gate re-runs after the tree is fixed (the replay-forever regression)
test('W-A a failed start gate is NOT journaled as an effect — a re-run re-verifies', async () => {
  let gateFindings = [{ id: 'g#0', check: 'g', kind: 'drift', scope: [], detail: 'bad', raised_at: 'now' }];
  const registry = fakeRegistryWithGate(() => gateFindings);   // adapt to the file's existing registry fixture
  const caps = fakeCaps({ journal: inMemoryJournal() });
  const r1 = await runWorker({ item: ITEM, capabilities: caps, registry });
  assert.equal(r1.status, 'failed');
  gateFindings = [];                                            // the tree is fixed
  const r2 = await runWorker({ item: ITEM, capabilities: caps, registry });
  assert.notEqual(r2.status, 'failed');                         // gate re-ran and passed
});
// W-B paused execute parks; fulfil resumes with the recorded TaskResult
test('W-B paused execute parks under execute:<id>; fulfil + re-run reaches the ship gate', async () => {
  const j = inMemoryJournal();
  const caps = fakeCaps({ journal: j, execute: async (t) => ({ taskId: t.id, status: 'paused', summary: 'parked', decision: { id: `execute:${t.id}`, question: 'do it', options: [{ label: 'Fulfil', value: 'fulfil', recommended: true }] } }) });
  const r1 = await runWorker({ item: ITEM, capabilities: caps, registry: emptyRegistry() });
  assert.equal(r1.status, 'paused'); assert.equal(r1.decision.id, `execute:${ITEM.id}`);
  j.fulfil(`item-${ITEM.id}`, `execute:${ITEM.id}`, { taskId: ITEM.id, status: 'done', summary: 'session did it' });
  const r2 = await runWorker({ item: ITEM, capabilities: caps, registry: emptyRegistry() });
  assert.notEqual(r2.status, 'paused');                         // execute replayed complete; flow advanced
});
// W-C ship honesty: sentinel parks, hold defers, ship completes
test('W-C ship=paused on sentinel; hold re-asks next run; ship → done', async () => {
  const j = inMemoryJournal();
  const answers = ['hold', 'ship']; let i = 0;
  const caps = fakeCaps({ journal: j, ask: async (d) => ({ decisionId: d.id, value: answers[i++] }) });
  const r1 = await runWorker({ item: ITEM, capabilities: caps, registry: emptyRegistry() });
  assert.equal(r1.status, 'paused');                            // hold = defer
  const r2 = await runWorker({ item: ITEM, capabilities: caps, registry: emptyRegistry() });
  assert.equal(r2.status, 'done');                              // re-asked, shipped
});
// W-D choices thread into the Task; locus feeds RunMeta
test('W-D fulfilled choices reach Task.choices; locus lands in RunMeta', async () => {
  const j = inMemoryJournal(); const seen = [];
  j.begin('item-i1', { runId: 'item-i1', auto: false });
  j.fulfil('item-i1', 'mid-task-q', { decisionId: 'mid-task-q', value: 'optionA' });
  const caps = fakeCaps({ journal: j, execute: async (t) => { seen.push(t); return { taskId: t.id, status: 'done', summary: 'ok' }; } });
  await runWorker({ item: ITEM, capabilities: caps, registry: emptyRegistry(), locus: { branch: 'feat/x' } });
  assert.equal(seen[0].choices.find((c) => c.decisionId === 'mid-task-q').value, 'optionA');
  assert.equal(seen[0].locus.branch, 'feat/x');
  assert.equal(j.read('item-i1').meta.branch, 'feat/x');
});
```

(`ITEM` = the file's existing item fixture, id `i1`; `fakeCaps` must now also accept/forward `runProcedure` — extend the existing helper minimally. Default fake ask answers `{ decisionId: d.id, value: d.options.find(o => o.recommended)?.value ?? d.options[0].value }` so untouched cases still ship.)

- [ ] **Step 2: Run to verify failure** — `node --test runtime/engine/loop/test/worker.test.mjs` — Expected: FAIL (old worker journals gates, ignores choice, no decision on paused).

- [ ] **Step 3: Rewrite `runtime/engine/loop/worker.mjs`**

```js
// runtime/engine/loop/worker.mjs — the single-item spine (§9.1). Calls ONLY capabilities + ring-1.
// Re-freeze 2026-07-03: gates are CHECKS (re-run every wake; record() evidence), execute is a pausable
// step (park-not-complete), the ship ask is a journaled floor step and its answer is honored.
// The merge/ship is ALWAYS a floor ask (never auto) — no option runs an irreversible act.
import { runGate } from '../lib/run-gate.mjs';
import { askStep, fulfilledChoices } from '../lib/journal.mjs';
import { deriveJudge } from '../lib/derive-judge.mjs';

const toGlobs = (scope) => (scope ?? '').split(/[\s,]+/).filter(Boolean);

export async function runWorker({ item, capabilities, registry, locus = {}, auto = false }) {
  const { journal, execute, ask, runProcedure } = capabilities;
  const runId = `item-${item.id}`;
  journal.begin(runId, { runId, auto,
    ...(locus.branch ? { branch: locus.branch } : {}), ...(locus.worktree ? { worktree: locus.worktree } : {}) });
  const judge = deriveJudge(runProcedure);

  const startGate = await runGate({ registry, boundary: 'start', item, judge });   // a gate is a CHECK — never step()ed
  journal.record(runId, 'gate.start', { passed: startGate.passed, findings: startGate.findings });
  if (!startGate.passed) return { taskId: item.id, status: 'failed', summary: `start gate: ${startGate.findings.length} findings`, findings: startGate.findings };

  const task = { id: item.id, prompt: `Implement item ${item.id}`, scope: toGlobs(item.scope),
    payload: { item }, choices: fulfilledChoices(journal.read(runId)), locus };
  const work = await journal.step(runId, `execute:${item.id}`, async () => execute(task));
  if (work.status === 'paused') return { taskId: item.id, status: 'paused', summary: work.summary, decision: work.decision };
  if (work.status === 'failed') return { taskId: item.id, status: 'failed', summary: work.summary, findings: work.findings };

  const shipGate = await runGate({ registry, boundary: 'ship', item, judge });
  journal.record(runId, 'gate.ship', { passed: shipGate.passed, findings: shipGate.findings });
  if (!shipGate.passed) return { taskId: item.id, status: 'failed', summary: `ship gate: ${shipGate.findings.length} findings`, findings: shipGate.findings };

  const decision = { id: `ship-${item.id}`, question: `Ship item ${item.id}?`,
    options: [{ label: 'Ship', value: 'ship', recommended: true }, { label: 'Hold', value: 'hold' }],
    context: item.done_when ?? item.done_criteria };
  const choice = await askStep({ journal, runId, decision, ask, recordWhen: (c) => c.value === 'ship' });
  if (!choice) return { taskId: item.id, status: 'paused', summary: `awaiting floor: ${decision.id}`, decision };
  if (choice.value !== 'ship') return { taskId: item.id, status: 'paused', summary: `held: ${item.id} (re-asked next wake)`, decision };
  return { taskId: item.id, status: 'done', summary: `worked ${item.id}; ship approved` };
}
```

- [ ] **Step 4: Run tests** — `node --test runtime/engine/loop/test/worker.test.mjs` — Expected: PASS (update any pre-existing cases still asserting the old `worked <id>; ship=<v>` summary or gate step-records — the ledger no longer contains `gate.start` as a *step*, it is a `record`).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/loop/worker.mjs runtime/engine/loop/test/worker.test.mjs
git commit --no-verify -m "feat(runtime): worker re-freeze — gates re-run every wake, pausable execute park, honest ship ask" && git log --oneline -1
```

---

### Task 5: Orchestrator rewrite — pausable members, honest merge, no pseudo-capabilities

**Files:**
- Modify: `runtime/engine/loop/orchestrator.mjs` (full rewrite below)
- Test: `runtime/engine/loop/test/orchestrator.test.mjs` (add the wedge regression + merge honesty; adapt existing cases)

**Interfaces:**
- Consumes: Task 2/3 exports; `runWatch`, `e2eIsFresh`, `gitHeadSha` (import), Task 1 types.
- Produces: `runOrchestrator({ epic, members, capabilities, registry, locus?, auto?, headSha? })` — member step key `member.<id>`; merge decision id `merge-<epic.id>`; paused results carry `decision`.

- [ ] **Step 1: Write the failing tests** (add to `runtime/engine/loop/test/orchestrator.test.mjs`)

```js
// O-A THE WEDGE REGRESSION (red-team scenario A): paused member parks; fulfil resumes the epic
test('O-A paused member parks under member.<id>; fulfil + re-run completes the epic', async () => {
  const j = inMemoryJournal();
  let m2Paused = true;
  const caps = fakeCaps({ journal: j, execute: async (t) => (t.id === 'm2' && m2Paused)
    ? { taskId: t.id, status: 'paused', summary: 'floor act', decision: { id: `execute:${t.id}`, question: 'q', options: [{ label: 'F', value: 'f', recommended: true }] } }
    : { taskId: t.id, status: 'done', summary: 'ok' } });
  const r1 = await runOrchestrator({ epic: EPIC, members: MEMBERS, capabilities: caps, registry: emptyRegistry(), headSha: 'sha1' });
  assert.equal(r1.status, 'paused'); assert.equal(r1.decision.id, 'execute:m2');
  assert.equal(j.read(`epic-${EPIC.id}`).steps.get('member.m2').status, 'awaiting');
  j.fulfil(`epic-${EPIC.id}`, 'member.m2', { taskId: 'm2', status: 'done', summary: 'answered + done' });
  m2Paused = false;
  const r2 = await runOrchestrator({ epic: EPIC, members: MEMBERS, capabilities: caps, registry: emptyRegistry(), headSha: 'sha1' });
  assert.equal(r2.status, 'done');
});
// O-B no 'done' on an unanswered merge
test('O-B merge PAUSE sentinel ⇒ epic result is paused, not done', async () => {
  const caps = fakeCaps({ journal: inMemoryJournal(), ask: async (d) => ({ decisionId: d.id, value: PAUSE }) });
  const r = await runOrchestrator({ epic: EPIC, members: MEMBERS, capabilities: caps, registry: emptyRegistry(), headSha: 'sha1' });
  assert.equal(r.status, 'paused'); assert.equal(r.decision.id, `merge-${EPIC.id}`);
});
// O-C gitHeadSha is NOT read from capabilities
test('O-C headSha comes from the param (capabilities carries no gitHeadSha)', async () => {
  const caps = fakeCaps({ journal: inMemoryJournal() });
  assert.equal('gitHeadSha' in caps, false);
  const r = await runOrchestrator({ epic: EPIC, members: MEMBERS, capabilities: caps, registry: emptyRegistry(), headSha: 'sha-abc' });
  assert.equal(r.status, 'done');
});
```

(`EPIC`/`MEMBERS`/`fakeCaps`/`emptyRegistry` = the file's existing fixtures; import `PAUSE` from `../../lib/journal.mjs`. Default fake ask answers the recommended option, as in Task 4.)

- [ ] **Step 2: Run to verify failure** — `node --test runtime/engine/loop/test/orchestrator.test.mjs` — Expected: FAIL (O-A wedges: replay returns the stale paused member; O-B returns done).

- [ ] **Step 3: Rewrite `runtime/engine/loop/orchestrator.mjs`**

```js
// runtime/engine/loop/orchestrator.mjs — the epic spine (§9.3). Re-freeze 2026-07-03: member steps are
// pausable parks (a paused member no longer wedges the run — fulfil + replay resumes it); the merge ask
// is a journaled floor step whose answer is honored; gitHeadSha is an options param (git is universal
// infrastructure, not a capability). Epic-pre-done stays SHA-CONDITIONAL via e2eIsFresh (F-14).
import { runWatch } from '../lib/run-watch.mjs';
import { e2eIsFresh, gitHeadSha, askStep, fulfilledChoices } from '../lib/journal.mjs';
import { deriveJudge } from '../lib/derive-judge.mjs';

const toGlobs = (scope) => (scope ?? '').split(/[\s,]+/).filter(Boolean);

export async function runOrchestrator({ epic, members, capabilities, registry, locus = {}, auto = false, headSha }) {
  const { journal, execute, ask, runProcedure } = capabilities;
  const runId = `epic-${epic.id}`;
  journal.begin(runId, { runId, auto,
    ...(locus.branch ? { branch: locus.branch } : {}), ...(locus.worktree ? { worktree: locus.worktree } : {}) });
  const judge = deriveJudge(runProcedure);

  const core = members.filter((m) => (m.epic_role ?? 'core') === 'core');
  for (const m of core) {
    const task = { id: m.id, prompt: `Work member ${m.id}`, scope: toGlobs(m.scope),
      payload: { member: m }, choices: fulfilledChoices(journal.read(runId)), locus };
    const res = await journal.step(runId, `member.${m.id}`, async () => execute(task));
    if (res.status === 'paused') return { taskId: epic.id, status: 'paused', summary: `member ${m.id}: ${res.summary}`, decision: res.decision };
    if (res.status !== 'done') return { taskId: epic.id, status: res.status, summary: `member ${m.id}: ${res.summary}`, findings: res.findings };
  }

  // epic-pre-done batch — SHA-CONDITIONAL, not step-replay (a moved HEAD re-runs; a resume never replays stale).
  const sha = headSha ?? gitHeadSha();
  const ledger = journal.read(runId);
  let findings;
  if (e2eIsFresh(ledger, sha)) {
    findings = ledger.steps.get('e2e').value.findings;
  } else {
    findings = await runWatch({ registry, trigger: { on: 'epic-pre-done', contexts: ['audit', 'gate'], cost_ceiling: 'expensive' }, changedScope: ['**/*'], judge });
    journal.record(runId, 'e2e', { sha, green: findings.length === 0, findings });
  }
  if (findings.length) return { taskId: epic.id, status: 'failed', summary: `epic-pre-done raised ${findings.length} findings`, findings };

  const decision = { id: `merge-${epic.id}`, question: `Merge epic ${epic.id} (single PR)?`,
    options: [{ label: 'Merge', value: 'merge', recommended: true }, { label: 'Hold', value: 'hold' }] };
  const choice = await askStep({ journal, runId, decision, ask, recordWhen: (c) => c.value === 'merge' });
  if (!choice) return { taskId: epic.id, status: 'paused', summary: `awaiting floor: ${decision.id}`, decision };
  if (choice.value !== 'merge') return { taskId: epic.id, status: 'paused', summary: `held: epic ${epic.id} (re-asked next wake)`, decision };
  return { taskId: epic.id, status: 'done', summary: `epic ${epic.id}: ${core.length} core members driven inline; merge approved` };
}
```

- [ ] **Step 4: Run tests** — `node --test runtime/engine/loop/test/orchestrator.test.mjs` — Expected: PASS (adapt pre-existing cases asserting `merge=<v>` summaries or `capabilities.gitHeadSha`).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/loop/orchestrator.mjs runtime/engine/loop/test/orchestrator.test.mjs
git commit --no-verify -m "feat(runtime): orchestrator re-freeze — pausable member parks (wedge fixed), honest merge ask, headSha param" && git log --oneline -1
```

---

### Task 6: Adapter — park-on-execute, Summary bubbling

**Files:**
- Modify: `runtime/adapters/claude-code/execute.mjs`, `runtime/adapters/claude-code/fan-out.mjs`
- Test: `runtime/adapters/claude-code/test/adapter.test.mjs` (adjust + add)

**Interfaces:**
- Consumes: Task 1 types (shape only — the adapter is `.mjs`).
- Produces: no-runner `execute` parks with `decision.id === 'execute:<task.id>'` (the worker's step key, by construction); `fanOut` summaries carry `findings`/`paused`/`decision` through.

- [ ] **Step 1: Write the failing tests** (add to `runtime/adapters/claude-code/test/adapter.test.mjs`)

```js
test('AD-A no-runner execute PARKS (paused + Task-shaped decision keyed execute:<id>) — never lies done', async () => {
  const execute = makeExecute({});
  const r = await execute({ id: 't1', prompt: 'do t1', scope: [] });
  assert.equal(r.status, 'paused');
  assert.equal(r.decision.id, 'execute:t1');
  assert.equal(r.decision.options.filter((o) => o.recommended).length, 1);
});
test('AD-B fanOut bubbles findings and paused decisions in the Summary (still transcript-free)', async () => {
  const fanOut = makeFanOut({ runTask: async (t) => t.id === 'a'
    ? { taskId: 'a', status: 'done', summary: 'ok', findings: [{ id: 'f', check: 'c', kind: 'drift', scope: [], detail: 'd', raised_at: 'now' }], transcript: 'SHOULD BE STRIPPED' }
    : { taskId: 'b', status: 'paused', summary: 'hit a decision', decision: { id: 'q1', question: 'q', options: [{ label: 'x', value: 'x', recommended: true }] } } });
  const [a, b] = await fanOut([{ id: 'a' }, { id: 'b' }]);
  assert.equal(a.findings.length, 1); assert.equal('transcript' in a, false);
  assert.equal(b.status, 'paused'); assert.equal(b.decision.id, 'q1');
});
```

- [ ] **Step 2: Run to verify failure** — `node --test runtime/adapters/claude-code/test/adapter.test.mjs` — Expected: FAIL (AD-A gets `done`; AD-B loses findings).

- [ ] **Step 3: Implement**

`runtime/adapters/claude-code/execute.mjs`:

```js
// runtime/adapters/claude-code/execute.mjs — binds execute to the inline, visible worker.
// Re-freeze 2026-07-03: with NO runner this adapter PARKS the task (paused + a Task-shaped decision
// keyed `execute:<task.id>` — the spine's step key by construction) instead of claiming done. The
// session performs the work and fulfils the park; replay then short-circuits with the real TaskResult.
export function makeExecute({ runner } = {}) {
  return async function execute(task) {
    if (runner) return await runner(task);
    return { taskId: task.id, status: 'paused', summary: `parked: ${task.id} awaits a session executor`,
      decision: { id: `execute:${task.id}`, question: `Perform task ${task.id}: ${task.prompt}`,
        options: [{ label: 'Fulfil with TaskResult', value: 'fulfil', recommended: true }],
        context: JSON.stringify({ scope: task.scope }) } };
  };
}
```

`runtime/adapters/claude-code/fan-out.mjs` — replace the mapping line:

```js
    return results.map((r) => ({ taskId: r.taskId, status: r.status, summary: r.summary,
      ...(r.findings ? { findings: r.findings } : {}),
      ...(r.status === 'paused' && r.decision ? { decision: r.decision } : {}) }));   // bounded fields only — never a transcript
```

- [ ] **Step 4: Run tests** — `node --test runtime/adapters/claude-code/test/adapter.test.mjs` — Expected: PASS (update any pre-existing stub-behavior cases asserting the old always-done execute).

- [ ] **Step 5: Commit**

```bash
git add runtime/adapters/claude-code/execute.mjs runtime/adapters/claude-code/fan-out.mjs runtime/adapters/claude-code/test/adapter.test.mjs
git commit --no-verify -m "feat(runtime): adapter re-freeze — park-on-execute, Summary findings/paused bubbling" && git log --oneline -1
```

---

### Task 7: The session driver — `run-item.mjs` (ring-2)

**Files:**
- Create: `runtime/adapters/claude-code/run-item.mjs`
- Test: `runtime/adapters/claude-code/test/run-item.test.mjs`

**Interfaces:**
- Consumes: `runWorker` (Task 4), `makeClaudeCodeCapabilities`, `readItems` from `../../engine/lib/scope-gate.mjs`, `loadRegistry`, `pendingDecisions`/`makeJournal` from `../../engine/lib/journal.mjs`.
- Produces: pure core `driveItem({ itemId, backlogDir, checksDir, fulfil, capabilities }): Promise<{ exit, out }>` + CLI `node runtime/adapters/claude-code/run-item.mjs <item-id> [--fulfil <key> --value '<json>']`. Exit: 0 done / 3 paused / 1 failed / 2 usage.

- [ ] **Step 1: Write the failing tests** (`runtime/adapters/claude-code/test/run-item.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { driveItem } from '../run-item.mjs';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { makeAsk } from '../ask.mjs';
import { makeExecute } from '../execute.mjs';
import { makeFanOut } from '../fan-out.mjs';
import { makeOnTrigger } from '../on-trigger.mjs';
import { makeRunProcedure } from '../run-procedure.mjs';

function tmpBacklog() {
  const root = mkdtempSync(join(tmpdir(), 'nf-drive-'));
  const dir = join(root, 'backlog'); mkdirSync(dir);
  writeFileSync(join(dir, 'probe-x.md'), '---\nid: probe-x\nstatus: active\ntype: feature\nscope: "tools/check-x.mjs"\n---\n# x\n', 'utf8');
  const checks = join(root, 'checks'); mkdirSync(checks);   // empty registry — gates trivially pass
  return { root, dir, checks };
}
function caps(j) {
  return { journal: j, ask: makeAsk({}), execute: makeExecute({}), fanOut: makeFanOut({}), onTrigger: makeOnTrigger({}), runProcedure: makeRunProcedure({}) };
}

test('DRV1 fresh drive parks execute → exit 3 + pending decision listed', async () => {
  const { root, dir, checks } = tmpBacklog();
  try {
    const j = inMemoryJournal();
    const { exit, out } = await driveItem({ itemId: 'probe-x', backlogDir: dir, checksDir: checks, capabilities: caps(j) });
    assert.equal(exit, 3);
    assert.equal(out.pending[0].key, 'execute:probe-x');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('DRV2 --fulfil advances: execute fulfilment reaches the ship ask (parks again) then ship fulfilment completes', async () => {
  const { root, dir, checks } = tmpBacklog();
  try {
    const j = inMemoryJournal();
    await driveItem({ itemId: 'probe-x', backlogDir: dir, checksDir: checks, capabilities: caps(j) });
    const r2 = await driveItem({ itemId: 'probe-x', backlogDir: dir, checksDir: checks, capabilities: caps(j),
      fulfil: { key: 'execute:probe-x', value: { taskId: 'probe-x', status: 'done', summary: 'session did it' } } });
    assert.equal(r2.exit, 3);
    assert.equal(r2.out.pending[0].key, 'ship-probe-x');
    const r3 = await driveItem({ itemId: 'probe-x', backlogDir: dir, checksDir: checks, capabilities: caps(j),
      fulfil: { key: 'ship-probe-x', value: { decisionId: 'ship-probe-x', value: 'ship' } } });
    assert.equal(r3.exit, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('DRV3 unknown item → exit 2', async () => {
  const { root, dir, checks } = tmpBacklog();
  try {
    const { exit } = await driveItem({ itemId: 'nope', backlogDir: dir, checksDir: checks, capabilities: caps(inMemoryJournal()) });
    assert.equal(exit, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run to verify failure** — `node --test runtime/adapters/claude-code/test/run-item.test.mjs` — Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`runtime/adapters/claude-code/run-item.mjs`)

```js
#!/usr/bin/env node
// runtime/adapters/claude-code/run-item.mjs — the session-driven loop driver (ring-2: assembles the
// adapter, so it may NOT live in engine/). Park/fulfil IS the interactive binding: this process runs
// until the first unfulfilled park, prints it, and exits; the session performs the work / surfaces the
// real AskUserQuestion, re-invokes with --fulfil, and replay advances. Exit: 0 done / 3 paused / 1 failed / 2 usage.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { runWorker } from '../../engine/loop/worker.mjs';
import { loadRegistry } from '../../engine/lib/load-registry.mjs';
import { readItems } from '../../engine/lib/scope-gate.mjs';
import { pendingDecisions } from '../../engine/lib/journal.mjs';
import { makeClaudeCodeCapabilities } from './index.mjs';

export async function driveItem({ itemId, backlogDir, checksDir, fulfil, capabilities }) {
  const item = readItems(backlogDir).find((i) => i.id === itemId);
  if (!item) return { exit: 2, out: { error: `unknown item: ${itemId}` } };
  const runId = `item-${itemId}`;
  if (fulfil) capabilities.journal.fulfil(runId, fulfil.key, fulfil.value);
  const registry = loadRegistry({ checksDir });
  const result = await runWorker({ item, capabilities, registry });
  const pending = pendingDecisions(capabilities.journal.read(runId));
  const exit = result.status === 'done' ? 0 : result.status === 'paused' ? 3 : 1;
  return { exit, out: { result, pending } };
}

async function main() {
  const [itemId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const fi = process.argv.indexOf('--fulfil'); const vi = process.argv.indexOf('--value');
  if (!itemId || (fi >= 0) !== (vi >= 0)) { console.error('usage: run-item.mjs <item-id> [--fulfil <key> --value <json>]'); process.exit(2); }
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const capabilities = makeClaudeCodeCapabilities({});
  const { exit, out } = await driveItem({ itemId, backlogDir: cfg.backlogDir ?? 'docs/backlog', checksDir: cfg.checksDir,
    fulfil: fi >= 0 ? { key: process.argv[fi + 1], value: JSON.parse(process.argv[vi + 1]) } : undefined, capabilities });
  console.log(JSON.stringify(out, null, 2));
  process.exit(exit);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

Note: `readItems` must be exported from `scope-gate.mjs` (it is, line 30) and must surface `id`/`status`/`scope` — if it does not parse `scope`, extend it there (it already does for the scope-gate itself).

- [ ] **Step 4: Run tests** — `node --test runtime/adapters/claude-code/test/run-item.test.mjs` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/adapters/claude-code/run-item.mjs runtime/adapters/claude-code/test/run-item.test.mjs
git commit --no-verify -m "feat(runtime): run-item session driver — park/fulfil drive loop over runWorker" && git log --oneline -1
```

---

### Task 8: Full gate + docs re-freeze record

**Files:**
- Modify: `docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md` (append delta section after §17)
- Modify: `docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md` (one pointer line in §15)
- Modify: `runtime/GUIDE.md` (§5 stub table + §2 command list)

- [ ] **Step 1: Run the FULL gate**

Run: the Global-Constraints test command (all seven globs) AND `npx tsc --noEmit -p runtime/tsconfig.json`.
Expected: ALL suites PASS, tsc clean. Fix any straggler test still asserting pre-re-freeze shapes (grep hints: `ship=`, `merge=`, `gitHeadSha`, `gate.start` used with `steps.get`).

- [ ] **Step 2: Append to SPEC 3** (after §17, verbatim):

```markdown
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
```

- [ ] **Step 3: SPEC 1 §15 pointer** — append one line at the end of SPEC 1's §15 section: `- 2026-07-03 (seam-probe): journal park/fulfil + TaskResult union re-freeze — see SPEC 3 §18.`

- [ ] **Step 4: GUIDE.md** — in §5, replace the "Today these are stubs." paragraph with the park-on-execute reality (execute/ask now PARK to the journal when no runner/interactive is injected; the session drives via `node runtime/adapters/claude-code/run-item.mjs <item-id>`); add that command to the §2 and §8 command tables.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md runtime/GUIDE.md
git commit --no-verify -m "docs(runtime): SPEC 3 §18 re-freeze delta + SPEC 1 pointer + GUIDE driver/park reality" && git log --oneline -1
```

---

### Task 9: The probe run — loop-driven tail (live validation)

No new source files; this task PERFORMS the run and captures evidence. The victim fix happens inside step 3 as the execute payload.

- [ ] **Step 1: Fresh drive + resume proof #1**

```bash
node runtime/adapters/claude-code/run-item.mjs runtime-seam-probe          # expect exit 3, pending execute:runtime-seam-probe
node runtime/adapters/claude-code/run-item.mjs runtime-seam-probe          # re-drive: SAME park pending, no duplicate begin — resume-as-replay
ls "$(git rev-parse --path-format=absolute --git-common-dir)/journal/item-runtime-seam-probe/"
```

Capture: both exits are 3; `steps.ndjson` contains ONE `awaiting` line for `execute:runtime-seam-probe` per drive (append-only history is fine; `pendingDecisions` collapses by key), and `gate.start` appears as a `record` evidence line each drive (gates re-ran).

- [ ] **Step 2: Perform the victim fix (the execute payload) — `no-agent-result-fallback-check-overbroad`**

In `tools/check-no-agent-result-fallback.mjs` replace the regex + `findViolations`:

```js
// An invocation-result fallback: `?? {}` / `?? []` where the LHS expression names an agent/orchestrator
// result (invoke/invocation/orchestrator/agent*/structured/output) — NOT every nullish-coalesce (the
// over-broad v1 flagged 38 sites incl. plain DB reads; see no-agent-result-fallback-check-overbroad).
const FALLBACK_RE = /([A-Za-z0-9_$.\)\]\?!]+)\s*\?\?\s*(\{\s*\}|\[\s*\])/g;
const AGENTISH_LHS = /\b(invoke|invocation|orchestrat\w*|agent\w*|structured\w*|\.output\b)/i;

export function findViolations(text, relPath, exclusions = new Set()) {
  if (!relPath.includes('/src/') || exclusions.has(relPath)) return [];
  const v = []; let m; FALLBACK_RE.lastIndex = 0;
  while ((m = FALLBACK_RE.exec(text))) {
    if (!AGENTISH_LHS.test(m[1])) continue;                    // plain nullish-coalesce (DB read etc.) — legitimate
    v.push({ rule: 'agent-result-fallback', relPath, line: lineOf(text, m.index), token: m[0] });
  }
  return v;
}
```

Update fixtures so the golden gate encodes the narrowed property:
- `runtime/eval/scenarios/fixtures/no-agent-result-fallback/bad/nullish-object.ts` → `const profile = agentResult.output ?? {};`
- `runtime/eval/scenarios/fixtures/no-agent-result-fallback/bad/nullish-array.ts` → `const advice = orchestratorResponse.recommendations ?? [];`
- `runtime/eval/scenarios/fixtures/no-agent-result-fallback/good/throws.ts` → keep as-is
- Create `runtime/eval/scenarios/fixtures/no-agent-result-fallback/good/db-read.ts` → `const rows = queryResult.Items ?? [];` (the false-positive class, now green)
- In `tools/check-no-agent-result-fallback.test.mjs` NARF4, change the seeded file content to `const y = agentResult.userGoals ?? {};` (must still exit 1).

Update the YAML property line in `runtime/content/checks/no-agent-result-fallback.yaml` — the property text already says "AgentCore/orchestrator invocation result"; it is now TRUE. No YAML field changes needed.

Run: `node --test tools/check-no-agent-result-fallback.test.mjs` → PASS, and record the whole-tree count: `node tools/check-no-agent-result-fallback.mjs; echo "exit=$?"` (expect the 38 to collapse to a small true-positive set; list survivors in the item body — they belong to `gate-surfaced-source-debt`, do NOT fix them here).

Commit: `git add -A tools runtime/eval/scenarios/fixtures/no-agent-result-fallback runtime/content/checks/no-agent-result-fallback.yaml && git commit --no-verify -m "fix(checks): narrow no-agent-result-fallback to invocation-result LHS (closes overbroad finding)" && git log --oneline -1`

- [ ] **Step 3: Fulfil the execute park + resume proof #2**

```bash
node runtime/adapters/claude-code/run-item.mjs runtime-seam-probe \
  --fulfil 'execute:runtime-seam-probe' \
  --value '{"taskId":"runtime-seam-probe","status":"done","summary":"victim fix performed by session: no-agent-result-fallback narrowed to invocation-result LHS; golden gate green; whole-tree 38→<n> true positives"}'
```

Expected: exit 3, pending is now `ship-runtime-seam-probe` (execute replayed complete → ship-gate ran live → ship ask parked).

- [ ] **Step 4: The floor — hold first, then ship (both branches proven)**

Surface the parked ship decision to the user as a REAL AskUserQuestion (options Ship/Hold, Ship recommended). First round: the user answers **Hold** → fulfil accordingly... **NO** — a hold answer must NOT be fulfilled as a completion (that is the whole point of `recordWhen`). To exercise hold: answer the AskUserQuestion 'Hold', do NOT fulfil anything, re-drive — expect exit 3, ship still pending (the deferral re-asks). Then the user answers **Ship**:

```bash
node runtime/adapters/claude-code/run-item.mjs runtime-seam-probe \
  --fulfil 'ship-runtime-seam-probe' --value '{"decisionId":"ship-runtime-seam-probe","value":"ship"}'
```

Expected: exit 0, `result.status === 'done'`, summary `worked runtime-seam-probe; ship approved`.

- [ ] **Step 5: Capture evidence** — copy into the backlog file body (§ Probe evidence): the journal dir listing, the per-drive exit-code sequence (3,3,3,3,0), a `steps.ndjson` excerpt (the awaiting→complete pair for both parks + `gate.*` records), and the whole-tree victim count. Commit with the backlog edit in Task 10.

---

### Task 10: Contract-gap list + victim ship + return to /backlog-next closing

- [ ] **Step 1: Write the contract-gap list** (deliverable 3) as a `## Contract-gap list (measured)` section in `docs/backlog/runtime-seam-probe.md` — every place the seam proved too thin during Task 9, each tagged `p2`/`p5`/`none`. If none surfaced beyond the implemented re-freeze, state that explicitly (that IS the result).
- [ ] **Step 2: Ship the victim item** — edit `docs/backlog/no-agent-result-fallback-check-overbroad.md`: `status: shipped`, `closed: <today>`, `validation_gate:` = "Narrowed via runtime-seam-probe probe run (loop execute payload): golden gate NARF1-4 green, whole-tree 38→<n>; shipped in the runtime-seam-probe PR <sha>."
- [ ] **Step 3: Run `node .claude/skills/backlog-lint/lint.mjs --fix`; commit both backlog files + regenerated `docs/BACKLOG.md`.**
- [ ] **Step 4: Hand control back to `/backlog-next` closing phase (6.1→6.8)** — doc-derivation detect, true-affected verify, deploy-detect (expect Tier-0 exit 10), ship the probe backlog file with `validation_gate` (full gate output + probe evidence + commit SHAs), lint --fix, then `superpowers:finishing-a-development-branch` (PR), then worktree cleanup + postflight. These are the SKILL's steps — do not reimplement them here.

## Self-review (done at authoring)

Spec coverage: §3→Task 1, §4→Task 2, §5(spine/adapter/driver)→Tasks 3-7, §5(re-freeze record)→Task 8, §6→Task 9, §7→Tasks 1-8 tests, §8 honored (no hardening/backward items touched). Types consistent: `execute:<id>`/`ship-<id>`/`member.<id>` keys, `askStep` signature, `deriveJudge` shape match across Tasks 2-7. No placeholders remain.
