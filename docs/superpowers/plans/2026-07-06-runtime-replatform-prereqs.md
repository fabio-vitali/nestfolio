# Runtime Re-Platform Prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four shared prerequisites (Sections A–D of the strategy spec) that every per-skill work-driver re-platform depends on: the `RUNTIME_ENGINE` flag + path-provenance journal records, the `soak-observer.mjs` go/no-go instrument, the parity-oracle `path:runtime` assertion + extension mechanism, and the three parity-hole fixes.

**Architecture:** Ring-1 pure logic (journal / env / memDir all injected) with ring-2 adapter CLIs doing the IO. A single new ring-1 module (`path-provenance.mjs`) is the shared vocabulary that the adapter drivers *write* and both `soak-observer.mjs` and `runtime-grade.mjs` *read*. The three holes are surgical: one schema field made optional, one new judgment-seamed procedure mirroring `intake.mjs`, and one dossier-reconcile side-car mirroring `reconcile-lesson.mjs`.

**Tech Stack:** Node ≥24 (native TypeScript type-stripping — `.mjs` imports `.ts` zod schemas directly, zero build), `yaml`, `zod`. Tests are `node:test` + `node:assert/strict`.

## Global Constraints

- **Node ≥24, zero-build.** `.mjs` files import `.ts` schemas directly (type-stripping). Never add a compile step. Confirmed toolchain: `node --version` ≥ v24.
- **Test command is `node --test <glob>`, NOT nx.** `scripts/` and `runtime/` have no runnable nx test inside a worktree. Runtime suite: `node --test runtime/engine/test/*.test.mjs runtime/engine/backward/test/*.test.mjs runtime/engine/loop/test/*.test.mjs runtime/adapters/**/test/*.test.mjs runtime/eval/test/*.test.mjs runtime/eval/e2e/*.test.mjs runtime/content/test/*.test.mjs`. Oracle suite: `node --test scripts/parity-oracle/test/*.test.mjs`. The **glob** form is mandatory — a bare directory does not discover suites on Node 24.
- **Ring discipline.** Ring-1 (`runtime/engine/**`) is pure and harness-agnostic: journal, env, and filesystem roots are always **injected**, never hardcoded. Ring-2 adapters (`runtime/adapters/**`, `scripts/**`) own CLIs, `process.env`, `process.argv`, and filesystem writes.
- **Frontmatter regex is shared, never re-derived:** `/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/`.
- **Worktree commits need `--no-verify`** (the worktree pre-commit hook silently rejects code commits) AND you must verify each commit landed (`git log --oneline -1`), never trust an echo.
- **Journal record API** (`runtime/engine/lib/journal.mjs`): `record(runId, key, value)` appends `{ key, status: 'complete', value, ts }` (`ts` auto-stamped — never pass it); `read(runId)` → `{ meta, steps: Map<key, StepRecord> }` or `null` (last-write-wins per key); `begin(runId, { runId, auto })` writes meta and is idempotent. There is **no** `type`/`id`/`sha` field on a record — the tag is the colon-namespaced `key`; everything else rides in `value`.
- **No `Date.now()`/`Math.random()` restriction applies here** — that is a Workflow-script-only constraint. Runtime code runs in real Node; `new Date().toISOString()` is fine (and is the established idiom in `reconcile-lesson.mjs:26`).

---

### Task 1: Ring-1 path-provenance module (Deliverable A — core)

The single source of truth for the `RUNTIME_ENGINE` flag and the `path:runtime` / `path:legacy-fallback` journal vocabulary. Pure (journal + env injected). Mirrors the `shouldSkip(env) = Boolean(env.RUNTIME_GATE_SKIP)` idiom at `runtime/adapters/git/pre-commit-gate.mjs:19` and the dedicated-ledger pattern (`runId: 'gate-skips'`) at `pre-commit-gate.mjs:42`.

**Files:**
- Create: `runtime/engine/lib/path-provenance.mjs`
- Test: `runtime/engine/test/path-provenance.test.mjs`

**Interfaces:**
- Consumes: `runtime/engine/lib/journal.mjs` (`makeJournal`/`inMemoryJournal` contract — `record`, `begin`, `read`).
- Produces:
  - `usesRuntimeEngine(env): boolean`
  - `RUNTIME_PATH_KEY = 'path:runtime'`, `FALLBACK_RUN_ID = 'path-fallback'`, `PATH_RUNTIME = 'runtime'`, `PATH_LEGACY_FALLBACK = 'legacy-fallback'`
  - `fallbackKey(workstream): string` → `` `fallback:${workstream}` ``
  - `recordRuntimePath(journal, { runId, workstream, sha }): void`
  - `recordLegacyFallback(journal, { workstream, reason, sha }): void`
  - `isRuntimePathRecord(step): boolean`

- [ ] **Step 1: Write the failing test**

Create `runtime/engine/test/path-provenance.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inMemoryJournal } from '../lib/journal.mjs';
import {
  usesRuntimeEngine, RUNTIME_PATH_KEY, FALLBACK_RUN_ID, PATH_RUNTIME, PATH_LEGACY_FALLBACK,
  fallbackKey, recordRuntimePath, recordLegacyFallback, isRuntimePathRecord,
} from '../lib/path-provenance.mjs';

test('usesRuntimeEngine mirrors the Boolean(env.X) flag idiom', () => {
  assert.equal(usesRuntimeEngine({ RUNTIME_ENGINE: '1' }), true);
  assert.equal(usesRuntimeEngine({ RUNTIME_ENGINE: '' }), false);
  assert.equal(usesRuntimeEngine({}), false);
});

test('recordRuntimePath writes a complete path:runtime step in the workstream ledger', () => {
  const j = inMemoryJournal();
  j.begin('item-foo', { runId: 'item-foo', auto: false });
  recordRuntimePath(j, { runId: 'item-foo', workstream: 'foo', sha: 'abc123' });
  const step = j.read('item-foo').steps.get(RUNTIME_PATH_KEY);
  assert.equal(step.status, 'complete');
  assert.deepEqual(step.value, { path: PATH_RUNTIME, workstream: 'foo', sha: 'abc123' });
  assert.equal(isRuntimePathRecord(step), true);
});

test('recordLegacyFallback begins + writes to the dedicated ledger, keyed by workstream', () => {
  const j = inMemoryJournal();
  recordLegacyFallback(j, { workstream: 'bar', reason: 'runtime path blocked on X', sha: 'def456' });
  const step = j.read(FALLBACK_RUN_ID).steps.get(fallbackKey('bar'));
  assert.equal(step.status, 'complete');
  assert.equal(step.value.path, PATH_LEGACY_FALLBACK);
  assert.equal(step.value.workstream, 'bar');
  assert.equal(step.value.reason, 'runtime path blocked on X');
});

test('isRuntimePathRecord is false for a non-runtime / missing step', () => {
  assert.equal(isRuntimePathRecord(undefined), false);
  assert.equal(isRuntimePathRecord({ status: 'complete', value: { path: PATH_LEGACY_FALLBACK } }), false);
  assert.equal(isRuntimePathRecord({ status: 'awaiting', value: { path: PATH_RUNTIME } }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/path-provenance.test.mjs`
Expected: FAIL — `Cannot find module '../lib/path-provenance.mjs'`.

- [ ] **Step 3: Write the module**

Create `runtime/engine/lib/path-provenance.mjs`:

