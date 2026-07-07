# WS-4 — re-platform `backlog-next-epic` onto `runOrchestrator` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin `run-epic.mjs` CLI driver over the already-live `runOrchestrator` spine so the `RUNTIME_ENGINE` flag routes the `backlog-next-epic` epic drive through the runtime loop, with the legacy skill body retained byte-for-byte when the flag is off.

**Architecture:** Mirror the WS-3 worker adapter (`run-next.mjs` + `next-driver.mjs`) at the epic layer. A new content helper (`runtime/content/lib/epic-members.mjs`) does Nestfolio member-selection + the rule-11 single-active-epic surface (kept out of ring-1 by the import boundary, injected by the adapter). The adapter `run-epic.mjs` loads the epic + its members, guards rule-11, and calls `runOrchestrator({ epic, members, capabilities, registry, headSha, auto })` (member-selection / rule-11 / e2e-freshness wrapped; the gh-PR-state probe and worktree-ops binding are **deferred** per spec §8/§10). A flag decision-site (`epic-driver.mjs`) mirrors `next-driver.mjs`. The parity oracle gains the spine-expressible `bne-*` twins; the deferred/host-side ids stay `P5` with honest reasons.

**Tech Stack:** Node ESM (`.mjs`), `node:test`, `zod`/`yaml` (already vendored), the runtime engine spine (`runtime/engine/loop/orchestrator.mjs`), the parity oracle (`scripts/parity-oracle/`).

## Global Constraints

- **Ring-1 purity (import-boundary test, `runtime/engine/test/import-boundary.test.mjs`):** `runtime/engine/**` imports NO adapter, NO `.claude/skills/`, NO `runtime/content/**`, never shells `claude`. Member-selection is Nestfolio content → it lives in `runtime/content/lib/` and is imported by the **adapter** (`run-epic.mjs`), never by the engine. Dependency direction is `content → engine` only.
- **Strangler / byte-for-byte legacy:** flag **off** → the legacy `backlog-next-epic/SKILL.md` body runs unchanged (retained until P6). The flag decision lives in exactly ONE place (`epic-driver.mjs`), mirroring `next-driver.mjs` and `backlog-gate.mjs`.
- **Exit codes (all runtime drivers):** `0` done / `3` paused / `1` failed / `2` usage/precondition.
- **`headSha` is a param, never a capability** (orchestrator test O-C): the driver passes `headSha`; the spine reads it from the options object. Git is universal infrastructure, not a capability.
- **Deferred (spec §8 WS-4 / §10):** the gh-PR-state probe (`resume-gate.mjs`) and the worktree-ops binding stay host-side — do NOT port them. Epics drain as standalone member PRs (epic D1).
- **Worktree commits use `--no-verify`** and must be verified to have landed (this workstream runs in `.claude/worktrees/runtime-replatform-next-epic` on branch `feat/runtime-replatform-next-epic`).
- **Mirror, don't reinvent:** `run-next.mjs` (adapter shape), `next-driver.mjs` (flag site), `rt-next-lane-complex-ship.scenario.mjs` (oracle scenario shape) are the byte-level templates.

---

### Task 1: `epic-members` content helper (member-selection + rule-11 surface)

**Files:**
- Create: `runtime/content/lib/epic-members.mjs`
- Test: `runtime/content/test/epic-members.test.mjs`

**Interfaces:**
- Consumes: `Item` records from `readItems` (`runtime/engine/lib/scope-gate.mjs`) — fields `id`, `type`, `status`, `epic`, `epic_role`, `rank` (all in `ItemSchema`, `.passthrough()`).
- Produces:
  - `selectEpicMembers(items, epicId) → Item[]` — the epic's OPEN (`active|queued|parking`) CORE members (role `core` or unset; `captured` excluded), sorted in deterministic drive order: `active` tier first, then `queued` by ascending `rank` (missing rank last), then `parking`; alphabetical by `id` within a tier.
  - `activeEpics(items) → string[]` — ids of every `type:'epic'` item with `status:'active'`, sorted ascending. The rule-11 / single-active-epic surface.

- [ ] **Step 1: Write the failing test**

