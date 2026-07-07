# Runtime-replatform-add (WS-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-platform the legacy `backlog-add` skill onto the runtime engine's intake seam by giving the route-classification judge deterministic, pre-computed context and wiring the doc-store side-car + `RUNTIME_ENGINE` flag branch.

**Architecture:** A new pure ring-1 module (`intake-context.mjs`) computes the intake decision context (active epic + `done_when`/`scope`, parking theme epics, parking orphans) from the already-read item store and renders the judge prompt. `selectRoute` (`intake.mjs`) injects that context into the judgment seam. The adapter (`run-intake.mjs`) gains the `lint --fix` index-regen side-car. The `backlog-add` SKILL.md gains a `RUNTIME_ENGINE` branch that routes to `run-intake.mjs` when the flag is on, keeping the legacy prose intact for the flag-off path.

**Tech Stack:** Node.js ESM, `node:test`, `zod` (via existing schemas), `yaml`. No new dependencies.

## Global Constraints

- **Ring-1 purity:** `runtime/engine/lib/*` modules are pure and project-agnostic — no `fs`/network/`process`; all I/O and env injected. Only `runtime/adapters/*` performs I/O. `intake-context.mjs` is ring-1 (pure); the side-car + flag live in the adapter / SKILL.md.
- **Test harness:** `node:test`, one test file per module under the module's sibling `test/` dir (`runtime/engine/test/`, `runtime/adapters/claude-code/test/`, `.claude/skills/backlog-add/test/`). Run individually with `node --test <file>`.
- **Legacy retained:** the `backlog-add` prose router stays **byte-for-byte** intact behind the flag-off branch (no-cleanup-during-migration; legacy deletion is P6, user-triggered).
- **Flag reads:** `RUNTIME_ENGINE` is read only via `usesRuntimeEngine(process.env)` (`runtime/engine/lib/path-provenance.mjs:13`) — never a bespoke `process.env.RUNTIME_ENGINE` check.
- **Worktree commits:** this runs in the worktree `.claude/worktrees/runtime-replatform-add` (branch `worktree-runtime-replatform-add`). Commit with `git commit --no-verify` (the pre-commit hook rejects worktree code commits) and verify each commit landed with `git log --oneline -1`.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **P5 scope boundary:** WS-1 makes the **7 already-mapped** `rt-add-*` scenarios dominant; it does NOT map `add-id-collision-suffix` or `add-notes-scalar` (they stay `unmapped:'P5'` per `scripts/parity-oracle/mapping.mjs:27,30`).

---

### Task 1: `intake-context.mjs` — the deterministic context-loader + prompt renderer

**Files:**
- Create: `runtime/engine/lib/intake-context.mjs`
- Test: `runtime/engine/test/intake-context.test.mjs`

**Interfaces:**
- Consumes: the `backlog` array (items as returned by `readItems` — validated frontmatter objects with `id`, `status`, `type`, `epic?`, `done_when?`, `scope?`, `out_of_scope?`, `notes?`); the `finding` object (`{id, check?, kind, scope, detail, raised_at}`).
- Produces:
  - `loadIntakeContext({ backlog }) -> { activeEpic: {id, done_when, scope, out_of_scope} | null, themeEpics: [{id, notes, scope, done_when}], orphans: [{id, notes}] }`
  - `renderIntakePrompt({ finding, context }) -> string`

- [ ] **Step 1: Write the failing tests**