```js
// runtime/engine/lib/path-provenance.mjs — ring-1: the RUNTIME_ENGINE strangler flag + path-provenance
// vocabulary (spec §4). The single source of truth for which path drove a workstream. Writers = the
// adapter drivers (run-item / run-intake / …); readers = scripts/parity-oracle/soak-observer.mjs +
// runtime-grade.mjs. Pure: the journal and env are injected. Mirrors shouldSkip(env) at
// runtime/adapters/git/pre-commit-gate.mjs:19 and the dedicated 'gate-skips' ledger pattern.

export const RUNTIME_PATH_KEY = 'path:runtime';        // step key in the workstream's OWN ledger
export const FALLBACK_RUN_ID = 'path-fallback';        // dedicated ledger (mirrors 'gate-skips')
export const PATH_RUNTIME = 'runtime';
export const PATH_LEGACY_FALLBACK = 'legacy-fallback';

/** Hard cutover — one flag, no per-skill variants. Mirrors shouldSkip(env). */
export function usesRuntimeEngine(env) { return Boolean(env.RUNTIME_ENGINE); }

/** The dedicated-ledger key for a workstream's fallback (one per workstream — presence = "not ready"). */
export const fallbackKey = (workstream) => `fallback:${workstream}`;

/** Journal a runtime-path provenance record in the workstream's own ledger (soak counts these). */
export function recordRuntimePath(journal, { runId, workstream, sha }) {
  journal.record(runId, RUNTIME_PATH_KEY, { path: PATH_RUNTIME, workstream, sha });
}

/** Journal a DELIBERATE legacy fallback to the dedicated ledger — loud and countable (§4). */
export function recordLegacyFallback(journal, { workstream, reason, sha }) {
  journal.begin(FALLBACK_RUN_ID, { runId: FALLBACK_RUN_ID, auto: false });
  journal.record(FALLBACK_RUN_ID, fallbackKey(workstream), { path: PATH_LEGACY_FALLBACK, workstream, reason, sha });
}

/** True iff a StepRecord (from journal.read().steps) is a completed runtime-path provenance record. */
export function isRuntimePathRecord(step) {
  return step?.status === 'complete' && step?.value?.path === PATH_RUNTIME;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/path-provenance.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/path-provenance.mjs runtime/engine/test/path-provenance.test.mjs
git commit --no-verify -m "feat(runtime): path-provenance module — RUNTIME_ENGINE flag + path:runtime/legacy-fallback ledger (spec §4)"
git log --oneline -1
```

---

### Task 2: Emit `path:runtime` from the item + intake drivers (Deliverable A — wiring)

When a runtime driver actually drives a workstream, it journals a `path:runtime` record. This is what gives the oracle assertion (Task 3) and the soak observer (Task 4) real evidence. The `usesRuntimeEngine` *toggle* at each skill's entry is a per-skill workstream (WS-1..4) concern — here we only make the drivers emit provenance when they run.

**Files:**
- Modify: `runtime/adapters/claude-code/run-item.mjs` (emit after `runWorker` returns)
- Modify: `runtime/adapters/claude-code/run-intake.mjs` (emit right after `journal.begin`)
- Test: `runtime/adapters/claude-code/test/run-item.test.mjs` (extend)
- Test: `runtime/adapters/claude-code/test/run-intake.test.mjs` (extend)

**Interfaces:**
- Consumes: `recordRuntimePath` (Task 1), `gitHeadSha` from `runtime/engine/lib/journal.mjs`.
- Produces: a `path:runtime` complete step in each driver's run ledger (`item-<id>` / `intake-<finding.id>`).

- [ ] **Step 1: Write the failing test (run-item)**

Append to `runtime/adapters/claude-code/test/run-item.test.mjs` (after the existing `DRV3` test, before `DRV4`):

```js
test('DRV5 a driven item journals a path:runtime provenance record', async () => {
  const { root, dir, checks } = tmpBacklog();
  try {
    const j = inMemoryJournal();
    await driveItem({ itemId: 'probe-x', backlogDir: dir, checksDir: checks, capabilities: caps(j) });
    const step = j.read('item-probe-x').steps.get('path:runtime');
    assert.equal(step?.status, 'complete');
    assert.equal(step.value.path, 'runtime');
    assert.equal(step.value.workstream, 'probe-x');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/adapters/claude-code/test/run-item.test.mjs`
Expected: FAIL on DRV5 — `step` is `undefined`.

- [ ] **Step 3: Wire emission into run-item.mjs**

In `runtime/adapters/claude-code/run-item.mjs`, extend the journal import (line 11) and add the emission in `driveItem` right after `runWorker` returns.

Change the import line:
```js
import { pendingDecisions } from '../../engine/lib/journal.mjs';
```
to:
```js
import { pendingDecisions, gitHeadSha } from '../../engine/lib/journal.mjs';
import { recordRuntimePath } from '../../engine/lib/path-provenance.mjs';
```

Then in `driveItem`, change:
```js
  const result = await runWorker({ item, capabilities, registry });
  const pending = pendingDecisions(capabilities.journal.read(runId));
```
to:
```js
  const result = await runWorker({ item, capabilities, registry });
  recordRuntimePath(capabilities.journal, { runId, workstream: itemId, sha: gitHeadSha() });
  const pending = pendingDecisions(capabilities.journal.read(runId));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/adapters/claude-code/test/run-item.test.mjs`
Expected: PASS (DRV1–DRV5).

- [ ] **Step 5: Write the failing test (run-intake)**

First read `runtime/adapters/claude-code/test/run-intake.test.mjs` to match its fixture/caps helpers (it mirrors run-item.test.mjs: `inMemoryJournal()` + a `caps(j)` helper + a tmp backlog, driving `driveIntake` with a `--fulfil` route answer). Add a test asserting the `intake-<id>` ledger carries a `path:runtime` record after a completed route. Use the same finding-fulfil shape the existing tests use; the assertion is:

```js
test('a driven intake journals a path:runtime provenance record', async () => {
  const j = inMemoryJournal();
  const finding = { id: 'f-prov', check: 'c', kind: 'gap', scope: ['docs/**'], detail: 'x', raised_at: 't' };
  // first call parks on the execute judgment; fulfil it with an orphan route so files are filed
  await driveIntake({ finding, backlogDir: dir, checksDir: checks, capabilities: caps(j) });
  await driveIntake({ finding, backlogDir: dir, checksDir: checks, capabilities: caps(j),
    fulfil: { key: 'execute:intake-f-prov', value: { taskId: 'intake-f-prov', status: 'done', summary: JSON.stringify({ route: 'orphan' }) } } });
  const step = j.read('intake-f-prov').steps.get('path:runtime');
  assert.equal(step?.value?.path, 'runtime');
  assert.equal(step.value.workstream, 'f-prov');
});
```

(Adapt `dir`/`checks`/`caps` names to whatever `run-intake.test.mjs` already defines; if it lacks a tmp-backlog helper, copy the `tmpBacklog()`/`caps()` pattern verbatim from `run-item.test.mjs`.)

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test runtime/adapters/claude-code/test/run-intake.test.mjs`
Expected: FAIL — `path:runtime` step undefined.

- [ ] **Step 7: Wire emission into run-intake.mjs**

In `runtime/adapters/claude-code/run-intake.mjs`, extend the journal import (line 15) and emit right after `journal.begin` so both completed and parked runs record that the runtime path drove.

Change:
```js
import { pendingDecisions } from '../../engine/lib/journal.mjs';
```
to:
```js
import { pendingDecisions, gitHeadSha } from '../../engine/lib/journal.mjs';
import { recordRuntimePath } from '../../engine/lib/path-provenance.mjs';
```

Then in `driveIntake`, change:
```js
  journal.begin(runId, { runId, auto: false });
  if (fulfil) journal.fulfil(runId, fulfil.key, fulfil.value);