```js
// runtime/content/test/epic-members.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectEpicMembers, activeEpics } from '../lib/epic-members.mjs';

const items = [
  { id: 'e', type: 'epic', status: 'active' },
  { id: 'other-epic', type: 'epic', status: 'active' },
  { id: 'm-active', type: 'refactor', status: 'active', epic: 'e', epic_role: 'core' },
  { id: 'm-q2', type: 'bug', status: 'queued', epic: 'e', rank: 2 },
  { id: 'm-q1', type: 'bug', status: 'queued', epic: 'e', rank: 1 },
  { id: 'm-park', type: 'bug', status: 'parking', epic: 'e' },
  { id: 'm-cap', type: 'bug', status: 'queued', epic: 'e', epic_role: 'captured' },
  { id: 'm-shipped', type: 'bug', status: 'shipped', epic: 'e', epic_role: 'core' },
  { id: 'other-member', type: 'bug', status: 'queued', epic: 'other-epic' },
];

test('selectEpicMembers: open core members of the epic, in drive order; captured + shipped + foreign excluded', () => {
  const got = selectEpicMembers(items, 'e').map((m) => m.id);
  assert.deepEqual(got, ['m-active', 'm-q1', 'm-q2', 'm-park']);   // active → queued-by-rank → parking; cap/shipped/foreign gone
});

test('selectEpicMembers: empty when the epic has no open core members', () => {
  assert.deepEqual(selectEpicMembers(items, 'no-such-epic'), []);
});

test('activeEpics: every active type:epic id, sorted', () => {
  assert.deepEqual(activeEpics(items), ['e', 'other-epic']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/content/test/epic-members.test.mjs`
Expected: FAIL — `Cannot find module '../lib/epic-members.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/content/lib/epic-members.mjs — Nestfolio content (seam #2): epic member-selection + the rule-11
// single-active-epic surface. The orchestrator spine (ring-1) drives whatever `members` array it is handed,
// in order; the ORDER and the core/open/captured filter are Nestfolio backlog semantics (epic/epic_role/
// rank/status), so they live in content and are injected by the adapter — ring-1 stays project-agnostic
// (import-boundary test). Mirrors classify-lane.mjs's placement (also content, also adapter-injected).
const OPEN = new Set(['active', 'queued', 'parking']);
const rankOf = (m) => (m.rank == null ? Infinity : Number(m.rank));
const tier = (s) => (s === 'active' ? 0 : s === 'queued' ? 1 : 2);

/** OPEN core members of `epicId` (role core or unset; captured excluded), in deterministic drive order:
 *  active first, then queued by ascending rank (missing rank last), then parking — alphabetical within a tier.
 *  Shipped/dropped members are excluded so a fresh epic run never re-drives completed work. */
export function selectEpicMembers(items, epicId) {
  return items
    .filter((i) => i.epic === epicId && (i.epic_role ?? 'core') === 'core' && OPEN.has(i.status))
    .sort((a, b) => tier(a.status) - tier(b.status) || rankOf(a) - rankOf(b) || a.id.localeCompare(b.id));
}

/** Ids of every active `type: epic` — the rule-11 / single-active-epic surface (the E1 pre-drive guard). */
export function activeEpics(items) {
  return items.filter((i) => i.type === 'epic' && i.status === 'active').map((i) => i.id).sort((a, b) => a.localeCompare(b));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/content/test/epic-members.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-replatform-next-epic add runtime/content/lib/epic-members.mjs runtime/content/test/epic-members.test.mjs
git -C .claude/worktrees/runtime-replatform-next-epic commit --no-verify -m "feat(runtime): epic member-selection + rule-11 content helper (WS-4)"
```

---

### Task 2: `run-epic.mjs` — the orchestrator-drive adapter

**Files:**
- Create: `runtime/adapters/claude-code/run-epic.mjs`
- Test: `runtime/adapters/claude-code/test/run-epic.test.mjs`

**Interfaces:**
- Consumes: `runOrchestrator` (`runtime/engine/loop/orchestrator.mjs`) — `runOrchestrator({ epic, members, capabilities, registry, locus, auto, headSha }) → { taskId, status: 'done'|'paused'|'failed', summary, decision?, findings? }`; `readItems` (`scope-gate.mjs`); `loadRegistry({ checksDir })` (`load-registry.mjs`); `pendingDecisions`, `gitHeadSha` (`journal.mjs`); `recordRuntimePath` (`path-provenance.mjs`); `selectEpicMembers`, `activeEpics` (Task 1).
- Produces: `driveEpic({ epicId, backlogDir, checksDir, fulfil, capabilities, headSha, auto }) → { exit, out }` where `exit ∈ {0,1,2,3}` and `out = { result, pending, members }` (or `{ error }` on precondition failure). Plus a `main()` CLI entry mirroring `run-next.mjs`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/adapters/claude-code/test/run-epic.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { driveEpic } from '../run-epic.mjs';