Create `runtime/engine/test/intake-context.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadIntakeContext, renderIntakePrompt } from '../lib/intake-context.mjs';

const finding = { id: 'f1', check: 'no-x', kind: 'inconsistency', scope: ['a/b.ts'], detail: 'broke', raised_at: 't' };

test('loadIntakeContext surfaces the active epic with done_when/scope/out_of_scope', () => {
  const backlog = [
    { id: 'acme-epic', status: 'active', type: 'epic', done_when: 'acme redesigned', scope: 'src/acme/**', out_of_scope: ['x'] },
    { id: 'other', status: 'queued', type: 'bug' },
  ];
  const ctx = loadIntakeContext({ backlog });
  assert.equal(ctx.activeEpic.id, 'acme-epic');
  assert.equal(ctx.activeEpic.done_when, 'acme redesigned');
  assert.equal(ctx.activeEpic.scope, 'src/acme/**');
  assert.deepEqual(ctx.activeEpic.out_of_scope, ['x']);
});

test('loadIntakeContext returns null activeEpic when no epic is active (an active non-epic is not it)', () => {
  const backlog = [{ id: 'exec', status: 'active', type: 'refactor' }];
  const ctx = loadIntakeContext({ backlog });
  assert.equal(ctx.activeEpic, null);
});

test('loadIntakeContext lists parking theme epics and parking orphans, excluding members and non-parking', () => {
  const backlog = [
    { id: 'theme-a', status: 'parking', type: 'epic', notes: 'root cause A' },
    { id: 'orphan-1', status: 'parking', type: 'bug', notes: 'lonely bug' },
    { id: 'member-1', status: 'parking', type: 'bug', notes: 'in an epic', epic: 'theme-a' },
    { id: 'shipped-1', status: 'shipped', type: 'bug', notes: 'done' },
  ];
  const ctx = loadIntakeContext({ backlog });
  assert.deepEqual(ctx.themeEpics.map((t) => t.id), ['theme-a']);
  assert.deepEqual(ctx.orphans.map((o) => o.id), ['orphan-1']); // member-1 (has epic:) + shipped-1 excluded
});

test('renderIntakePrompt embeds the finding, the active-epic done_when, and the closure-predicate instruction', () => {
  const context = loadIntakeContext({ backlog: [
    { id: 'acme-epic', status: 'active', type: 'epic', done_when: 'acme redesigned', scope: 's', out_of_scope: [] },
  ] });
  const p = renderIntakePrompt({ finding, context });
  assert.match(p, /broke/);            // finding detail
  assert.match(p, /acme-epic/);
  assert.match(p, /acme redesigned/);  // done_when reaches the judge
  assert.match(p, /closure-predicate/i);
});

test('renderIntakePrompt states fold is unavailable when there is no active epic', () => {
  const context = loadIntakeContext({ backlog: [] });
  const p = renderIntakePrompt({ finding, context });
  assert.match(p, /ACTIVE EPIC: none/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test runtime/engine/test/intake-context.test.mjs`
Expected: FAIL — `Cannot find module '../lib/intake-context.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `runtime/engine/lib/intake-context.mjs`:

```js
// runtime/engine/lib/intake-context.mjs — ring-1, pure. The deterministic context-loader feeding the
// intake judgment seam (WS-1 design §3, decision D-A). Legacy backlog-add greps the active epic + reads
// its done_when/scope + runs the closure-predicate before classifying; this module computes that context
// deterministically from the already-read item store so the judge decides on pre-computed facts instead
// of grepping. No I/O — `backlog` is the readItems() array (injected). readItems exposes frontmatter only,
// so the root-cause signal for theme epics / orphans is the `notes:` field.

/** Deterministic decision context for a finding: the active epic (for fold + the closure-predicate), the
 *  parking theme epics (for join-theme), and the parking orphans (for mint-aggregation). Pure. */
export function loadIntakeContext({ backlog }) {
  // The active epic = the single active type:epic (single-active law; cf. activePartition in scope-gate.mjs).
  const active = backlog.find((i) => i.status === 'active' && i.type === 'epic') ?? null;
  const activeEpic = active
    ? { id: active.id, done_when: active.done_when ?? null, scope: active.scope ?? null, out_of_scope: active.out_of_scope ?? [] }
    : null;
  const themeEpics = backlog
    .filter((i) => i.status === 'parking' && i.type === 'epic')
    .map((i) => ({ id: i.id, notes: i.notes ?? '', scope: i.scope ?? null, done_when: i.done_when ?? null }));
  const orphans = backlog
    .filter((i) => i.status === 'parking' && i.type !== 'epic' && !i.epic)
    .map((i) => ({ id: i.id, notes: i.notes ?? '' }));
  return { activeEpic, themeEpics, orphans };
}