```
to:
```js
  journal.begin(runId, { runId, auto: false });
  recordRuntimePath(journal, { runId, workstream: finding.id, sha: gitHeadSha() });
  if (fulfil) journal.fulfil(runId, fulfil.key, fulfil.value);
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test runtime/adapters/claude-code/test/run-intake.test.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add runtime/adapters/claude-code/run-item.mjs runtime/adapters/claude-code/run-intake.mjs runtime/adapters/claude-code/test/run-item.test.mjs runtime/adapters/claude-code/test/run-intake.test.mjs
git commit --no-verify -m "feat(runtime): item + intake drivers journal path:runtime provenance (spec §4)"
git log --oneline -1
```

---

### Task 3: Parity-oracle `path:runtime` assertion + extension mechanism (Deliverable C)

Add the hollow-green guard: a mapped scenario only passes if the runtime path actually drove it (evidenced by the `path:runtime` record from Task 2). Add a `path` journal verb to the grader, teach the structural linter the verb, require every rt scenario to assert it (so the guard cannot be forgotten as scenarios migrate), add each of the 11 existing scenarios' assertion, and add the `unmappedIds()` partition helper that makes the "42→0" migration checklist enforceable.

**Files:**
- Modify: `scripts/parity-oracle/runtime-grade.mjs` (add `path` verb to `gradeJournal`)
- Modify: `scripts/parity-oracle/structural-lint.mjs` (accept `path` as a journal-spec verb)
- Modify: `scripts/parity-oracle/mapping.mjs` (add `unmappedIds()`)
- Modify: all 11 files in `scripts/parity-oracle/scenarios/*.scenario.mjs` (add `path: 'runtime'` to the driver's journal spec)
- Test: `scripts/parity-oracle/test/runtime-grade.test.mjs` (extend — `path` verb)
- Test: `scripts/parity-oracle/test/scenarios-lint.test.mjs` (extend — hollow-green guard)
- Test: `scripts/parity-oracle/test/mapping.test.mjs` (extend — partition)

**Interfaces:**
- Consumes: `RUNTIME_PATH_KEY` (Task 1), the `path:runtime` records (Task 2).
- Produces: `unmappedIds()` from `mapping.mjs`; a `path` verb usable in any scenario `journal[]` spec.

- [ ] **Step 1: Write the failing grader test**

First read `scripts/parity-oracle/test/runtime-grade.test.mjs` to match its sandbox-building helper (it builds a real temp `.git` and writes journal records). Add a test that a scenario declaring `{ runId, path: 'runtime' }` fails when the ledger has no such record and passes when it does. If the existing test already has a helper that writes a step via `makeJournal({ root })`, reuse it; otherwise the minimal assertion against `gradeJournal` directly is:

```js
import { gradeJournal } from '../runtime-grade.mjs';
import { makeJournal } from '../../../runtime/engine/lib/journal.mjs';
import { recordRuntimePath } from '../../../runtime/engine/lib/path-provenance.mjs';
import { mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('path verb: fails when no path:runtime record, passes once emitted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-grade-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const scenario = { journal: [{ runId: 'item-z', path: 'runtime' }] };
  assert.equal(gradeJournal(scenario, dir).pass, false);
  const j = makeJournal({ root: join(dir, '.git') });
  j.begin('item-z', { runId: 'item-z', auto: false });
  recordRuntimePath(j, { runId: 'item-z', workstream: 'z', sha: 'deadbee' });
  assert.equal(gradeJournal(scenario, dir).pass, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/parity-oracle/test/runtime-grade.test.mjs`
Expected: FAIL — the `path` verb is not evaluated, so the first (no-record) assertion `pass === false` fails (currently returns `true` because unknown verbs are ignored).

- [ ] **Step 3: Add the `path` verb to `gradeJournal`**

In `scripts/parity-oracle/runtime-grade.mjs`, extend the import (line 7) and add the verb branch inside the per-spec loop.

Change:
```js
import { makeJournal, pendingDecisions } from '../../runtime/engine/lib/journal.mjs';
```
to:
```js
import { makeJournal, pendingDecisions } from '../../runtime/engine/lib/journal.mjs';
import { RUNTIME_PATH_KEY } from '../../runtime/engine/lib/path-provenance.mjs';
```

Then, after the `spec.absent` line (line 19), add:
```js
    if (spec.path && step(RUNTIME_PATH_KEY)?.value?.path !== spec.path)
      failures.push(`journal ${spec.runId}: expected path record "${spec.path}" (runtime path did not drive)`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/parity-oracle/test/runtime-grade.test.mjs`
Expected: PASS.

- [ ] **Step 5: Teach the structural linter the `path` verb**

In `scripts/parity-oracle/structural-lint.mjs`, change the verb check:
```js
    if (!j.has && !j.awaiting && !j.absent) v.push('journal spec entry needs has|awaiting|absent');
```
to:
```js
    if (!j.has && !j.awaiting && !j.absent && !j.path) v.push('journal spec entry needs has|awaiting|absent|path');
```

- [ ] **Step 6: Write the failing hollow-green guard test**

In `scripts/parity-oracle/test/scenarios-lint.test.mjs`, add a new test (after the existing tests):

```js
test('hollow-green guard: every rt scenario asserts the runtime path drove it', async () => {
  for (const f of readdirSync(scenDir).filter((x) => x.endsWith('.scenario.mjs'))) {
    const s = (await import(new URL(f, scenDir))).default;
    assert.ok((s.journal ?? []).some((j) => j.path === 'runtime'),
      `${f}: must declare a { path: 'runtime' } journal spec — else a mapped scenario could pass without the runtime path driving it`);
  }
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `node --test scripts/parity-oracle/test/scenarios-lint.test.mjs`
Expected: FAIL — every one of the 11 scenarios is missing the `path: 'runtime'` assertion.

- [ ] **Step 8: Add `path: 'runtime'` to all 11 scenarios**

For each `scripts/parity-oracle/scenarios/*.scenario.mjs`, add `path: 'runtime'` to the journal spec whose `runId` is the driver's run (the runId already present in that scenario's `journal[]`). Example — `rt-add-fold-core.scenario.mjs` line 23:

```js
  journal: [{ runId: 'intake-f-acme-error-contract', has: 'intake:f-acme-error-contract:filed' }],
```
becomes:
```js
  journal: [{ runId: 'intake-f-acme-error-contract', has: 'intake:f-acme-error-contract:filed', path: 'runtime' }],
```

Do the same for the other 10 (`rt-add-atomicity-split`, `rt-add-commit-scope`, `rt-add-fold-captured`, `rt-add-join-theme`, `rt-add-mint-aggregation`, `rt-add-orphan`, `rt-next-auto-finishing-pr-stop`, `rt-next-auto-floor-pause`, `rt-next-lane-complex-ship`, `rt-next-preflight-dirty-stop`). Each already has a `journal[]` with the driver runId — add `path: 'runtime'` to that spec object. The Step 6 test is the safety net: rerun it until it lists zero missing files.

- [ ] **Step 9: Run test to verify it passes**

Run: `node --test scripts/parity-oracle/test/scenarios-lint.test.mjs`
Expected: PASS (all four tests, including the hollow-green guard).

- [ ] **Step 10: Add `unmappedIds()` + partition test**

In `scripts/parity-oracle/mapping.mjs`, add next to `mappedIds()`:
```js
/** The still-unmapped legacy ids — the P5 migration checklist (drains toward 0 as skills re-platform). */
export function unmappedIds() { return Object.entries(MAPPING).filter(([, m]) => m.unmapped).map(([id]) => id); }
```

In `scripts/parity-oracle/test/mapping.test.mjs`, extend the import (line 5) to include `unmappedIds` and add:
```js
test('mapped and unmapped partition the full MAPPING (no id is both or neither)', () => {
  const all = Object.keys(MAPPING).sort();
  assert.deepEqual([...mappedIds(), ...unmappedIds()].sort(), all);
  assert.equal(new Set([...mappedIds(), ...unmappedIds()]).size, all.length); // disjoint
});
```

- [ ] **Step 11: Run the full oracle test suite**

Run: `node --test scripts/parity-oracle/test/*.test.mjs`
Expected: PASS (all suites green — including `mapping.test.mjs`'s existing `mapped.length === 11`, unchanged since prereqs maps no new scenarios).

- [ ] **Step 12: Commit**

```bash
git add scripts/parity-oracle/runtime-grade.mjs scripts/parity-oracle/structural-lint.mjs scripts/parity-oracle/mapping.mjs scripts/parity-oracle/scenarios/ scripts/parity-oracle/test/runtime-grade.test.mjs scripts/parity-oracle/test/scenarios-lint.test.mjs scripts/parity-oracle/test/mapping.test.mjs
git commit --no-verify -m "feat(oracle): path:runtime hollow-green guard + unmappedIds migration checklist (spec §6)"
git log --oneline -1
```

---

### Task 4: `soak-observer.mjs` — the go/no-go instrument (Deliverable B)

Reads the **real** repo journal (which the oracle's skill-less sandbox structurally cannot see) and computes the soak verdict: ≥5 distinct `path:runtime` workstreams AND zero `path:legacy-fallback` records AND the oracle green. Pure verdict core + a thin CLI.

**Files:**
- Create: `scripts/parity-oracle/soak-observer.mjs`
- Test: `scripts/parity-oracle/test/soak-observer.test.mjs`

**Interfaces:**
- Consumes: `makeJournal`, `gitCommonDir` from `runtime/engine/lib/journal.mjs`; `FALLBACK_RUN_ID`, `RUNTIME_PATH_KEY`, `isRuntimePathRecord`, `PATH_LEGACY_FALLBACK` from Task 1.
- Produces: `listRunIds(root): string[]`, `computeSoakVerdict({ journal, runIds, oracleGreen, threshold }): { green, runtimeWorkstreams, fallbacks, clauses }`.

- [ ] **Step 1: Write the failing test**

Create `scripts/parity-oracle/test/soak-observer.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSoakVerdict } from '../soak-observer.mjs';

// A fake journal whose read(runId) returns a canned ledger { steps: Map }.
function fakeJournal(ledgers) {
  return { read: (runId) => ledgers[runId] ?? null };
}
const rt = (workstream) => new Map([['path:runtime', { status: 'complete', value: { path: 'runtime', workstream } }]]);
const fb = (workstream) => new Map([[`fallback:${workstream}`, { status: 'complete', value: { path: 'legacy-fallback', workstream } }]]);

test('green when >=5 runtime workstreams, zero fallbacks, oracle green', () => {
  const runIds = ['item-a', 'item-b', 'item-c', 'item-d', 'epic-e', 'intake-x'];
  const journal = fakeJournal({
    'item-a': { steps: rt('a') }, 'item-b': { steps: rt('b') }, 'item-c': { steps: rt('c') },
    'item-d': { steps: rt('d') }, 'epic-e': { steps: rt('e') }, 'intake-x': { steps: rt('x') },
    'path-fallback': { steps: new Map() },
  });
  const v = computeSoakVerdict({ journal, runIds, oracleGreen: true });
  assert.equal(v.green, true);
  assert.equal(v.runtimeWorkstreams.length, 5); // intake-* is excluded from the workstream count
});

test('not green with a fallback present', () => {
  const runIds = ['item-a', 'item-b', 'item-c', 'item-d', 'item-e'];
  const steps = Object.fromEntries(runIds.map((id) => [id, { steps: rt(id) }]));
  const journal = fakeJournal({ ...steps, 'path-fallback': { steps: fb('a') } });
  const v = computeSoakVerdict({ journal, runIds, oracleGreen: true });
  assert.equal(v.clauses.zeroFallback, false);
  assert.equal(v.green, false);
});

test('not green below threshold or when oracle red', () => {
  const runIds = ['item-a', 'item-b'];
  const journal = fakeJournal({ 'item-a': { steps: rt('a') }, 'item-b': { steps: rt('b') }, 'path-fallback': { steps: new Map() } });
  assert.equal(computeSoakVerdict({ journal, runIds, oracleGreen: true }).clauses.enoughRuntime, false);
  const five = ['item-a', 'item-b', 'item-c', 'item-d', 'item-e'];
  const j5 = fakeJournal({ ...Object.fromEntries(five.map((id) => [id, { steps: rt(id) }])), 'path-fallback': { steps: new Map() } });
  assert.equal(computeSoakVerdict({ journal: j5, runIds: five, oracleGreen: false }).green, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/parity-oracle/test/soak-observer.test.mjs`
Expected: FAIL — `Cannot find module '../soak-observer.mjs'`.

- [ ] **Step 3: Write the module**

Create `scripts/parity-oracle/soak-observer.mjs`:

```js
#!/usr/bin/env node
// scripts/parity-oracle/soak-observer.mjs — the P5 go/no-go soak instrument (spec §5). Reads the REAL
// repo journal (which the oracle's skill-less sandbox structurally cannot see) and computes the binding
// soak verdict: >=5 distinct path:runtime workstreams AND zero path:legacy-fallback AND the oracle green.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeJournal, gitCommonDir } from '../../runtime/engine/lib/journal.mjs';
import { FALLBACK_RUN_ID, RUNTIME_PATH_KEY, isRuntimePathRecord, PATH_LEGACY_FALLBACK } from '../../runtime/engine/lib/path-provenance.mjs';

// Top-level /backlog-next(-epic) loop drivers. intake-* runs journal path:runtime for the oracle but are
// sub-workstream routings, so they do NOT count toward the ">=5 distinct workstreams" soak clause.
const WORKSTREAM_PREFIXES = ['item-', 'epic-'];

export function listRunIds(root) {
  const dir = join(root, 'journal');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}

export function computeSoakVerdict({ journal, runIds, oracleGreen, threshold = 5 }) {
  const runtimeWorkstreams = [];
  for (const runId of runIds) {
    if (!WORKSTREAM_PREFIXES.some((p) => runId.startsWith(p))) continue;
    const step = journal.read(runId)?.steps.get(RUNTIME_PATH_KEY);
    if (isRuntimePathRecord(step)) runtimeWorkstreams.push(runId);
  }
  const fbLedger = journal.read(FALLBACK_RUN_ID);
  const fallbacks = fbLedger ? [...fbLedger.steps.values()].filter((s) => s.status === 'complete' && s.value?.path === PATH_LEGACY_FALLBACK) : [];
  const clauses = {
    enoughRuntime: runtimeWorkstreams.length >= threshold,
    zeroFallback: fallbacks.length === 0,
    oracleGreen: Boolean(oracleGreen),
  };
  return { green: clauses.enoughRuntime && clauses.zeroFallback && clauses.oracleGreen, runtimeWorkstreams, fallbacks, clauses };
}

function main() {
  // The oracle-green clause is the oracle's own job (cost-gated LLM sweep) — the operator passes its
  // result in explicitly rather than have this instrument auto-run an expensive sweep.
  const oracleGreen = process.argv.includes('--oracle-green');
  const root = gitCommonDir();
  const verdict = computeSoakVerdict({ journal: makeJournal({ root }), runIds: listRunIds(root), oracleGreen });
  console.log(JSON.stringify({
    ...verdict,
    runtimeWorkstreams: verdict.runtimeWorkstreams,
    fallbackCount: verdict.fallbacks.length,
    note: oracleGreen ? undefined : 'oracle-green not asserted; pass --oracle-green after a green live oracle sweep',
  }, null, 2));
  process.exit(verdict.green ? 0 : 1);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/parity-oracle/test/soak-observer.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Smoke-test the CLI against the real journal**

Run: `node scripts/parity-oracle/soak-observer.mjs`
Expected: prints a verdict JSON and exits non-zero (soak not yet met — expected this early; the point is it runs without crashing and reads the real journal).

- [ ] **Step 6: Commit**

```bash
git add scripts/parity-oracle/soak-observer.mjs scripts/parity-oracle/test/soak-observer.test.mjs
git commit --no-verify -m "feat(oracle): soak-observer.mjs — the >=5-runtime / zero-fallback go/no-go instrument (spec §5)"
git log --oneline -1
```

---

### Task 5: Hole #1 — `Finding.check` optional + `agent-observed` sentinel (Deliverable D#1)

The dominant real `backlog-add` source is an agent-*observed* side-finding with no originating check. Make `check` optional, introduce the reserved `agent-observed` sentinel (mirroring the `starter-pack` `minted_by` precedent at `check.schema.ts:61`), and make intake slug from `finding.id` and omit `from_check` when there is no real check.

**Files:**
- Modify: `runtime/engine/schema/finding.schema.ts` (`check` optional + `AGENT_OBSERVED` const)
- Modify: `runtime/engine/lib/intake.mjs` (slug fallback + conditional `from_check`)
- Test: `runtime/engine/test/finding-schema.test.mjs` (extend)
- Test: `runtime/engine/test/intake.test.mjs` (extend)

**Interfaces:**
- Consumes: —
- Produces: `AGENT_OBSERVED = 'agent-observed'` from `finding.schema.ts`; intake now accepts check-less findings.

- [ ] **Step 1: Write the failing schema test**

Append to `runtime/engine/test/finding-schema.test.mjs`:

```js
test('a check-less (agent-observed) finding validates; AGENT_OBSERVED is exported', async () => {
  const { AGENT_OBSERVED } = await import('../schema/finding.schema.ts');
  assert.equal(AGENT_OBSERVED, 'agent-observed');
  const r = validateFinding({ id: 'f-obs', kind: 'gap', scope: ['docs/x.md'], detail: 'observed side-finding', raised_at: 't' });
  assert.equal(r.ok, true);
  assert.equal(r.value.check, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/finding-schema.test.mjs`
Expected: FAIL — `check` is required (`r.ok === false`) and `AGENT_OBSERVED` is undefined.

- [ ] **Step 3: Make `check` optional + add the sentinel**

In `runtime/engine/schema/finding.schema.ts`, change line 12:
```js
  check: z.string().min(1),        // the CheckId that raised it
```
to:
```js
  check: z.string().min(1).optional(), // the CheckId that raised it — omitted (or AGENT_OBSERVED) for agent-observed side-findings
```

And add, above `export const FindingSchema` (after the `FindingId` type on line 9):
```js
// Reserved provenance sentinel: an agent-*observed* side-finding with no originating check (§7 Hole #1 /
// D-D1). Mirrors the "starter-pack" minted_by sentinel (check.schema.ts:61) — a magic literal, not a new
// schema branch. A finding with check omitted, or check === AGENT_OBSERVED, is treated as check-less.
export const AGENT_OBSERVED = 'agent-observed';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/finding-schema.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the failing intake test**

Append to `runtime/engine/test/intake.test.mjs`:

```js
test('D5: a check-less finding slugs from finding.id and omits from_check', async () => {
  const observed = { id: 'obs-1', kind: 'gap', scope: ['docs/x.md'], detail: 'agent saw drift', raised_at: 't' };
  const d = await intake({ finding: observed, registry: {}, backlog: [], capabilities: fakeCaps({ route: 'orphan' }) });
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].id, 'from-obs-1');
  assert.equal(d.items[0].provenance.from_finding, 'obs-1');
  assert.equal('from_check' in d.items[0].provenance, false);
});

test('D6: an explicit agent-observed check behaves identically to a check-less finding', async () => {
  const observed = { id: 'obs-2', check: 'agent-observed', kind: 'gap', scope: ['docs/x.md'], detail: 'y', raised_at: 't' };
  const d = await intake({ finding: observed, registry: {}, backlog: [], capabilities: fakeCaps({ route: 'orphan' }) });
  assert.equal(d.items[0].id, 'from-obs-2');
  assert.equal('from_check' in d.items[0].provenance, false);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test runtime/engine/test/intake.test.mjs`
Expected: FAIL — D5 id is `from-undefined`, and `from_check` is present (as `undefined`/`null`).

- [ ] **Step 7: Fix intake's slug + provenance**

In `runtime/engine/lib/intake.mjs`, add the import at the top and rewrite the slug + `baseItem` helpers (lines 5–13).

Add after the header comment (before line 5):
```js
import { AGENT_OBSERVED } from '../schema/finding.schema.ts';
```

Replace:
```js
const slug = (finding, suffix) => `from-${finding.check}${suffix ? `-${suffix}` : ''}`;
const baseItem = (finding, over) => ({
  id: over.id ?? slug(finding),
  type: 'bug',
  status: 'parking',
  done_when: `resolve: ${finding.detail}`,
  provenance: { from_finding: finding.id, from_check: finding.check },
  ...over,
});
```
with:
```js
// A finding with no real originating check (omitted, or the reserved AGENT_OBSERVED sentinel) is an
// agent-observed side-finding: slug from its unique finding.id, and omit from_check from provenance.
const originatingCheck = (finding) => (finding.check && finding.check !== AGENT_OBSERVED ? finding.check : null);
const slug = (finding, suffix) => `from-${originatingCheck(finding) ?? finding.id}${suffix ? `-${suffix}` : ''}`;
const baseItem = (finding, over) => {
  const check = originatingCheck(finding);
  return {
    id: over.id ?? slug(finding),
    type: 'bug',
    status: 'parking',
    done_when: `resolve: ${finding.detail}`,
    provenance: { from_finding: finding.id, ...(check ? { from_check: check } : {}) },
    ...over,
  };
};
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test runtime/engine/test/intake.test.mjs`
Expected: PASS (D1–D6 — the existing D1 still asserts `from_check === 'no-x'` for a real check, unchanged).

- [ ] **Step 9: Commit**

```bash
git add runtime/engine/schema/finding.schema.ts runtime/engine/lib/intake.mjs runtime/engine/test/finding-schema.test.mjs runtime/engine/test/intake.test.mjs
git commit --no-verify -m "feat(runtime): Finding.check optional + agent-observed sentinel; intake slugs check-less findings from id (spec §7 Hole #1)"
git log --oneline -1
```

---

### Task 6: Hole #2 — themes cold-path clustering + leftovers spin-out library (Deliverable D#2)

The runtime home for `backlog-themes`: the all-vs-all sibling of `intake.mjs`'s per-finding hot-path. Judgment is seamed via `capabilities.execute` (same convention as `selectRoute`); the shaping and the epic-close leftovers spin-out are pure deterministic cores. This task is the library + tests; the CLI driver is Task 7. Wiring the leftovers spin-out into the epic-close loop is WS-4 (out of scope) — here it ships as a tested pure function.

**Files:**
- Create: `runtime/engine/lib/themes.mjs`
- Test: `runtime/engine/test/themes.test.mjs`

**Interfaces:**
- Consumes: `capabilities.execute(task)` → `TaskResult` with route JSON in `.summary` (same seam as `intake.mjs:31`).
- Produces:
  - `gatherParkingSurface(backlog): { orphans, leftoversEpics, leftoversMembers, existingThemes }`
  - `shapeThemeMutations({ clusters }): { mints, repoints }`
  - `spinOutLeftovers({ epicId, capturedMembers }): { leftoversEpic, repoints }`
  - `selectClusters({ orphans, leftoversMembers, existingThemes, capabilities }): Promise<{ clusters, rationale }>`
  - `themes({ backlog, capabilities }): Promise<{ mints, repoints, clusters, rationale }>`

- [ ] **Step 1: Write the failing test**

Create `runtime/engine/test/themes.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatherParkingSurface, shapeThemeMutations, spinOutLeftovers, themes } from '../lib/themes.mjs';

const backlog = [
  { id: 'o1', type: 'bug', status: 'parking' },
  { id: 'o2', type: 'bug', status: 'parking' },
  { id: 'active-x', type: 'feature', status: 'active' },
  { id: 'theme-a', type: 'epic', status: 'parking' },
  { id: 'old-leftovers', type: 'epic', status: 'parking' },
  { id: 'm1', type: 'bug', status: 'parking', epic: 'old-leftovers' },
];

test('gatherParkingSurface finds orphans, leftovers epics/members, and existing themes', () => {
  const g = gatherParkingSurface(backlog);
  assert.deepEqual(g.orphans.map((i) => i.id), ['o1', 'o2']);        // active + epic + leftovers-member excluded
  assert.deepEqual(g.leftoversEpics.map((i) => i.id), ['old-leftovers']);
  assert.deepEqual(g.leftoversMembers.map((i) => i.id), ['m1']);
  assert.deepEqual(g.existingThemes.map((i) => i.id), ['theme-a']);  // *-leftovers excluded from theme buckets
});

test('shapeThemeMutations mints an epic and repoints absorbed orphans as core', () => {
  const { mints, repoints } = shapeThemeMutations({ clusters: [
    { themeId: 'shared-cause', action: 'mint', absorbs: ['o1', 'o2'], rationale: 'r' },
  ] });
  assert.equal(mints.length, 1);
  assert.equal(mints[0].type, 'epic');
  assert.equal(mints[0].status, 'parking');
  assert.deepEqual(repoints, [
    { id: 'o1', epic: 'shared-cause', epic_role: 'core' },
    { id: 'o2', epic: 'shared-cause', epic_role: 'core' },
  ]);
});

test('shapeThemeMutations extend action repoints without minting', () => {
  const { mints, repoints } = shapeThemeMutations({ clusters: [
    { themeId: 'theme-a', action: 'extend', absorbs: ['o1'] },
  ] });
  assert.deepEqual(mints, []);
  assert.deepEqual(repoints, [{ id: 'o1', epic: 'theme-a', epic_role: 'core' }]);
});

test('spinOutLeftovers mints <epic>-leftovers and repoints captured members', () => {
  const { leftoversEpic, repoints } = spinOutLeftovers({ epicId: 'ep', capturedMembers: [{ id: 'c1' }, { id: 'c2' }] });
  assert.equal(leftoversEpic.id, 'ep-leftovers');
  assert.equal(leftoversEpic.type, 'epic');
  assert.deepEqual(repoints.map((r) => r.id), ['c1', 'c2']);
  assert.ok(repoints.every((r) => r.epic === 'ep-leftovers' && r.epic_role === 'core'));
});

test('spinOutLeftovers with no captured members is a no-op', () => {
  assert.deepEqual(spinOutLeftovers({ epicId: 'ep', capturedMembers: [] }), { leftoversEpic: null, repoints: [] });
});

test('themes() gathers, judges via the execute seam, and shapes mutations', async () => {
  const capabilities = { execute: async () => ({ taskId: 't', status: 'done',
    summary: JSON.stringify({ clusters: [{ themeId: 'shared-cause', action: 'mint', absorbs: ['o1', 'o2'] }] }) }) };
  const r = await themes({ backlog, capabilities });
  assert.equal(r.mints[0].id, 'shared-cause');
  assert.equal(r.repoints.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/themes.test.mjs`
Expected: FAIL — `Cannot find module '../lib/themes.mjs'`.

- [ ] **Step 3: Write the module**

Create `runtime/engine/lib/themes.mjs`:

```js
// runtime/engine/lib/themes.mjs — the cold-path clustering procedure + epic-close leftovers spin-out
// (spec §7 Hole #2). The all-vs-all sibling of intake.mjs's per-finding hot-path: selectClusters =
// JUDGMENT (seamed via capabilities.execute, same convention as selectRoute); gatherParkingSurface /
// shapeThemeMutations / spinOutLeftovers = PURE deterministic cores. Ring-1 produces abstract Item
// mutations; the frontmatter write is the adapter binding (run-themes.mjs).

const isEpic = (i) => i.type === 'epic';
const isLeftovers = (i) => isEpic(i) && i.id.endsWith('-leftovers');

/** Partition the parking lot into the surfaces a clustering pass reasons over. */
export function gatherParkingSurface(backlog) {
  const orphans = backlog.filter((i) => i.status === 'parking' && !isEpic(i) && !i.epic);
  const leftoversEpics = backlog.filter((i) => i.status === 'parking' && isLeftovers(i));
  const leftoversIds = new Set(leftoversEpics.map((e) => e.id));
  const leftoversMembers = backlog.filter((i) => i.epic && leftoversIds.has(i.epic));
  const existingThemes = backlog.filter((i) => i.status === 'parking' && isEpic(i) && !isLeftovers(i));
  return { orphans, leftoversEpics, leftoversMembers, existingThemes };
}