function sandbox({ otherEpicActive = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nf-re-'));
  const bd = join(root, 'docs', 'backlog'); mkdirSync(bd, { recursive: true });
  const item = (id, fm) => writeFileSync(join(bd, `${id}.md`), `---\nid: ${id}\n${fm}\n---\nbody\n`, 'utf8');
  item('e', 'type: epic\nstatus: active\ndone_when: members shipped');
  item('m1', 'type: refactor\nstatus: active\nepic: e\nepic_role: core\nscope: docs/**\nout_of_scope: [x]');
  if (otherEpicActive) item('e2', 'type: epic\nstatus: active\ndone_when: x');
  const cd = join(root, 'checks'); mkdirSync(cd, { recursive: true });
  return { root, bd, cd };
}

test('RE1 epic drives its core member, parks at the member execute floor (exit 3), records path:runtime', async () => {
  const { root, bd, cd } = sandbox();
  try {
    const j = inMemoryJournal();
    const capabilities = { journal: j,
      execute: async (t) => ({ taskId: t.id, status: 'paused', summary: 'awaits session executor',
        decision: { id: `execute:${t.id}`, question: 'q', options: [{ label: 'F', value: 'fulfil', recommended: true }] } }),
      ask: async () => ({ value: '<<HARNESS-PAUSE>>' }),
      runProcedure: async () => ({ status: 'done', findings: [] }) };
    const { exit, out } = await driveEpic({ epicId: 'e', backlogDir: bd, checksDir: cd, capabilities, headSha: 'S1' });
    assert.equal(exit, 3);                                   // parked at the first member's execute floor
    assert.equal(out.result.status, 'paused');
    assert.equal(out.result.decision.id, 'execute:m1');
    const prov = j.read('epic-e').steps.get('path:runtime');
    assert.equal(prov.value.path, 'runtime');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('RE2 unknown epic → exit 2', async () => {
  const { root, bd, cd } = sandbox();
  try {
    const { exit } = await driveEpic({ epicId: 'nope', backlogDir: bd, checksDir: cd,
      capabilities: { journal: inMemoryJournal() }, headSha: 'S1' });
    assert.equal(exit, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('RE3 non-epic id → exit 2 (use run-next for non-epic items)', async () => {
  const { root, bd, cd } = sandbox();
  try {
    const { exit } = await driveEpic({ epicId: 'm1', backlogDir: bd, checksDir: cd,
      capabilities: { journal: inMemoryJournal() }, headSha: 'S1' });
    assert.equal(exit, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('RE4 rule-11: a DIFFERENT active epic → refuse (exit 2), spine not driven', async () => {
  const { root, bd, cd } = sandbox({ otherEpicActive: true });
  try {
    let executed = false;
    const capabilities = { journal: inMemoryJournal(),
      execute: async (t) => { executed = true; return { taskId: t.id, status: 'done', summary: 'ok' }; },
      ask: async () => ({ value: 'merge' }), runProcedure: async () => ({ status: 'done', findings: [] }) };
    const { exit, out } = await driveEpic({ epicId: 'e', backlogDir: bd, checksDir: cd, capabilities, headSha: 'S1' });
    assert.equal(exit, 2);
    assert.match(out.error, /rule-11|single active epic|e2/);
    assert.equal(executed, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/adapters/claude-code/test/run-epic.test.mjs`
Expected: FAIL — `Cannot find module '../run-epic.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
#!/usr/bin/env node
// runtime/adapters/claude-code/run-epic.mjs — the orchestrator-drive adapter for backlog-next-epic (WS-4).
// Thin: it wraps the ALREADY-LIVE spine runOrchestrator, adding only (a) member-selection + the rule-11
// single-active-epic guard (Nestfolio content, computed HERE in the adapter ring — the engine stays
// project-agnostic, SPEC-1 hard constraint) and (b) git provenance / headSha threading (e2e-freshness).
// DEFERRED per spec §8/§10: the gh-PR-state probe and worktree-ops binding stay host-side (epics drain as
// standalone member PRs). Behind RUNTIME_ENGINE the backlog-next-epic SKILL drive calls this; flag off →
// the legacy skill body (byte-for-byte). Exit: 0 done / 3 paused / 1 failed / 2 usage.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { runOrchestrator } from '../../engine/loop/orchestrator.mjs';
import { loadRegistry } from '../../engine/lib/load-registry.mjs';
import { readItems } from '../../engine/lib/scope-gate.mjs';
import { pendingDecisions, gitHeadSha } from '../../engine/lib/journal.mjs';
import { recordRuntimePath } from '../../engine/lib/path-provenance.mjs';
import { selectEpicMembers, activeEpics } from '../../content/lib/epic-members.mjs';
import { makeClaudeCodeCapabilities } from './index.mjs';

export async function driveEpic({ epicId, backlogDir, checksDir, fulfil, capabilities, headSha, auto = false, locus = {} }) {
  const items = readItems(backlogDir);
  const epic = items.find((i) => i.id === epicId);
  if (!epic) return { exit: 2, out: { error: `unknown epic: ${epicId}` } };
  if (epic.type !== 'epic') return { exit: 2, out: { error: `${epicId} is type '${epic.type}', not 'epic' — use run-next.mjs for non-epic items` } };
  // rule-11 / single-active-epic guard (the E1 pre-drive surface): refuse if ANY epic OTHER than this one is active.
  const foreignActive = activeEpics(items).filter((id) => id !== epicId);
  if (foreignActive.length) return { exit: 2, out: { error: `rule-11 (single active epic) blocked: other active epic(s): ${foreignActive.join(', ')}` } };

  const runId = `epic-${epicId}`;
  if (fulfil) capabilities.journal.fulfil(runId, fulfil.key, fulfil.value);
  const registry = loadRegistry({ checksDir });
  const members = selectEpicMembers(items, epicId);
  const result = await runOrchestrator({ epic, members, capabilities, registry, headSha, auto, locus });
  recordRuntimePath(capabilities.journal, { runId, workstream: epicId, sha: headSha ?? gitHeadSha() });
  const pending = pendingDecisions(capabilities.journal.read(runId));
  const exit = result.status === 'done' ? 0 : result.status === 'paused' ? 3 : 1;
  return { exit, out: { result, pending, members: members.map((m) => m.id) } };
}

async function main() {
  const [epicId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const fi = process.argv.indexOf('--fulfil'); const vi = process.argv.indexOf('--value');
  const fv = fi >= 0 ? process.argv[fi + 1] : undefined; const vv = vi >= 0 ? process.argv[vi + 1] : undefined;
  const badPair = fi >= 0 && (fv === undefined || fv.startsWith('--') || vv === undefined || vv.startsWith('--'));
  if (!epicId || (fi >= 0) !== (vi >= 0) || badPair) { console.error('usage: run-epic.mjs <epic-id> [--fulfil <key> --value <json>] [--auto]'); process.exit(2); }
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const capabilities = makeClaudeCodeCapabilities({});
  const { exit, out } = await driveEpic({ epicId, backlogDir: cfg.backlogDir ?? 'docs/backlog', checksDir: cfg.checksDir,
    fulfil: fi >= 0 ? { key: fv, value: JSON.parse(vv) } : undefined, capabilities,
    headSha: gitHeadSha(), auto: process.argv.includes('--auto') });
  console.log(JSON.stringify(out, null, 2));
  process.exit(exit);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/adapters/claude-code/test/run-epic.test.mjs`
Expected: PASS (4 tests). If `RE1` reports the pending key differs from `execute:m1`, read the actual `out.result.decision` and align the assertion to the spine's real decision id (do not change the spine).

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-replatform-next-epic add runtime/adapters/claude-code/run-epic.mjs runtime/adapters/claude-code/test/run-epic.test.mjs
git -C .claude/worktrees/runtime-replatform-next-epic commit --no-verify -m "feat(runtime): run-epic.mjs orchestrator-drive adapter (WS-4)"
```

---

### Task 3: `epic-driver.mjs` — the flag decision-site

**Files:**
- Create: `.claude/skills/backlog-next-epic/epic-driver.mjs`
- Test: `.claude/skills/backlog-next-epic/test/epic-driver.test.mjs`

**Interfaces:**
- Consumes: `usesRuntimeEngine(env)` (`runtime/engine/lib/path-provenance.mjs`).
- Produces: `epicDriver(env) → { cmd, mode }` — `{ cmd: 'node runtime/adapters/claude-code/run-epic.mjs', mode: 'runtime' }` when the flag is set, else `{ cmd: null, mode: 'legacy' }`. Byte-identical shape to `nextDriver`.

- [ ] **Step 1: Write the failing test**

```js
// .claude/skills/backlog-next-epic/test/epic-driver.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epicDriver } from '../epic-driver.mjs';

test('flag on → routes to run-epic.mjs', () => {
  assert.deepEqual(epicDriver({ RUNTIME_ENGINE: '1' }),
    { cmd: 'node runtime/adapters/claude-code/run-epic.mjs', mode: 'runtime' });
});

test('flag off → legacy (cmd null)', () => {
  assert.deepEqual(epicDriver({}), { cmd: null, mode: 'legacy' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/backlog-next-epic/test/epic-driver.test.mjs`
Expected: FAIL — `Cannot find module '../epic-driver.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// .claude/skills/backlog-next-epic/epic-driver.mjs — the WS-4 strangler branch (mirrors next-driver.mjs).
// Flag on → the SKILL epic drive routes to the runtime orchestrator adapter; off → the legacy SKILL.md body
// runs. Single decision site so the flag lives in exactly one place.
import { usesRuntimeEngine } from '../../../runtime/engine/lib/path-provenance.mjs';
export function epicDriver(env) {
  return usesRuntimeEngine(env)
    ? { cmd: 'node runtime/adapters/claude-code/run-epic.mjs', mode: 'runtime' }
    : { cmd: null, mode: 'legacy' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/skills/backlog-next-epic/test/epic-driver.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git -C .claude/worktrees/runtime-replatform-next-epic add .claude/skills/backlog-next-epic/epic-driver.mjs .claude/skills/backlog-next-epic/test/epic-driver.test.mjs
git -C .claude/worktrees/runtime-replatform-next-epic commit --no-verify -m "feat(backlog-next-epic): epic-driver.mjs flag decision-site (WS-4)"
```

---

### Task 4: Wire the `RUNTIME_ENGINE` flag into `backlog-next-epic/SKILL.md`

**Files:**
- Modify: `.claude/skills/backlog-next-epic/SKILL.md` (insert a "Runtime engine drive" subsection at the epic-drive step; leave every legacy step body unchanged for flag-off)

**Interfaces:** none (documentation). The section mirrors `backlog-next/SKILL.md` §5a ("Runtime engine drive (behind `RUNTIME_ENGINE` — WS-3 strangler)").

- [ ] **Step 1: Locate the epic-drive step and read §5a for the template**

Run: `grep -n '5a. Runtime engine drive' .claude/skills/backlog-next/SKILL.md` and read that subsection (lines ~102–110). Find the `backlog-next-epic/SKILL.md` step where the orchestrator drives members (the E-phase member loop / merge close), which is where the runtime path takes over.

- [ ] **Step 2: Insert the strangler subsection**

Add a subsection modeled on §5a, adapted to the epic layer. Exact prose to insert (place it at the member-loop / epic-drive step):

```markdown
#### Runtime engine drive (behind `RUNTIME_ENGINE` — WS-4 strangler)

When the `RUNTIME_ENGINE` flag is set, the **member loop + epic-pre-done batch + merge floor** are driven by
the runtime orchestrator rather than the legacy prose below: run
`node runtime/adapters/claude-code/run-epic.mjs <epic-id>`. The single decision site is
[`epic-driver.mjs`](./epic-driver.mjs) (`epicDriver(env) → {cmd, mode}`, mirroring
[`next-driver.mjs`](../backlog-next/next-driver.mjs)); flag **off** → the legacy body in the sections below
runs **unchanged** (byte-for-byte, retained until P6). The adapter wraps the live spine
(`runtime/engine/loop/orchestrator.mjs`) plus **member-selection** (open core members in drive order),
the **rule-11** single-active-epic guard, and **e2e-freshness** (the SHA-conditional epic-pre-done batch).
It **defers** the gh-PR-state probe (`resume-gate.mjs`) and the worktree-ops binding — those stay host-side
(epics drain as standalone member PRs, epic D1). The driver exits `0 done / 3 paused / 1 failed / 2 usage`;
on a `3` park, fulfil the printed decision key (`--fulfil <key> --value <json>`) and re-invoke. Git-workflow
preconditions (tree-clean, worktree, merge/PR) stay host preflight/postflight — they are not engine concerns.
```

- [ ] **Step 3: Verify the legacy body is unchanged**

Run: `git -C .claude/worktrees/runtime-replatform-next-epic diff .claude/skills/backlog-next-epic/SKILL.md`
Expected: the diff is a **pure insertion** (only added lines for the new subsection) — no legacy step text modified or deleted. This preserves the flag-off byte-for-byte guarantee.

- [ ] **Step 4: Commit**

```bash
git -C .claude/worktrees/runtime-replatform-next-epic add .claude/skills/backlog-next-epic/SKILL.md
git -C .claude/worktrees/runtime-replatform-next-epic commit --no-verify -m "docs(backlog-next-epic): wire RUNTIME_ENGINE drive subsection (WS-4)"
```

---

### Task 5: Parity oracle — map the spine-expressible `bne-*` twins

Maps WS-4's slice of the 42 `unmapped:'P5'` scenarios (spec §6). The spine-expressible subset is the epic happy-path drive to the merge floor, in both non-auto and auto forms (auto still parks — never self-merges). Everything host-side (gh-PR-probe, worktree-ops, resume, conflict-resolution, cwd-survival) and the deterministic-only spine behaviors (sha-conditional replay, gate-red) stay `P5` with **specific** WS-4 reasons.

**Files:**
- Create: `scripts/parity-oracle/fixtures/rt/epic-clean/backlog/e.md`, `.../m1.md`, `.../m2.md`
- Create: `scripts/parity-oracle/scenarios/rt-epic-ship-clean.scenario.mjs`
- Create: `scripts/parity-oracle/scenarios/rt-epic-auto-no-self-merge.scenario.mjs`
- Modify: `scripts/parity-oracle/mapping.mjs` (move `bne-ship-clean`, `bne-e8-auto-no-self-merge` from the P5 blob to `RT(...)`; tighten the remaining `bne-*` P5 reasons)
- Modify: `scripts/parity-oracle/test/mapping.test.mjs` (bump `mapped.length` 15 → 17; add the two ids to the mapped-includes list; keep `bne-e8-pr-route` in the excludes list)

**Interfaces:**
- Consumes: `OPERATOR_PROMPT` (`mapping.mjs`), the legacy scenarios `scripts/benchmark-backlog/scenarios/bne-ship-clean.scenario.mjs` + `bne-e8-auto-no-self-merge.scenario.mjs` (spread as the pair base).
- Produces: two `rt-epic-*` runtime scenario modules driving `node runtime/adapters/claude-code/run-epic.mjs`, each with a `{ path: 'runtime' }` journal spec (the hollow-green guard) and an ItemSchema-valid `rtFixture`.

- [ ] **Step 1: Write the fixture (ItemSchema-valid epic + 2 core members)**

```markdown
<!-- scripts/parity-oracle/fixtures/rt/epic-clean/backlog/e.md -->
---
id: e
type: epic
status: active
done_when: all core members shipped
---
Demo epic for the runtime orchestrator parity twin.
```

```markdown
<!-- scripts/parity-oracle/fixtures/rt/epic-clean/backlog/m1.md -->
---
id: m1
type: refactor
status: queued
rank: 1
epic: e
epic_role: core
scope: docs/**
out_of_scope: [x]
done_when: m1 file exists
---
Create docs/m1.txt containing the text: m1-done
```

```markdown
<!-- scripts/parity-oracle/fixtures/rt/epic-clean/backlog/m2.md -->
---
id: m2
type: refactor
status: queued
rank: 2
epic: e
epic_role: core
scope: docs/**
out_of_scope: [x]
done_when: m2 file exists
---
Create docs/m2.txt containing the text: m2-done
```

- [ ] **Step 2: Write the two rt-epic scenario modules**

Read `scripts/benchmark-backlog/scenarios/bne-ship-clean.scenario.mjs` first to confirm the legacy shape/fields, then spread it. Model both files on `rt-next-lane-complex-ship.scenario.mjs`:

```js
// scripts/parity-oracle/scenarios/rt-epic-ship-clean.scenario.mjs
import legacy from '../../benchmark-backlog/scenarios/bne-ship-clean.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Orchestrator parity with bne-ship-clean, WS-4: the epic drive is now the runtime spine (runOrchestrator via
// run-epic.mjs). The operator drives run-epic.mjs; each open core member PARKS on execute — the operator does
// that member's one-file work + commit, then fulfils; replay advances to the next member. After the last
// member, the sha-conditional epic-pre-done batch runs and the drive stops at the MERGE FLOOR PARK — the twin
// of legacy's single-PR pause. The spine NEVER auto-merges.
export default {
  ...legacy,
  id: 'rt-epic-ship-clean',
  driver: 'epic',
  rtFixture: 'epic-clean',
  prompt: OPERATOR_PROMPT(
    'Drive epic e through the runtime orchestrator. Driver command: node runtime/adapters/claude-code/run-epic.mjs e — when parked on an execute:<member> key, read docs/backlog/<member>.md, perform its work exactly (create the file it names with the content it names), commit, then fulfil that key. The merge decision is a human floor decision.'),
  terminal: 'pause',
  callLog: { neverCalled: ['gh pr merge'] },
  state: { fileContains: [{ file: 'docs/m1.txt', needle: 'm1-done' }, { file: 'docs/m2.txt', needle: 'm2-done' }] },
  journal: [
    { runId: 'epic-e', path: 'runtime' },
    { runId: 'epic-e', has: 'member.m1' },
    { runId: 'epic-e', has: 'member.m2' },
    { runId: 'epic-e', awaiting: 'merge-e' },
  ],
  rubric: ['Did the runtime orchestrator drive both core members inline (operator did each member\'s file work + commit), then stop PARKED at the merge floor without auto-merging or self-merging?'],
};
```

```js
// scripts/parity-oracle/scenarios/rt-epic-auto-no-self-merge.scenario.mjs
import legacy from '../../benchmark-backlog/scenarios/bne-e8-auto-no-self-merge.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Orchestrator parity with bne-e8-auto-no-self-merge, WS-4: even with --auto, the merge is ALWAYS a floor ask
// (the spine never runs an irreversible act). run-epic.mjs --auto drives the members and STILL parks at the
// merge floor — no self-merge. The engine's sanctioned stop is the MERGE FLOOR PARK.
export default {
  ...legacy,
  id: 'rt-epic-auto-no-self-merge',
  driver: 'epic',
  rtFixture: 'epic-clean',
  prompt: OPERATOR_PROMPT(
    'Drive epic e through the runtime orchestrator in auto mode. Driver command: node runtime/adapters/claude-code/run-epic.mjs e --auto — when parked on an execute:<member> key, read docs/backlog/<member>.md, do its work exactly (create the named file with the named content), commit, then fulfil. The merge decision is a human floor decision even in auto — STOP there.'),
  terminal: 'pause',
  callLog: { neverCalled: ['gh pr merge'] },
  journal: [
    { runId: 'epic-e', path: 'runtime' },
    { runId: 'epic-e', awaiting: 'merge-e' },
  ],
  rubric: ['Under --auto, did the runtime orchestrator still STOP at the merge floor park (never auto-merged, never self-merged)?'],
};
```

- [ ] **Step 3: Update `mapping.mjs`**

In `scripts/parity-oracle/mapping.mjs`, remove `bne-ship-clean` and `bne-e8-auto-no-self-merge` from the `Object.fromEntries([...])` P5 blob (lines ~44–54), and add explicit `RT` rows alongside the other driver-parity mappings:

```js
  // ---- orchestrator parity: backlog-next-epic vs runOrchestrator spine (engine-expressible subset, 2) ----
  'bne-ship-clean': RT('rt-epic-ship-clean.scenario.mjs'),
  'bne-e8-auto-no-self-merge': RT('rt-epic-auto-no-self-merge.scenario.mjs'),
```

Then split the residual `bne-*` P5 reason so it is honest about WS-4's deferrals. Replace the single blob reason with two reason buckets (host-side vs. deterministic-only), e.g. map the host-side ids (`bne-resume-*`, `bne-e2-worktree-reattach`, `bne-e8-conflict-resolution`, `bne-e84-postflight-cwd-survival`, `bne-e8-pr-route`, `bne-promote-*`, `bne-select-*`) with reason `'WS-4 defers the gh-PR-state probe + worktree-ops binding (spec §8/§10); these are host-git/PR/selection prose with no in-sandbox spine analogue'`, and the deterministic-only spine ids (`bne-ship-stale-sha`, `bne-ship-e2e-red-no-ship`, `bne-member-checkpoint-clear`, `bne-rule11-different-active`, `bne-member-debug-budget`, ...) with reason `'deterministic spine behavior proven by orchestrator.test.mjs / run-epic.test.mjs; not distinctly expressible as a live-operator scenario in the services-free sandbox'`. Keep every currently-listed `bne-*` id present exactly once (the totality test enforces it).

- [ ] **Step 4: Update `mapping.test.mjs`**

```js
  assert.equal(mapped.length, 17);   // WS-3 flipped 4 next-* twins; WS-4 adds 2 epic twins (ship-clean, auto-no-self-merge)
```

Add `'bne-ship-clean'` and `'bne-e8-auto-no-self-merge'` to the mapped-includes loop (line ~31). Leave `'bne-e8-pr-route'` in the excludes loop (line ~33) — the PR route stays host prose.

- [ ] **Step 5: Run the deterministic oracle tests**

Run: `node --test scripts/parity-oracle/test/mapping.test.mjs scripts/parity-oracle/test/scenarios-lint.test.mjs scripts/parity-oracle/test/suites.test.mjs`
Expected: PASS. These enforce: totality (every legacy id mapped/P5 once), the mapped set == 17, each rt scenario has its file + fixture + `{path:'runtime'}` spec + `run-epic.mjs` prompt, rt fixtures pass ItemSchema. If `scenarios-lint` reports a `lintRtScenario` field error, read `scripts/parity-oracle/structural-lint.mjs` and add the missing field (do not weaken the lint).

- [ ] **Step 6: Commit**

```bash
git -C .claude/worktrees/runtime-replatform-next-epic add scripts/parity-oracle/
git -C .claude/worktrees/runtime-replatform-next-epic commit --no-verify -m "test(parity-oracle): map the 2 spine-expressible bne-* epic twins (WS-4)"
```

---

### Task 6: Full verification + validation-gate documentation

**Files:** none (verification + the backlog `validation_gate` is stamped later at ship, Step 6.5 of `backlog-next`).

- [ ] **Step 1: Runtime engine + adapters + content suites**

Run: `node --test runtime/engine/test/*.test.mjs runtime/engine/loop/test/*.test.mjs runtime/adapters/**/test/*.test.mjs runtime/content/test/*.test.mjs`
Expected: PASS, including the import-boundary test (`epic-members.mjs` is content, imported by the adapter — no ring-1 violation) and the greenfield e2e if included.

- [ ] **Step 2: Full parity-oracle deterministic suite**

Run: `node --test scripts/parity-oracle/test/*.test.mjs`
Expected: PASS (mapping totality/count, scenarios-lint, suites pairing, oracle-teeth, runtime-grade).

- [ ] **Step 3: nx affected (true-affected resolver) — test + lint**

Run:
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
[ -n "$AFFECTED" ] && NX_DAEMON=false pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"
```
Expected: PASS. (The parity-oracle tests are not in the nx graph — Step 2 covers them explicitly.)

- [ ] **Step 4: Record the live-sweep deferral for the ship `validation_gate`**

The live LLM parity sweep that proves the two `rt-epic-*` pairs **dominant** (`scripts/parity-oracle/run.mjs`) is cost-gated and cumulative; per the WS-3 TIER0 precedent it is **deferred to `runtime-replatform-soak-gate`** (the terminal item that runs the live sweep + soak observer for the whole re-platform, spec §12). At ship (`backlog-next` Step 6.5), the `validation_gate` must state: deterministic oracle green (mapping 17/17 + scenarios-lint + suites), `run-epic.test.mjs`/`epic-driver.test.mjs`/`epic-members.test.mjs` green, nx-affected green, and **live parity dominance deferred to the soak gate (cost-gated, WS-3 precedent)**. If instead the live sweep is to be run now, surface it as a cost gate (AskUserQuestion — a hard `--auto` floor) before invoking `scripts/parity-oracle/run.mjs`.

- [ ] **Step 5: No commit** (verification only; the `status: shipped` + `validation_gate` + `closed:` stamp happens in the `backlog-next` closing phase, not here).

---

## Self-Review

**Spec coverage (§8 WS-4 + §6):**
- "build `run-epic.mjs` CLI driver over the live spine" → Task 2.
- "member-selection" → Task 1 (`selectEpicMembers`), injected by Task 2.
- "rule-11" → Task 1 (`activeEpics`) + Task 2 guard (RE4).
- "e2e-freshness" → Task 2 passes `headSha`; the SHA-conditional epic-pre-done lives in the spine (unchanged).
- "flip `RUNTIME_ENGINE` for its slice" → Task 3 (`epic-driver.mjs`) + Task 4 (SKILL wiring).
- "maps its slice of the 42 oracle scenarios green (§6)" → Task 5 (2 spine-expressible twins mapped + green deterministically; live dominance deferred to soak-gate per §12 + WS-3 TIER0 precedent).
- "defer the gh-PR-state probe + worktree-ops binding" → Global Constraints + Task 5 P5 reasons; nothing ports them.

**Placeholder scan:** every code step has complete code; every command has an expected result. The one deliberately open value is the exact residual-`bne-*` P5 reason bucketing in Task 5 Step 3 (the ids are enumerated; the reason strings are given verbatim) and the possibility that `RE1`'s pending decision id needs realignment to the spine's real key (Task 2 Step 4 says how). No TBD/TODO.

**Type consistency:** `driveEpic({ epicId, backlogDir, checksDir, fulfil, capabilities, headSha, auto, locus })` used consistently in Task 2 impl + test. `selectEpicMembers(items, epicId)`/`activeEpics(items)` names match across Tasks 1 and 2. `epicDriver(env) → {cmd, mode}` matches `nextDriver`. Journal runId `epic-<id>` and step keys (`member.<id>`, `merge-<id>`, `path:runtime`) match the spine (`orchestrator.mjs`) and the oracle journal specs (Task 5).

## Execution Handoff

Two execution options:
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute in this session via `superpowers:executing-plans`, batch with checkpoints.