/** Render the route-classification prompt for the judgment seam, embedding the deterministic context so
 *  the judge runs the closure-predicate (core vs captured) and root-cause matching without grepping. */
export function renderIntakePrompt({ finding, context }) {
  const { activeEpic, themeEpics, orphans } = context;
  const epicBlock = activeEpic
    ? `ACTIVE EPIC "${activeEpic.id}":\n  done_when: ${JSON.stringify(activeEpic.done_when)}\n  scope: ${JSON.stringify(activeEpic.scope)}\n  out_of_scope: ${JSON.stringify(activeEpic.out_of_scope)}\n  Closure-predicate test: epicRole="core" if leaving this finding undone would make a done_when clause literally false (everything in scope qualifies, plus anything else done_when requires); epicRole="captured" only if genuinely orthogonal to done_when. When unsure, choose "core".`
    : 'ACTIVE EPIC: none (the "fold" route is unavailable — there is no active epic to fold into).';
  const themeBlock = themeEpics.length
    ? `PARKING THEME EPICS (for "join-theme" by shared root cause):\n${themeEpics.map((t) => `  - ${t.id}: ${t.notes}`).join('\n')}`
    : 'PARKING THEME EPICS: none.';
  const orphanBlock = orphans.length
    ? `PARKING ORPHANS (for "mint-aggregation" by shared root cause):\n${orphans.map((o) => `  - ${o.id}: ${o.notes}`).join('\n')}`
    : 'PARKING ORPHANS: none.';
  return [
    'Classify this finding into a route (fold|join-theme|mint-aggregation|orphan|split|discard) per the backlog-add epic-aware router.',
    `FINDING: ${finding.detail}`,
    `FINDING SCOPE: ${JSON.stringify(finding.scope)}`,
    epicBlock,
    themeBlock,
    orphanBlock,
    'Return JSON {route, epic?, epicRole?, splitInto?, rationale}. fold → epic=the active epic id + epicRole per the closure-predicate. join-theme → epic=the matching theme epic id. mint-aggregation → epic=a NEW aggregation epic id and name the clustered orphans in rationale. split → splitInto=[suffixes]. orphan/discard → omit epic.',
  ].join('\n\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test runtime/engine/test/intake-context.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/intake-context.mjs runtime/engine/test/intake-context.test.mjs
git commit --no-verify -m "$(cat <<'EOF'
feat(runtime): intake-context deterministic loader + prompt renderer (WS-1)

Pure ring-1 module computing the intake decision context (active epic +
done_when/scope, parking theme epics, parking orphans) and rendering the
judge prompt with the closure-predicate embedded.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
git log --oneline -1
```

---

### Task 2: Enrich `selectRoute` to inject the deterministic context

**Files:**
- Modify: `runtime/engine/lib/intake.mjs:34-41` (the `selectRoute` function)
- Test: `runtime/engine/test/intake.test.mjs` (add one test; the export list of the module under test grows to include `selectRoute`)

**Interfaces:**
- Consumes: `loadIntakeContext`, `renderIntakePrompt` from Task 1.
- Produces: `selectRoute` unchanged signature `({finding, backlog, capabilities}) -> {route, epic, epicRole, splitInto, rationale}`; it now builds the judge `task` from the rendered prompt + a `payload.context`.

- [ ] **Step 1: Write the failing test**

Add to `runtime/engine/test/intake.test.mjs`. First update the import on line 3 to include `selectRoute`:

```js
import { intake, shapeItems, selectRoute } from '../lib/intake.mjs';
```

Then append this test:

```js
test('D7: selectRoute injects the active-epic done_when + context into the judge task', async () => {
  const backlog = [{ id: 'acme-epic', status: 'active', type: 'epic', done_when: 'acme redesigned', scope: 's', out_of_scope: [] }];
  let seen;
  const caps = { execute: async (task) => { seen = task; return { taskId: task.id, status: 'done', summary: JSON.stringify({ route: 'fold', epic: 'acme-epic', epicRole: 'core' }) }; } };
  const d = await selectRoute({ finding, backlog, capabilities: caps });
  assert.match(seen.prompt, /acme redesigned/);            // done_when reaches the judge prompt
  assert.equal(seen.payload.context.activeEpic.id, 'acme-epic');
  assert.equal(d.route, 'fold');
  assert.equal(d.epicRole, 'core');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test runtime/engine/test/intake.test.mjs`
Expected: FAIL on D7 — `seen.prompt` does not contain "acme redesigned" (the current thin prompt at `intake.mjs:36` only carries `finding.detail`), and `seen.payload.context` is undefined. D1–D6 still PASS.

- [ ] **Step 3: Write the implementation**

In `runtime/engine/lib/intake.mjs`, add the import after the existing `AGENT_OBSERVED` import (line 5):

```js
import { loadIntakeContext, renderIntakePrompt } from './intake-context.mjs';
```

Replace the `selectRoute` function (lines 34-41) with:

```js
export async function selectRoute({ finding, backlog, capabilities }) {
  const context = loadIntakeContext({ backlog });
  const task = { id: `intake-${finding.id}`, scope: finding.scope,
    prompt: renderIntakePrompt({ finding, context }),
    payload: { finding, backlog, context } };
  const result = await capabilities.execute(task);
  const d = JSON.parse(result.summary);   // seam convention: route decision as JSON in summary
  return { route: d.route, epic: d.epic, epicRole: d.epicRole, splitInto: d.splitInto, rationale: d.rationale ?? result.summary };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test runtime/engine/test/intake.test.mjs`
Expected: PASS (D1–D7, 7 tests). D1–D6 remain green because they pass `backlog: []` (⇒ `activeEpic: null`, empty theme/orphan blocks) and their `fakeCaps` ignores the task.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/intake.mjs runtime/engine/test/intake.test.mjs
git commit --no-verify -m "$(cat <<'EOF'
feat(runtime): selectRoute injects deterministic intake context into the judge (WS-1)

The route-classification seam now embeds the active epic + done_when/scope,
parking theme epics, and parking orphans via renderIntakePrompt, so the judge
runs the closure-predicate without grepping. shapeItems core untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
git log --oneline -1
```

---

### Task 3: Wire the `lint --fix` index-regen side-car in `run-intake.mjs`

**Files:**
- Modify: `runtime/adapters/claude-code/run-intake.mjs` (imports; add `regenBacklogIndex`; `driveIntake` gains `regenIndex` param + calls it after the write loop)
- Test: `runtime/adapters/claude-code/test/run-intake.test.mjs` (inject a no-op `regenIndex` into the two existing completion tests; add three new tests)

**Interfaces:**
- Consumes: nothing new (uses `node:child_process` `execFileSync`, `node:fs` `existsSync`).
- Produces: `regenBacklogIndex()` (exported); `driveIntake({..., regenIndex = regenBacklogIndex})` — after writing item files it calls `regenIndex()` once when `written.length > 0`, mapping a throw to `{exit:1}`.

- [ ] **Step 1: Update the two existing completion tests to inject a no-op side-car (keeps them hermetic)**

In `runtime/adapters/claude-code/test/run-intake.test.mjs`, the two tests that reach exit 0 (the "fulfilled route JSON" test and the "path:runtime provenance" test) must inject `regenIndex: () => {}` on the **fulfilling** `driveIntake` call so the real side-car does not shell out against the repo. 

In the test `'fulfilled route JSON → items written with epic/epic_role; journal filed record (exit 0)'`, change the second `driveIntake` call (the one with `fulfil:`) to add `regenIndex: () => {}`:

```js
  const r2 = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: taskResult }, capabilities: c, regenIndex: () => {} });
```

In the test `'a driven intake journals a path:runtime provenance record'`, change the second `driveIntake` call likewise:

```js
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: { taskId: 'intake-f1', status: 'done', summary: JSON.stringify({ route: 'orphan' }) } }, capabilities: c, regenIndex: () => {} });
```

- [ ] **Step 2: Write the failing tests**

Append to `runtime/adapters/claude-code/test/run-intake.test.mjs`:

```js
test('after writing items, the lint --fix index-regen side-car runs once', async () => {
  const dir = tmpStore();
  const c = caps();
  let calls = 0;
  const regenIndex = () => { calls += 1; };
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: c, regenIndex });
  const r2 = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: { taskId: 'intake-f1', status: 'done', summary: JSON.stringify({ route: 'orphan' }) } }, capabilities: c, regenIndex });
  assert.equal(r2.exit, 0, JSON.stringify(r2.out));
  assert.equal(calls, 1);
});

test('a discard route writes nothing, so the side-car does NOT run', async () => {
  const dir = tmpStore();
  const c = caps();
  let calls = 0;
  const regenIndex = () => { calls += 1; };
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: c, regenIndex });
  const r2 = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: { taskId: 'intake-f1', status: 'done', summary: JSON.stringify({ route: 'discard' }) } }, capabilities: c, regenIndex });
  assert.equal(r2.exit, 0);
  assert.equal(calls, 0);
});

test('a side-car failure surfaces as exit 1 (not swallowed)', async () => {
  const dir = tmpStore();
  const c = caps();
  const regenIndex = () => { throw new Error('lint rule 9 violated'); };
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: c, regenIndex });
  const r2 = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: { taskId: 'intake-f1', status: 'done', summary: JSON.stringify({ route: 'orphan' }) } }, capabilities: c, regenIndex });
  assert.equal(r2.exit, 1);
  assert.match(String(r2.out.error), /lint rule 9/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test runtime/adapters/claude-code/test/run-intake.test.mjs`
Expected: FAIL — `driveIntake` does not yet accept `regenIndex`, so the side-car spy is never called (`calls` stays 0 in the "runs once" test) and the throwing spy never fires (exit stays 0 in the "exit 1" test).

- [ ] **Step 4: Write the implementation**

In `runtime/adapters/claude-code/run-intake.mjs`, update the two import lines (9-10 region):

```js
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
```

Add `regenBacklogIndex` immediately after the `writeItemFile` function (after line 28):

```js
/** The lint --fix index-regen side-car (backlog-add/SKILL.md:65): regenerate docs/BACKLOG.md +
 *  dossier related_workstreams. Doc-store materialization stays a skill/adapter side-car (spec §2).
 *  A missing skill script (e.g. the parity sandbox) is a no-op; a real lint-rule failure is fatal. */
export function regenBacklogIndex() {
  const lintScript = '.claude/skills/backlog-lint/lint.mjs';
  if (!existsSync(lintScript)) return;
  try { execFileSync('node', [lintScript, '--fix'], { stdio: 'pipe' }); }
  catch (e) { throw new Error(`backlog-lint --fix failed: ${e.stdout?.toString().trim() || e.message}`); }
}
```

Update the `driveIntake` signature and the write-loop tail. Change the signature line:

```js
export async function driveIntake({ finding, backlogDir, checksDir, fulfil, capabilities, regenIndex = regenBacklogIndex }) {
```

Replace the current tail (lines 51-53):

```js
  const written = result.items.map((item) => writeItemFile({ backlogDir, item, body: finding.detail }));
  journal.record(runId, `intake:${finding.id}:filed`, { route: result.route, files: written });
  if (written.length > 0) {
    try { regenIndex(); }
    catch (e) { return { exit: 1, out: { error: e.message, written } }; }
  }
  return { exit: 0, out: { route: result.route, rationale: result.rationale, written } };
```

(The production `main()` needs no change — it calls `driveIntake` without `regenIndex`, so it gets the real `regenBacklogIndex` default.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test runtime/adapters/claude-code/test/run-intake.test.mjs`
Expected: PASS (7 tests — the 4 original, now hermetic, plus the 3 new side-car tests).

- [ ] **Step 6: Commit**

```bash
git add runtime/adapters/claude-code/run-intake.mjs runtime/adapters/claude-code/test/run-intake.test.mjs
git commit --no-verify -m "$(cat <<'EOF'
feat(runtime): run-intake lint --fix index-regen side-car (WS-1)

After writing the shaped item file(s), driveIntake runs the backlog-lint --fix
side-car once (injected regenIndex; real default shells the skill, no-op when
the skill script is absent e.g. the parity sandbox). A side-car failure is
fatal (exit 1), never swallowed; a discard route writes nothing and skips it.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
git log --oneline -1
```

---

### Task 4: `RUNTIME_ENGINE` flag branch in `backlog-add/SKILL.md`

**Files:**
- Modify: `.claude/skills/backlog-add/SKILL.md` (insert a "Runtime engine path" section between "## What this skill does" and "## The hot-path router"; leave the legacy prose intact)
- Create: `.claude/skills/backlog-add/test/runtime-flag.test.mjs`

**Interfaces:**
- Consumes: nothing (documentation + a grep regression gate).
- Produces: the toggle-site documentation for the runtime path; the flag mechanism itself is `usesRuntimeEngine` (already tested in `path-provenance.test.mjs`).

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/backlog-add/test/runtime-flag.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const skillMd = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'SKILL.md'), 'utf8');

test('SKILL.md documents the RUNTIME_ENGINE runtime-engine intake branch', () => {
  assert.match(skillMd, /RUNTIME_ENGINE/);
  assert.match(skillMd, /run-intake\.mjs --finding/);
  assert.match(skillMd, /path:legacy-fallback/); // hard-cutover semantics documented
});

test('SKILL.md retains the legacy prose router (kept byte-for-byte until P6)', () => {
  assert.match(skillMd, /The hot-path router/);
  assert.match(skillMd, /closure-predicate test/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/backlog-add/test/runtime-flag.test.mjs`
Expected: FAIL on the first test — SKILL.md has no `RUNTIME_ENGINE` / `run-intake.mjs` / `path:legacy-fallback` text yet. The second test PASSES (legacy prose already present).

- [ ] **Step 3: Write the implementation**

In `.claude/skills/backlog-add/SKILL.md`, insert this section immediately after the "## What this skill does" block (before "## The hot-path router (decide cheaply, then write)"):

```markdown
## Runtime engine path (`RUNTIME_ENGINE`)

When `RUNTIME_ENGINE` is set (read via `usesRuntimeEngine(process.env)` — `runtime/engine/lib/path-provenance.mjs:13`), the **runtime engine drives intake** instead of the prose router below. Hard cutover — on a runtime-path failure, pause at the floor; do **not** silently fall back to the prose path (a deliberate legacy fallback is a human act that journals `path:legacy-fallback`).

1. Write the finding as JSON — the Finding shape `{id, check?, kind, scope, detail, raised_at}`. Omit `check` (or set the reserved `agent-observed` sentinel) for an agent-observed side-finding with no originating check.
2. Run `node runtime/adapters/claude-code/run-intake.mjs --finding <finding.json>`. It **parks** (exit 3) on the route-classification judgment with a pending key `execute:intake-<finding-id>`; the pre-computed decision context (active epic + `done_when`/`scope`, parking theme epics, parking orphans) is embedded in the parked task. Answer with the route JSON via `--fulfil execute:intake-<finding-id> --value '{"taskId":"intake-<id>","status":"done","summary":"{\"route\":\"…\",\"epic\":\"…\",\"epicRole\":\"…\"}"}'`.
3. On exit 0 the driver has written the item file(s), regenerated `docs/BACKLOG.md` (the `lint --fix` side-car), and journaled `path:runtime` + `intake:<id>:filed`. Then **commit** the written file(s) with the route-correct `docs(backlog):` message, staging ONLY the touched files.

When `RUNTIME_ENGINE` is unset, follow the legacy prose procedure below (retained byte-for-byte until P6 legacy retirement).
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/backlog-add/test/runtime-flag.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-add/SKILL.md .claude/skills/backlog-add/test/runtime-flag.test.mjs
git commit --no-verify -m "$(cat <<'EOF'
feat(runtime): RUNTIME_ENGINE toggle site in backlog-add SKILL.md (WS-1)

Documents the runtime intake path (run-intake.mjs --finding, park/fulfil,
side-car, path:runtime) behind the RUNTIME_ENGINE flag with hard-cutover
semantics; legacy prose router retained byte-for-byte for the flag-off path.
Grep regression test guards both branches.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
git log --oneline -1
```

---

### Task 5: Full-suite verification + parity acceptance

**Files:** none modified — verification only.

**Interfaces:** Consumes all prior tasks.

- [ ] **Step 1: Run the runtime engine + adapter test suites**

Run:
```bash
node --test runtime/engine/test/*.test.mjs runtime/adapters/**/test/*.test.mjs
```
Expected: all PASS (includes the new `intake-context` tests, the enriched `intake` D7, the new `run-intake` side-car tests, and the untouched provenance/schema tests).

- [ ] **Step 2: Run the backlog-add skill test**

Run: `node --test .claude/skills/backlog-add/test/*.test.mjs`
Expected: PASS (the flag-branch grep gate).

- [ ] **Step 3: Run the parity-oracle structural tests (no live LLM)**

Run: `node --test scripts/parity-oracle/test/*.test.mjs`
Expected: PASS — in particular `mapping.test.mjs` (totality + `mapped.length === 11`), `scenarios-lint.test.mjs` (the 7 `rt-add-*` remain structurally valid, `driver:'intake'`), and `runtime-grade.test.mjs` (the `path:runtime` hollow-green guard). No mapping changes are made in this plan, so these stay green.

- [ ] **Step 4: Typecheck + lint the affected runtime project**

Run:
```bash
NX_DAEMON=false pnpm nx run-many -t typecheck,lint -p runtime
```
Expected: PASS. (If the worktree lacks a symlinked `node_modules`, create it first: `ln -sfn <main-repo>/node_modules node_modules`.)

- [ ] **Step 5: Live parity sweep (COST-GATED — deferred to the closing phase)**

The behavioral acceptance — the 7 mapped `rt-add-*` scenarios going **dominant** — requires a live-LLM A/B oracle sweep (`node scripts/parity-oracle/run.mjs parity`), which spends real tokens across ~14 headless sessions. **Do NOT run it inline.** It is gated in the `/backlog-next` closing phase (Step 6.4) via AskUserQuestion (cost-conscious), scoped to the `rt-add-*` pairs. A scenario is accepted when `pairVerdict` reports `dominant` and its `path:runtime` journal record is present (`runtime-grade.mjs:21`). Record the sweep report path (gitignored `benchmarks/`-style output) in the workstream's `validation_gate`.

---

## Notes for the executor

- **No mapping edits.** `scripts/parity-oracle/mapping.mjs` already maps the 7 `rt-add-*`. Do not touch it; do not promote `add-id-collision-suffix` / `add-notes-scalar` out of P5 (out of scope — WS-1 design §5).
- **The operator commits, not the adapter.** `rt-add-commit-scope` asserts commit discipline performed by the driving session (per its operator prompt), not by `run-intake.mjs`. Do not add git-commit logic to the adapter.
- **Legacy prose is load-bearing during soak.** Never delete or restructure the `backlog-add` prose router — the flag-off path and future fallbacks depend on it byte-for-byte.