/** Pure: a judge's cluster decisions → abstract Item mutations (new theme epics + member repoints). */
export function shapeThemeMutations({ clusters }) {
  const mints = [], repoints = [];
  for (const c of clusters ?? []) {
    if (c.action === 'mint') {
      mints.push({
        id: c.themeId, type: 'epic', status: 'parking',
        done_when: c.doneWhen ?? `resolve the shared root cause across: ${(c.absorbs ?? []).join(', ')}`,
        scope: c.scope ?? '', out_of_scope: c.outOfScope ?? [],
      });
    }
    for (const id of c.absorbs ?? []) repoints.push({ id, epic: c.themeId, epic_role: 'core' });
  }
  return { mints, repoints };
}

/** Pure: the epic-close captured-audit — spin genuinely-orthogonal captured members into <epic>-leftovers. */
export function spinOutLeftovers({ epicId, capturedMembers }) {
  if (!capturedMembers.length) return { leftoversEpic: null, repoints: [] };
  const leftoversId = `${epicId}-leftovers`;
  const leftoversEpic = {
    id: leftoversId, type: 'epic', status: 'parking',
    done_when: `re-cluster the orthogonal members spun out of ${epicId}`, scope: '', out_of_scope: [],
  };
  const repoints = capturedMembers.map((m) => ({ id: m.id, epic: leftoversId, epic_role: 'core' }));
  return { leftoversEpic, repoints };
}

/** Judgment seam — mirrors intake.mjs selectRoute: build a Task, execute, JSON.parse the summary. */
export async function selectClusters({ orphans, leftoversMembers, existingThemes, capabilities }) {
  const items = [...orphans, ...leftoversMembers];
  const task = {
    id: `themes-${items.length}`,
    scope: ['docs/backlog/**'],
    prompt: `Cluster these parking-lot items by shared ROOT CAUSE (not symptom/service) per the backlog-themes skill. Clusters must have >=2 members; singletons stay orphans. You may EXTEND an existing theme epic instead of minting a new one. Return JSON {clusters:[{themeId, action:'mint'|'extend', doneWhen?, scope?, outOfScope?, absorbs:[ids], rationale}]}. Items: ${JSON.stringify(items.map((i) => ({ id: i.id, type: i.type, notes: i.notes })))}. Existing themes: ${JSON.stringify(existingThemes.map((e) => e.id))}.`,
    payload: { orphans, leftoversMembers, existingThemes },
  };
  const result = await capabilities.execute(task);
  const d = JSON.parse(result.summary);   // seam convention: decision as JSON in summary
  return { clusters: d.clusters ?? [], rationale: d.rationale ?? result.summary };
}

/** Top-level cold-path: gather → judge → shape. Returns abstract mutations; the adapter applies them. */
export async function themes({ backlog, capabilities }) {
  const { orphans, leftoversMembers, existingThemes } = gatherParkingSurface(backlog);
  const { clusters, rationale } = await selectClusters({ orphans, leftoversMembers, existingThemes, capabilities });
  return { ...shapeThemeMutations({ clusters }), clusters, rationale };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/themes.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/themes.mjs runtime/engine/test/themes.test.mjs
git commit --no-verify -m "feat(runtime): themes cold-path clustering + leftovers spin-out library (spec §7 Hole #2)"
git log --oneline -1
```

---

### Task 7: Hole #2 — `run-themes.mjs` adapter CLI (Deliverable D#2 wiring)

The ring-2 driver for the clustering cold-path, mirroring `run-intake.mjs`: gather the backlog via `readItems`, run the judgment through a journaled `execute` step, then apply the abstract mutations by writing new theme-epic files and repointing absorbed items' frontmatter. Reuses `writeItemFile` from `run-intake.mjs`.

**Files:**
- Create: `runtime/adapters/claude-code/run-themes.mjs`
- Test: `runtime/adapters/claude-code/test/run-themes.test.mjs`

**Interfaces:**
- Consumes: `themes` (Task 6); `writeItemFile` from `run-intake.mjs`; `readItems` from `scope-gate.mjs`; `makeClaudeCodeCapabilities`; the journal park/step contract.
- Produces: `applyThemeMutations({ backlogDir, mints, repoints }): string[]`; `driveThemes({ backlogDir, checksDir, fulfil, capabilities }): { exit, out }`.

- [ ] **Step 1: Write the failing test**

Create `runtime/adapters/claude-code/test/run-themes.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'yaml';
import { driveThemes, applyThemeMutations } from '../run-themes.mjs';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { makeAsk } from '../ask.mjs';
import { makeExecute } from '../execute.mjs';
import { makeFanOut } from '../fan-out.mjs';
import { makeOnTrigger } from '../on-trigger.mjs';
import { makeRunProcedure } from '../run-procedure.mjs';

function tmpBacklog() {
  const root = mkdtempSync(join(tmpdir(), 'nf-themes-'));
  const dir = join(root, 'backlog'); mkdirSync(dir);
  for (const id of ['o1', 'o2']) writeFileSync(join(dir, `${id}.md`), `---\nid: ${id}\ntype: bug\nstatus: parking\n---\n# ${id}\n`, 'utf8');
  const checks = join(root, 'checks'); mkdirSync(checks);
  return { root, dir, checks };
}
const caps = (j) => ({ journal: j, ask: makeAsk({}), execute: makeExecute({}), fanOut: makeFanOut({}), onTrigger: makeOnTrigger({}), runProcedure: makeRunProcedure({}) });

test('applyThemeMutations mints an epic file and repoints an orphan', () => {
  const { root, dir } = tmpBacklog();
  try {
    applyThemeMutations({ backlogDir: dir,
      mints: [{ id: 'shared-cause', type: 'epic', status: 'parking', done_when: 'x', scope: '', out_of_scope: [] }],
      repoints: [{ id: 'o1', epic: 'shared-cause', epic_role: 'core' }] });
    const epic = yaml.parse(readFileSync(join(dir, 'shared-cause.md'), 'utf8').split('---')[1]);
    assert.equal(epic.type, 'epic');
    const o1 = yaml.parse(readFileSync(join(dir, 'o1.md'), 'utf8').split('---')[1]);
    assert.equal(o1.epic, 'shared-cause');
    assert.equal(o1.epic_role, 'core');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('driveThemes parks on the judgment then applies on fulfil', async () => {
  const { root, dir, checks } = tmpBacklog();
  try {
    const j = inMemoryJournal();
    const first = await driveThemes({ backlogDir: dir, checksDir: checks, capabilities: caps(j) });
    assert.equal(first.exit, 3); // parked on execute
    const route = { clusters: [{ themeId: 'shared-cause', action: 'mint', absorbs: ['o1', 'o2'] }] };
    const second = await driveThemes({ backlogDir: dir, checksDir: checks, capabilities: caps(j),
      fulfil: { key: 'execute:themes-2', value: { taskId: 'themes-2', status: 'done', summary: JSON.stringify(route) } } });
    assert.equal(second.exit, 0);
    assert.ok(second.out.written.some((p) => p.endsWith('shared-cause.md')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/adapters/claude-code/test/run-themes.test.mjs`
Expected: FAIL — `Cannot find module '../run-themes.mjs'`.

- [ ] **Step 3: Write the driver**

Create `runtime/adapters/claude-code/run-themes.mjs`:

```js
#!/usr/bin/env node
// runtime/adapters/claude-code/run-themes.mjs — the cold-path THEMES driver (ring-2), the all-vs-all
// sibling of run-intake.mjs. Gathers the backlog, runs the clustering judgment through a journaled
// execute step (park/fulfil binding), then applies the abstract mutations: mint new theme-epic files +
// repoint absorbed items' frontmatter. Exit: 0 done / 3 parked / 1 failed / 2 usage.
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
import { themes } from '../../engine/lib/themes.mjs';
import { readItems } from '../../engine/lib/scope-gate.mjs';
import { pendingDecisions, gitHeadSha } from '../../engine/lib/journal.mjs';
import { recordRuntimePath } from '../../engine/lib/path-provenance.mjs';
import { writeItemFile } from './run-intake.mjs';
import { makeClaudeCodeCapabilities } from './index.mjs';

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
class ThemesParked extends Error {}

/** Apply abstract theme mutations to docs/backlog: mint epic files + repoint absorbed items. Returns paths. */
export function applyThemeMutations({ backlogDir, mints, repoints }) {
  const written = [];
  for (const epic of mints) written.push(writeItemFile({ backlogDir, item: epic, body: '' }));
  for (const rp of repoints) {
    const path = join(backlogDir, `${rp.id}.md`);
    const m = FM_RE.exec(readFileSync(path, 'utf8'));
    if (!m) throw new Error(`repoint target has no frontmatter: ${path}`);
    const front = yaml.parse(m[1]) ?? {};
    front.epic = rp.epic; front.epic_role = rp.epic_role;
    writeFileSync(path, `---\n${yaml.stringify(front).trimEnd()}\n---\n${m[2]}`);
    written.push(path);
  }
  return written;
}

export async function driveThemes({ backlogDir, checksDir, fulfil, capabilities }) {
  const runId = 'themes';
  const { journal } = capabilities;
  journal.begin(runId, { runId, auto: false });
  recordRuntimePath(journal, { runId, workstream: 'themes', sha: gitHeadSha() });
  if (fulfil) journal.fulfil(runId, fulfil.key, fulfil.value);
  let parked = null;
  const stepExecute = async (task) => {
    const r = await journal.step(runId, `execute:${task.id}`, () => capabilities.execute(task));
    if (r?.status === 'paused') { parked = r; throw new ThemesParked(); }
    return r;
  };
  let result;
  try {
    result = await themes({ backlog: readItems(backlogDir), capabilities: { ...capabilities, execute: stepExecute } });
  } catch (e) {
    if (e instanceof ThemesParked) return { exit: 3, out: { result: { status: 'paused', summary: parked.summary }, pending: pendingDecisions(journal.read(runId)) } };
    return { exit: 1, out: { error: e.message } };
  }
  const written = applyThemeMutations({ backlogDir, mints: result.mints, repoints: result.repoints });
  journal.record(runId, 'themes:applied', { mints: result.mints.map((m) => m.id), repoints: result.repoints.map((r) => r.id), files: written });
  return { exit: 0, out: { clusters: result.clusters, rationale: result.rationale, written } };
}

async function main() {
  const ff = process.argv.indexOf('--fulfil'); const vi = process.argv.indexOf('--value');
  const fv = ff >= 0 ? process.argv[ff + 1] : undefined; const vv = vi >= 0 ? process.argv[vi + 1] : undefined;
  const badPair = ff >= 0 && (fv === undefined || fv.startsWith('--') || vv === undefined || vv.startsWith('--'));
  if ((ff >= 0) !== (vi >= 0) || badPair) { console.error('usage: run-themes.mjs [--fulfil <key> --value <json>]'); process.exit(2); }
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const capabilities = makeClaudeCodeCapabilities({});
  const { exit, out } = await driveThemes({ backlogDir: cfg.backlogDir ?? 'docs/backlog', checksDir: cfg.checksDir,
    fulfil: ff >= 0 ? { key: fv, value: JSON.parse(vv) } : undefined, capabilities });
  console.log(JSON.stringify(out, null, 2));
  process.exit(exit);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/adapters/claude-code/test/run-themes.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add runtime/adapters/claude-code/run-themes.mjs runtime/adapters/claude-code/test/run-themes.test.mjs
git commit --no-verify -m "feat(runtime): run-themes.mjs cold-path driver — applies clustering mutations to docs/backlog (spec §7 Hole #2)"
git log --oneline -1
```

---

### Task 8: Hole #3 — dossier-sync side-car + shared dossier-IO extraction (Deliverable D#3) + spec path fix

Port the legacy `syncDossiers` regen (`topic_memory[]` → dossier `related_workstreams`, sorted, full-truth rewrite of every `project_*.md`) into a runtime reconcile pass, modeled on `reconcile-lesson.mjs`. First extract the shared frontmatter-IO helpers (`readDossier`/`writeDossierFile`) into `dossier-io.mjs` so both reconcilers share one implementation (DRY; reusability is the primary objective). Also fix the one stale path in the spec (`backward/reconcile-lesson.mjs` → `backward/lib/reconcile-lesson.mjs`).

**Files:**
- Create: `runtime/engine/backward/lib/dossier-io.mjs` (extracted `readDossier`, `writeDossierFile`)
- Modify: `runtime/engine/backward/lib/reconcile-lesson.mjs` (import the extracted helpers)
- Create: `runtime/engine/backward/lib/reconcile-dossiers.mjs`
- Modify: `docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md` (§7 Hole #3 path fix)
- Test: `runtime/engine/backward/test/reconcile-dossiers.test.mjs`
- Regression: `runtime/engine/backward/test/reconcile-lesson.test.mjs` must stay green (no changes).

**Interfaces:**
- Consumes: `yaml` `parse`/`stringify`; the shared `FM_RE`.
- Produces:
  - `dossier-io.mjs`: `readDossier(path): { front, body }`, `writeDossierFile(path, front, body): void`, `FM_RE`.
  - `reconcile-dossiers.mjs`: `reconcileDossiers({ items, memDir }): { updated: string[] }`.

- [ ] **Step 1: Write the failing reconcile-dossiers test**

Create `runtime/engine/backward/test/reconcile-dossiers.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { reconcileDossiers } from '../lib/reconcile-dossiers.mjs';

function tmpMem() {
  const dir = mkdtempSync(join(tmpdir(), 'nf-dossier-'));
  writeFileSync(join(dir, 'project_alpha.md'), '---\nname: Alpha\ntype: project\nrelated_workstreams:\n  - stale-ws\n---\nbody\n', 'utf8');
  writeFileSync(join(dir, 'project_beta.md'), '---\nname: Beta\ntype: project\n---\nbody\n', 'utf8');
  writeFileSync(join(dir, 'feedback_x.md'), '---\nname: fb\n---\nlesson\n', 'utf8'); // must be ignored
  return dir;
}

test('reconcileDossiers derives related_workstreams from item.topic_memory (sorted), clears stale, ignores feedback_*', () => {
  const dir = tmpMem();
  try {
    const items = [
      { id: 'ws-b', topic_memory: ['project_beta.md'] },
      { id: 'ws-a', topic_memory: ['project_beta.md'] },
      { id: 'ws-none', topic_memory: [] },
    ];
    reconcileDossiers({ items, memDir: dir });
    const beta = parse(readFileSync(join(dir, 'project_beta.md'), 'utf8').split('---')[1]);
    assert.deepEqual(beta.related_workstreams, ['ws-a', 'ws-b']); // sorted
    const alpha = parse(readFileSync(join(dir, 'project_alpha.md'), 'utf8').split('---')[1]);
    assert.deepEqual(alpha.related_workstreams, []); // stale 'stale-ws' cleared (no incoming pointer)
    const fb = readFileSync(join(dir, 'feedback_x.md'), 'utf8');
    assert.ok(!fb.includes('related_workstreams')); // feedback_* untouched
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/backward/test/reconcile-dossiers.test.mjs`
Expected: FAIL — `Cannot find module '../lib/reconcile-dossiers.mjs'`.

- [ ] **Step 3: Extract the shared dossier-IO helpers**

Create `runtime/engine/backward/lib/dossier-io.mjs`:

```js
// runtime/engine/backward/lib/dossier-io.mjs — the shared frontmatter read/write for memory dossiers
// (project_*.md workstream dossiers AND feedback_*.md lesson dossiers). Extracted from reconcile-lesson.mjs
// so every dossier reconciler shares one implementation. The FM_RE is the repo-wide frontmatter regex.
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';

export const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function readDossier(path) {
  const raw = readFileSync(path, 'utf8');
  const m = FM_RE.exec(raw);
  if (!m) throw new Error(`dossier has no YAML frontmatter: ${path}`);
  return { front: parse(m[1]) ?? {}, body: m[2] };
}

export function writeDossierFile(path, front, body) {
  writeFileSync(path, `---\n${stringify(front).trimEnd()}\n---\n${body}`, 'utf8');
}
```

- [ ] **Step 4: Refactor reconcile-lesson.mjs to import the extracted helpers**

In `runtime/engine/backward/lib/reconcile-lesson.mjs`, remove the local `FM_RE`, `readDossier`, and `writeDossierFile` (lines 10–20) and the now-unused `readFileSync`/`writeFileSync`/`parse`/`stringify` imports they needed, replacing with an import from `dossier-io.mjs`.

Change the top imports:
```js
import { readFileSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { parse, stringify } from 'yaml';
import { validateMintsEntry } from '../schema/mints-entry.ts';
import { fileURLToPath } from 'node:url';

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function readDossier(path) {
  const raw = readFileSync(path, 'utf8');
  const m = FM_RE.exec(raw);
  if (!m) throw new Error(`dossier has no YAML frontmatter: ${path}`);
  return { front: parse(m[1]) ?? {}, body: m[2] };
}
function writeDossierFile(path, front, body) {
  writeFileSync(path, `---\n${stringify(front).trimEnd()}\n---\n${body}`, 'utf8');
}
```
to:
```js
import { join, isAbsolute } from 'node:path';
import { validateMintsEntry } from '../schema/mints-entry.ts';
import { fileURLToPath } from 'node:url';
import { readDossier, writeDossierFile } from './dossier-io.mjs';
```

(The `new Date()` on line 26 stays — it needs no import. Leave everything from `export function reconcileLesson` onward unchanged.)

- [ ] **Step 5: Confirm the reconcile-lesson regression suite stays green**

Run: `node --test runtime/engine/backward/test/reconcile-lesson.test.mjs`
Expected: PASS (unchanged behavior — the extraction is a pure move).

- [ ] **Step 6: Write reconcile-dossiers.mjs**

Create `runtime/engine/backward/lib/reconcile-dossiers.mjs`:

```js
// runtime/engine/backward/lib/reconcile-dossiers.mjs — the topic_memory↔related_workstreams reconcile
// side-car (spec §7 Hole #3). The runtime analogue of legacy lint --fix's syncDossiers: derived-and-
// reconciled, never hand-edited (same contract reconcile-lesson.mjs cites in its header). Source of truth =
// each Item's topic_memory[] (dossier filenames); target = each project_*.md's related_workstreams (sorted
// item ids). Full-truth rewrite: every project_*.md is rewritten each run; zero incoming pointers → [].
// memDir is INJECTED (ring-1 purity — no hardcoded ~/.claude path), mirroring reconcile-lesson's dossierRoot.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readDossier, writeDossierFile } from './dossier-io.mjs';

export function reconcileDossiers({ items, memDir }) {
  // 1. dossier filename → [workstream ids], from each item's topic_memory[].
  const map = new Map();
  for (const item of items) {
    for (const dossierFile of item.topic_memory ?? []) {
      if (!map.has(dossierFile)) map.set(dossierFile, []);
      map.get(dossierFile).push(item.id);
    }
  }
  if (!existsSync(memDir)) return { updated: [] };
  // 2. Rewrite every project_*.md with the current truth (empty clears stale). feedback_* untouched.
  const updated = [];
  for (const file of readdirSync(memDir).filter((f) => f.startsWith('project_') && f.endsWith('.md'))) {
    const path = join(memDir, file);
    const { front, body } = readDossier(path);
    front.related_workstreams = [...(map.get(file) ?? [])].sort();
    writeDossierFile(path, front, body);
    updated.push(file);
  }
  // 3. Warn about pointers targeting a missing dossier (parity with legacy behavior — warn, don't crash).
  for (const [dossierFile, workstreams] of map) {
    if (!existsSync(join(memDir, dossierFile))) console.warn(`[reconcile-dossiers] target missing: ${dossierFile} (referenced by ${workstreams.join(', ')})`);
  }
  return { updated };
}
```

- [ ] **Step 7: Run the reconcile-dossiers test to verify it passes**

Run: `node --test runtime/engine/backward/test/reconcile-dossiers.test.mjs`
Expected: PASS.

- [ ] **Step 8: Fix the stale spec path**

In `docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md` §7 Hole #3 (line 82), change:
```
The backward edge already implements the *parallel* `mints:` reciprocal (`runtime/engine/backward/reconcile-lesson.mjs`) — that is the template.
```
to:
```
The backward edge already implements the *parallel* `mints:` reciprocal (`runtime/engine/backward/lib/reconcile-lesson.mjs`) — that is the template.
```

- [ ] **Step 9: Commit**

```bash
git add runtime/engine/backward/lib/dossier-io.mjs runtime/engine/backward/lib/reconcile-lesson.mjs runtime/engine/backward/lib/reconcile-dossiers.mjs runtime/engine/backward/test/reconcile-dossiers.test.mjs docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
git commit --no-verify -m "feat(runtime): dossier-sync reconcile side-car + shared dossier-io extraction (spec §7 Hole #3); fix spec reconcile-lesson path"
git log --oneline -1
```

---

## Whole-workstream verification (closing phase)

Not a task — this is the closing-phase gate (`/backlog-next` Step 6). Run after all 8 tasks:

- [ ] **Full runtime suite:** `node --test runtime/engine/test/*.test.mjs runtime/engine/backward/test/*.test.mjs runtime/engine/loop/test/*.test.mjs runtime/adapters/**/test/*.test.mjs runtime/eval/test/*.test.mjs runtime/eval/e2e/*.test.mjs runtime/content/test/*.test.mjs` — all green (includes the greenfield adoption e2e).
- [ ] **Full oracle suite:** `node --test scripts/parity-oracle/test/*.test.mjs` — all green.
- [ ] **Deterministic acceptance:** `node scripts/parity-oracle/soak-observer.mjs` runs and prints a verdict (non-green this early is correct — no runtime workstreams have soaked yet).
- [ ] **Cost-gated live oracle sweep (RECOMMENDED, surface via AskUserQuestion per the cost-conscious rule):** `node scripts/parity-oracle/run.mjs parity` — proves the 11 mapped scenarios still dominate *with* the new `path:runtime` assertion (i.e., Task 2's emission drives them end-to-end). This is a live-LLM spend; gate it. If skipped, note in the validation gate that the deterministic layers passed and the live proof is deferred to the first per-skill workstream's ship.

## Self-Review

- **Spec coverage:** §4 → Tasks 1–2. §5 → Task 4. §6 → Task 3. §7 Hole #1 → Task 5; Hole #2 → Tasks 6–7; Hole #3 → Task 8. §9.1 (this member = Sections A–D) → all tasks. Spec path fix → Task 8. Out-of-scope items (per-skill re-platform WS-1..4, legacy deletion, orchestrator leftovers wiring) are deliberately excluded and noted where they abut a deliverable.
- **Type/name consistency:** `RUNTIME_PATH_KEY`/`recordRuntimePath`/`isRuntimePathRecord`/`FALLBACK_RUN_ID` defined in Task 1 are consumed verbatim in Tasks 2, 3, 4, 7. `AGENT_OBSERVED` defined in Task 5 schema, consumed in Task 5 intake. `writeItemFile` (existing, `run-intake.mjs`) consumed in Task 7. `readDossier`/`writeDossierFile` defined in Task 8 `dossier-io.mjs`, consumed by both reconcilers.
- **Ring discipline:** every ring-1 module (`path-provenance`, `themes`, `reconcile-dossiers`) takes journal / capabilities / memDir injected; every `process.env`/`argv`/write lives in a ring-2 adapter (`run-item`, `run-intake`, `run-themes`, `soak-observer` CLI `main`).
