# Runtime Regression Harness (Parity Oracle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `scripts/parity-oracle/` — the instrument that grades the runtime loop against the legacy backlog skills on shared scenarios (strict gate dominance), plus the deterministic lint differential, versioned parity baseline with compare teeth, and the greenfield adoption e2e.

**Architecture:** Sibling suite composing `scripts/benchmark-backlog/`'s exported core (two `defineSuite` instances over one totality-checked mapping table; the runtime side spawns the same headless `claude` but seeds `runtime/` + starter checks instead of legacy skills and prompts the session as *loop operator* over `run-item.mjs`/`run-intake.mjs` park/fulfil). Deterministic layers (differential, greenfield e2e, verdict math) are plain `node:test` with zero LLM.

**Tech Stack:** Node ≥24 (`.mjs` + `.ts`-zod imports with explicit extension), `node --test`, headless `claude -p` (via benchmark-backlog's runner), git temp sandboxes.

**Spec:** `docs/superpowers/specs/2026-07-06-runtime-regression-harness-design.md` (decisions D2–D5).

## Global Constraints

- House module convention: JSDoc header, pure named-export core + thin `main()` guarded by `if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();`, **no default exports** — EXCEPT `*.scenario.mjs` files, which follow benchmark-backlog's `export default {…}` convention.
- Tests via glob form: `node --test scripts/parity-oracle/test/*.test.mjs` (bare dir does NOT discover on Node 24).
- Worktree commits: the pre-commit hook rejects code commits in a worktree — commit with `--no-verify` AND verify each commit landed via `git log --oneline -1` (never trust the echo).
- nx cannot run inside a runtime worktree (`.modules.yaml` missing). Runtime validation fallback: `node --test runtime/engine/test/*.test.mjs runtime/engine/backward/test/*.test.mjs runtime/engine/loop/test/*.test.mjs runtime/adapters/claude-code/test/*.test.mjs runtime/adapters/git/test/*.test.mjs runtime/eval/test/*.test.mjs runtime/eval/e2e/*.test.mjs` + `npx tsc --noEmit -p runtime/tsconfig.json`.
- **Never edit `scripts/benchmark-backlog/` behavior or its fixtures/scenarios** — its committed `baseline.json` must stay valid. The ONLY permitted change is Task 1's behavior-neutral `export` keywords.
- **Never edit shared bef fixtures.** If a mapped scenario's fixture fails `ItemSchema` on `readItems`, create a derived copy under `scripts/parity-oracle/fixtures/rt/<name>/` with minimal schema fixes and point the rt variant's `rtFixture` at it.
- Reports go to gitignored `benchmarks/parity-oracle/`; committed artifacts are only `parity-baseline.json` + `parity-baseline.provenance.json` under `scripts/parity-oracle/`.
- Live runs spend Max quota (tokens). Tasks 1–11 are zero-quota. Task 12 (bring-up) runs under approved D4. Task 13's full baseline re-confirms cost via AskUserQuestion before firing.
- Runtime is Tier-0: no deploy, no e2e-feature-tests, no Playwright anywhere in this plan.

---

### Task 1: Export `aggregate` + `defaultRunOne` from benchmark-backlog (behavior-neutral)

**Files:**
- Modify: `scripts/benchmark-backlog/run.mjs:75` (`function aggregate` → `export function aggregate`) and `scripts/benchmark-backlog/run.mjs:105` (`function defaultRunOne` → `export function defaultRunOne`)
- Test: `scripts/parity-oracle/test/reuse.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `aggregate(runs) → {gatePassRate, anyGateFlip, tokens:{input,output,cacheRead,cacheWrite,total}, numTurns, costUsd, diagnostics?}` and `defaultRunOne(suite, opts) → async (scenario, ref) → {gatePass, graded, costUsd, numTurns, rr}` importable from `../benchmark-backlog/run.mjs`. Every later task that runs or aggregates live scenarios uses exactly these.

- [ ] **Step 1: Write the failing test**

```js
// scripts/parity-oracle/test/reuse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, defaultRunOne, runMode, PAUSE_CONVENTION } from '../../benchmark-backlog/run.mjs';

test('benchmark-backlog exports the composable core', () => {
  assert.equal(typeof aggregate, 'function');
  assert.equal(typeof defaultRunOne, 'function');
  assert.equal(typeof runMode, 'function');
  assert.ok(PAUSE_CONVENTION.includes('<<HARNESS-PAUSE:'));
});

test('aggregate math over synthetic runs', () => {
  const run = (gatePass, out) => ({ gatePass, numTurns: 5, costUsd: 1, rr: { perTurn: [{ input_tokens: 10, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }] } });
  const row = aggregate([run(true, 100), run(false, 200), run(true, 300)]);
  assert.equal(row.gatePassRate, 2 / 3);
  assert.equal(row.anyGateFlip, true);
  assert.equal(row.tokens.total, 210); // median of 110,210,310
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/parity-oracle/test/reuse.test.mjs`
Expected: FAIL — `aggregate` is not exported (`SyntaxError: The requested module ... does not provide an export named 'aggregate'`).

- [ ] **Step 3: Add the two `export` keywords** (no other change — diff must be exactly 2 words).

- [ ] **Step 4: Run the new test AND the full benchmark-backlog suite**

Run: `node --test scripts/parity-oracle/test/reuse.test.mjs && node --test scripts/benchmark-backlog/test/*.test.mjs`
Expected: both PASS (bef suite unchanged — proves behavior-neutrality).

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-backlog/run.mjs scripts/parity-oracle/test/reuse.test.mjs
git commit --no-verify -m "feat(parity-oracle): export aggregate/defaultRunOne from bef core (behavior-neutral)" && git log --oneline -1
```

---

### Task 2: `mapping.mjs` — the totality-checked scenario mapping table

**Files:**
- Create: `scripts/parity-oracle/mapping.mjs`
- Test: `scripts/parity-oracle/test/mapping.test.mjs`

**Interfaces:**
- Consumes: benchmark-backlog scenario ids (filenames under `scripts/benchmark-backlog/scenarios/`).
- Produces: `MAPPING: Record<legacyId, {runtime: {scenario: string}} | {unmapped: 'P5', reason: string}>` where `runtime.scenario` is the rt scenario module basename (Task 6 creates them); `mappedIds() → string[]`; `OPERATOR_PROMPT(taskLine: string) → string` (the loop-operator prompt template used by every rt scenario).

- [ ] **Step 1: Write the failing test**

```js
// scripts/parity-oracle/test/mapping.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { MAPPING, mappedIds, OPERATOR_PROMPT } from '../mapping.mjs';

const legacyIds = readdirSync(new URL('../../benchmark-backlog/scenarios/', import.meta.url))
  .filter((f) => f.endsWith('.scenario.mjs')).map((f) => f.replace('.scenario.mjs', ''));

test('totality: every legacy scenario id appears exactly once', () => {
  assert.deepEqual(Object.keys(MAPPING).sort(), legacyIds.sort());
});

test('unmapped entries carry a reason; mapped entries name an rt scenario module', () => {
  for (const [id, m] of Object.entries(MAPPING)) {
    if (m.unmapped) { assert.equal(m.unmapped, 'P5'); assert.ok(m.reason?.length > 10, `${id} needs a reason`); }
    else assert.match(m.runtime.scenario, /^rt-.+\.scenario\.mjs$/);
  }
});

test('the mapped set is the engine-expressible subset (D3)', () => {
  const mapped = mappedIds();
  for (const id of ['add-fold-core', 'add-orphan', 'next-lane-complex-ship', 'next-auto-floor-pause']) assert.ok(mapped.includes(id));
  for (const id of ['bne-e8-pr-route', 'themes-cluster-root-cause', 'next-lane-doc-layer']) assert.ok(!mapped.includes(id));
});

test('operator prompt encodes park/fulfil + floor-stop contract', () => {
  const p = OPERATOR_PROMPT('File finding X.');
  for (const needle of ['exit code 3', '--fulfil', 'execute:', '"status":"done"', '<<HARNESS-PAUSE:', 'File finding X.']) assert.ok(p.includes(needle), needle);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/parity-oracle/test/mapping.test.mjs`
Expected: FAIL — `Cannot find module '../mapping.mjs'`.

- [ ] **Step 3: Write `mapping.mjs`**

```js
// scripts/parity-oracle/mapping.mjs — THE source of truth: every legacy benchmark-backlog scenario id
// appears exactly once, either mapped to an rt-* scenario module or explicitly unmapped:'P5' with a
// reason. The unmapped rows ARE the P5 migration checklist (rendered in every report — no silent caps).

export const OPERATOR_PROMPT = (taskLine) => `You are the RUNTIME LOOP OPERATOR. Your job: ${taskLine}
Drive the runtime loop driver command given below. Protocol:
1. Run the driver command with Bash. Read its JSON output.
2. If it exits with exit code 3 (parked), inspect out.pending[]. For a pending key starting with "execute:":
   perform the described task yourself in this repository (edit files, run commands), then re-invoke the SAME
   driver command appending: --fulfil '<the pending key>' --value '<json>' where <json> is a TaskResult like
   {"taskId":"<task id>","status":"done","summary":"<what you did>"}. For an intake route decision the summary
   MUST be EXACTLY the route JSON, e.g. {"taskId":"intake-f1","status":"done","summary":"{\\"route\\":\\"fold\\",\\"epic\\":\\"acme-epic\\",\\"epicRole\\":\\"core\\"}"}.
3. If a pending decision is NOT an execute: park (a ship/merge/mint/curate floor decision), STOP — that is a
   human decision. Your ENTIRE final response must be one line: <<HARNESS-PAUSE: floor decision <key>>>.
4. Repeat until the driver exits 0 (done) — then summarize what was filed/done — or until a floor stop.
Never modify files under runtime/. Never invent driver flags.`;

const P5 = (reason) => ({ unmapped: 'P5', reason });
const RT = (scenario) => ({ runtime: { scenario } });

export const MAPPING = {
  // ---- router parity: backlog-add vs run-intake (all 9 mapped) ----
  'add-atomicity-split': RT('rt-add-atomicity-split.scenario.mjs'),
  'add-commit-scope': RT('rt-add-commit-scope.scenario.mjs'),
  'add-fold-captured': RT('rt-add-fold-captured.scenario.mjs'),
  'add-fold-core': RT('rt-add-fold-core.scenario.mjs'),
  'add-id-collision-suffix': P5('runtime slug is deterministic from finding.check (from-<check>); id-collision suffixing is backlog-add filename prose — no engine analogue until P5 re-platforms the writer'),
  'add-join-theme': RT('rt-add-join-theme.scenario.mjs'),
  'add-mint-aggregation': RT('rt-add-mint-aggregation.scenario.mjs'),
  'add-notes-scalar': P5('notes-scalar formatting is backlog-add write-layer prose; ItemSchema/item-store-valid covers shape, not notes styling'),
  'add-orphan': RT('rt-add-orphan.scenario.mjs'),
  // ---- driver parity: backlog-next vs worker spine (engine-expressible subset) ----
  'next-lane-complex-ship': RT('rt-next-lane-complex-ship.scenario.mjs'),
  'next-auto-floor-pause': RT('rt-next-auto-floor-pause.scenario.mjs'),
  'next-auto-finishing-pr-stop': RT('rt-next-auto-finishing-pr-stop.scenario.mjs'),
  'next-preflight-dirty-stop': RT('rt-next-preflight-dirty-stop.scenario.mjs'),
  'next-lane-doc-layer': P5('lane classification is backlog-next skill prose'),
  'next-lane-simple': P5('lane classification is backlog-next skill prose'),
  'next-lane-design-doc': P5('lane classification is backlog-next skill prose'),
  'next-lane-complex': P5('lane classification is backlog-next skill prose'),
  'next-auto-design-pause': P5('design-fork recognition is --auto policy prose; the engine floor equivalent is covered by rt-next-auto-floor-pause'),
  'next-auto-fork-resolve': P5('blast-radius fork gate is detect-fork-blast-radius.mjs procedure content'),
  // ---- orchestrator + themes: entirely P5 (per D3 / item scope: lint, router, driver parity only) ----
  // every bne-* below: the epic orchestrator re-platform is P5; E-phase mechanics are skill prose today.
  ...Object.fromEntries([
    'bne-auto-blast-fail', 'bne-auto-blast-pass', 'bne-auto-catchall-pause', 'bne-auto-design-pause',
    'bne-auto-irreversible-pause', 'bne-e0-dirty-tree-stop', 'bne-e2-worktree-reattach', 'bne-e6-zero-tests-red',
    'bne-e71-chained-e6', 'bne-e8-auto-no-self-merge', 'bne-e8-conflict-resolution', 'bne-e8-pr-route',
    'bne-e84-postflight-cwd-survival', 'bne-member-checkpoint-clear', 'bne-member-debug-budget',
    'bne-member-f21-nonshared-no-typecheck', 'bne-promote-clean', 'bne-promote-already-drainable',
    'bne-resume-absent-fresh', 'bne-resume-corrupt-stop', 'bne-resume-merged-tail-only', 'bne-resume-partial',
    'bne-resume-pr-open-stop', 'bne-rule11-different-active', 'bne-select-auto-confirm', 'bne-select-bare-epic-id',
    'bne-select-impact-rank', 'bne-select-like-criterion', 'bne-select-zero-candidates', 'bne-ship-clean',
    'bne-ship-captured-promote', 'bne-ship-e2e-red-no-ship', 'bne-ship-stale-sha',
  ].map((id) => [id, P5('epic orchestrator re-platform is P5; E-phase/runstate mechanics are backlog-next-epic skill prose today')])),
  'themes-cluster-root-cause': P5('parking-lot clustering is backlog-themes prose; no engine procedure exists'),
  'themes-discrimination': P5('parking-lot clustering is backlog-themes prose; no engine procedure exists'),
};

export function mappedIds() {
  return Object.entries(MAPPING).filter(([, m]) => m.runtime).map(([id]) => id);
}
```

> NOTE: the bne id list above MUST be reconciled against `ls scripts/benchmark-backlog/scenarios/` at implementation time — the totality test is the enforcement. If an id differs (e.g. `bne-ship-captured-promote` vs the real filename), fix the mapping key, never the test.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/parity-oracle/test/mapping.test.mjs`
Expected: PASS (fix any id drift the totality test surfaces).

- [ ] **Step 5: Commit**

```bash
git add scripts/parity-oracle/mapping.mjs scripts/parity-oracle/test/mapping.test.mjs
git commit --no-verify -m "feat(parity-oracle): totality-checked legacy→runtime scenario mapping" && git log --oneline -1
```

---

### Task 3: `runtime-sandbox.mjs` — the runtime-side sandbox builder

**Files:**
- Create: `scripts/parity-oracle/runtime-sandbox.mjs`
- Test: `scripts/parity-oracle/test/runtime-sandbox.test.mjs`

**Interfaces:**
- Consumes: benchmark-backlog fixture dirs (`scripts/benchmark-backlog/fixtures/<name>/`), optional rt-fixture overrides (`scripts/parity-oracle/fixtures/rt/<name>/`), the repo's `runtime/` tree.
- Produces: `buildRuntimeSandbox(scenario, ref) → Promise<{dir, originDir, cleanup}>` — same return contract as bef `buildSandbox`, so `defaultRunOne` consumes it unchanged. Sandbox layout: fixture at `docs/`, `runtime/` copied ref-aware with `content/checks` REPLACED by `starter/checks` (portable registry — Nestfolio content checks reference `tools/` paths absent in a sandbox and would fail the gate closed), node_modules symlinks for `yaml` + `zod`, bef op stubs (`deploy.sh`, `nx`, `gh`), trimmed CLAUDE.md (same sections as bef — identical context on both sides), `.gitignore` with `stubs.log`, baseline commit pushed to a bare origin. NO `.claude/skills/` (the runtime side must not fall back to legacy prose).

- [ ] **Step 1: Write the failing test**

```js
// scripts/parity-oracle/test/runtime-sandbox.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildRuntimeSandbox } from '../runtime-sandbox.mjs';
import { loadRegistry } from '../../../runtime/engine/lib/load-registry.mjs';

const scenario = { id: 'sbx-test', fixture: 'active-epic', prompt: 'noop' };

test('runtime sandbox: runtime/ present, starter registry clean, no legacy skills', async () => {
  const { dir, cleanup } = await buildRuntimeSandbox(scenario, 'HEAD');
  try {
    assert.ok(existsSync(join(dir, 'runtime/adapters/claude-code/run-item.mjs')));
    assert.ok(existsSync(join(dir, 'docs/backlog')));
    assert.ok(!existsSync(join(dir, '.claude/skills')), 'no legacy skills in the runtime sandbox');
    // registry = starter checks only, loads with zero errors (fail-closed gates depend on this)
    const reg = loadRegistry({ checksDir: join(dir, 'runtime/content/checks') });
    assert.equal(reg.errors.length, 0, JSON.stringify(reg.errors));
    const starter = readdirSync(join(dir, 'runtime/starter/checks')).filter((f) => f.endsWith('.yaml')).sort();
    const seeded = readdirSync(join(dir, 'runtime/content/checks')).filter((f) => f.endsWith('.yaml')).sort();
    assert.deepEqual(seeded, starter);
    // node_modules: yaml + zod resolvable from sandbox cwd
    for (const dep of ['yaml', 'zod']) assert.ok(existsSync(join(dir, 'node_modules', dep)), dep);
    // baseline commit exists on origin main
    const log = execFileSync('git', ['-C', dir, 'log', 'origin/main', '--oneline'], { encoding: 'utf8' });
    assert.ok(log.includes('sandbox baseline'));
  } finally { cleanup(); }
});

test('rtFixture override wins over the shared bef fixture', async () => {
  const { dir, cleanup } = await buildRuntimeSandbox({ ...scenario, rtFixture: 'rt-smoke' }, 'HEAD');
  try { assert.ok(existsSync(join(dir, 'docs/backlog/rt-smoke-item.md'))); } finally { cleanup(); }
});
```

- [ ] **Step 2: Create the tiny rt-smoke fixture the test needs**

Create `scripts/parity-oracle/fixtures/rt/rt-smoke/backlog/rt-smoke-item.md`:

```markdown
---
id: rt-smoke-item
status: parking
type: bug
---

# rt-smoke-item
```

And `scripts/parity-oracle/fixtures/rt/rt-smoke/BACKLOG.md` with a matching index line:

```markdown
# BACKLOG

- [rt-smoke-item](backlog/rt-smoke-item.md)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test scripts/parity-oracle/test/runtime-sandbox.test.mjs`
Expected: FAIL — `Cannot find module '../runtime-sandbox.mjs'`.

- [ ] **Step 4: Write `runtime-sandbox.mjs`**

```js
// scripts/parity-oracle/runtime-sandbox.mjs — the runtime-side sandbox (mirror of bef sandbox.mjs).
// Same throwaway-git-repo pattern; seeds runtime/ (ref-aware) instead of .claude/skills. The check
// registry is REPLACED by the starter pack: Nestfolio content checks reference tools/*.mjs and repo
// paths absent in a sandbox — with them the gate would fail closed on evaluator errors, grading the
// sandbox, not the engine. Starter checks are portable by design (that IS the portability claim).
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, chmodSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BEF = join(HERE, '../benchmark-backlog');
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE }).toString().trim();
const git = (cwd, ...a) => execFileSync('git', a, { cwd });

/** Copy runtime/ from the working tree (ref 'HEAD'/null) or an exact git ref (git archive | tar). */
function copyRuntime(ref, destRoot) {
  if (ref === 'HEAD' || ref == null) {
    cpSync(join(REPO, 'runtime'), join(destRoot, 'runtime'), { recursive: true });
  } else {
    const archive = execFileSync('git', ['archive', ref, '--', 'runtime'], { cwd: REPO });
    execFileSync('tar', ['-x', '-C', destRoot], { input: archive });
  }
}

/** Same trimmed CLAUDE.md as the legacy sandbox — identical operating context on both sides. */
function extractSection(md, heading) {
  const start = md.indexOf(heading);
  if (start === -1) return '';
  const end = md.indexOf('\n## ', start + 1);
  return md.slice(start, end === -1 ? undefined : end);
}
function trimmedClaudeMd() {
  const md = execFileSync('cat', [join(REPO, 'CLAUDE.md')]).toString();
  return [extractSection(md, '## Backlog Discipline'), extractSection(md, '## Pre-authorized actions')].filter(Boolean).join('\n');
}

export async function buildRuntimeSandbox(scenario, ref) {
  const dir = mkdtempSync(join(tmpdir(), `po-${scenario.id}-`));
  const originDir = mkdtempSync(join(tmpdir(), `po-origin-${scenario.id}-`));
  git(originDir, 'init', '--bare', '-q');
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', originDir);
  writeFileSync(join(dir, 'package.json'), '{"name":"po-sandbox","version":"0.0.0","private":true}\n');

  // fixture → docs/ : rtFixture (parity-oracle derived copy) wins over the shared bef fixture
  const fixtureSrc = scenario.rtFixture
    ? join(HERE, 'fixtures/rt', scenario.rtFixture)
    : join(BEF, 'fixtures', scenario.fixture);
  cpSync(fixtureSrc, join(dir, 'docs'), { recursive: true });

  copyRuntime(ref, dir);
  // registry = starter pack only (portable); wipe Nestfolio content checks
  rmSync(join(dir, 'runtime/content/checks'), { recursive: true, force: true });
  mkdirSync(join(dir, 'runtime/content/checks'), { recursive: true });
  for (const f of readdirSync(join(dir, 'runtime/starter/checks')).filter((n) => n.endsWith('.yaml')))
    cpSync(join(dir, 'runtime/starter/checks', f), join(dir, 'runtime/content/checks', f));

  // node_modules: the runtime imports yaml + zod (zero-dep each) — symlink from the main repo
  mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
  for (const dep of ['yaml', 'zod']) {
    const src = join(REPO, 'node_modules', dep);
    if (existsSync(src)) symlinkSync(src, join(dir, 'node_modules', dep));
  }

  // same op stubs as the legacy sandbox — the "work" both engines do is the same work
  mkdirSync(join(dir, 'infrastructure/scripts'), { recursive: true });
  cpSync(join(BEF, 'stubs/deploy.sh'), join(dir, 'infrastructure/scripts/deploy.sh'));
  chmodSync(join(dir, 'infrastructure/scripts/deploy.sh'), 0o755);
  cpSync(join(BEF, 'stubs/nx'), join(dir, 'node_modules/.bin/nx'));
  chmodSync(join(dir, 'node_modules/.bin/nx'), 0o755);
  const binDir = join(dir, '.bin');
  mkdirSync(binDir, { recursive: true });
  cpSync(join(BEF, 'stubs/gh'), join(binDir, 'gh'));
  chmodSync(join(binDir, 'gh'), 0o755);

  writeFileSync(join(dir, 'CLAUDE.md'), trimmedClaudeMd());
  writeFileSync(join(dir, '.gitignore'), 'stubs.log\n');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.email=po@x', '-c', 'user.name=po', 'commit', '-qm', 'sandbox baseline');
  git(dir, 'branch', '-M', 'main');
  git(dir, 'push', '-q', 'origin', 'main');
  if (typeof scenario.setup === 'function') await scenario.setup({ dir, originDir, git, REPO });
  const cleanup = () => { rmSync(dir, { recursive: true, force: true }); rmSync(originDir, { recursive: true, force: true }); };
  return { dir, originDir, cleanup };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/parity-oracle/test/runtime-sandbox.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/parity-oracle/runtime-sandbox.mjs scripts/parity-oracle/test/runtime-sandbox.test.mjs scripts/parity-oracle/fixtures
git commit --no-verify -m "feat(parity-oracle): runtime-side sandbox builder (starter registry, no legacy skills)" && git log --oneline -1
```

---

### Task 4: `run-intake.mjs` — the headless intake driver (ring 2)

**Files:**
- Create: `runtime/adapters/claude-code/run-intake.mjs`
- Test: `runtime/adapters/claude-code/test/run-intake.test.mjs`

**Interfaces:**
- Consumes: `intake` from `runtime/engine/lib/intake.mjs` (`intake({finding, registry, backlog, capabilities}) → {finding, route, items, epic, rationale}`); `readItems` (`engine/lib/scope-gate.mjs`); `loadRegistry`; `pendingDecisions`/journal from `engine/lib/journal.mjs`; `makeClaudeCodeCapabilities` from `./index.mjs`.
- Produces: `driveIntake({finding, backlogDir, checksDir, fulfil, capabilities}) → {exit: 0|1|3, out}` + CLI `node runtime/adapters/claude-code/run-intake.mjs --finding <finding.json> [--fulfil <key> --value <json>]`. Exit codes: 0 done (items written) / 3 parked / 1 failed / 2 usage. runId `intake-<finding.id>`; the execute park key is `execute:intake-<finding.id>` (by construction: selectRoute's task id is `intake-<finding.id>` and the journal step key is `execute:<task.id>`). Item files are written by the driver (deterministic frontmatter render), not by the LLM.

**Design note (load-bearing):** `selectRoute` calls `capabilities.execute` and `JSON.parse`s `result.summary` — a parked TaskResult would crash it. The driver therefore wraps execute in a journal step: a park is intercepted (thrown as a sentinel, caught → exit 3); on replay the fulfilled TaskResult (whose `summary` is the route JSON provided by the operator) short-circuits the step and `selectRoute` parses it normally.

- [ ] **Step 1: Write the failing test**

```js
// runtime/adapters/claude-code/test/run-intake.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { driveIntake } from '../run-intake.mjs';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { makeExecute } from '../execute.mjs';

const finding = { id: 'f1', check: 'demo-check', kind: 'gap', scope: ['docs/**'], detail: 'demo gap finding' };

function caps() { return { execute: makeExecute({}), journal: inMemoryJournal() }; }

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'run-intake-'));
  mkdirSync(join(dir, 'backlog'), { recursive: true });
  mkdirSync(join(dir, 'checks'), { recursive: true });
  writeFileSync(join(dir, 'checks/demo.yaml'),
    'id: demo-check\nproperty: "demo"\nkind: gap\nevaluator: { type: deterministic, run: "cmd:true" }\ncost_tier: cheap\ncontexts: [audit]\nscope: { paths: ["docs/**"] }\nstatus: active\nprovenance: { minted_by: "test" }\n');
  return dir;
}

test('first invocation parks on the intake execute (exit 3, pending key by construction)', async () => {
  const dir = tmpStore();
  const r = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: caps() });
  assert.equal(r.exit, 3);
  assert.equal(r.out.pending[0].key, 'execute:intake-f1');
});

test('fulfilled route JSON → items written with epic/epic_role; journal filed record (exit 0)', async () => {
  const dir = tmpStore();
  const c = caps();
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: c });
  const taskResult = { taskId: 'intake-f1', status: 'done', summary: JSON.stringify({ route: 'fold', epic: 'acme-epic', epicRole: 'core' }) };
  const r2 = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: taskResult }, capabilities: c });
  assert.equal(r2.exit, 0);
  const file = join(dir, 'backlog/from-demo-check.md');
  assert.ok(existsSync(file));
  const text = readFileSync(file, 'utf8');
  assert.match(text, /epic: acme-epic/);
  assert.match(text, /epic_role: core/);
  assert.match(text, /from_finding: f1/);
  const filed = c.journal.read('intake-f1').steps.get('intake:f1:filed');
  assert.equal(filed.value.route, 'fold');
});

test('malformed route JSON in the fulfilled summary → exit 1, not a crash', async () => {
  const dir = tmpStore();
  const c = caps();
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: c });
  const r2 = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: { taskId: 'intake-f1', status: 'done', summary: 'not json' } }, capabilities: c });
  assert.equal(r2.exit, 1);
  assert.ok(String(r2.out.error).length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/adapters/claude-code/test/run-intake.test.mjs`
Expected: FAIL — `Cannot find module '../run-intake.mjs'`.

- [ ] **Step 3: Write `run-intake.mjs`**

```js
#!/usr/bin/env node
// runtime/adapters/claude-code/run-intake.mjs — the session-driven INTAKE driver (ring-2), the exact
// sibling of run-item.mjs for the forward edge's finding→items router. Park/fulfil binding: selectRoute's
// judgment task parks via the adapter execute; the session answers with a complete TaskResult whose
// summary is the route JSON; replay short-circuits and the driver writes the shaped item files
// deterministically (the frontmatter write is the project binding — it stays out of ring-1).
// Exit: 0 done / 3 parked / 1 failed / 2 usage.
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
import { intake } from '../../engine/lib/intake.mjs';
import { loadRegistry } from '../../engine/lib/load-registry.mjs';
import { readItems } from '../../engine/lib/scope-gate.mjs';
import { pendingDecisions } from '../../engine/lib/journal.mjs';
import { makeClaudeCodeCapabilities } from './index.mjs';

class IntakeParked extends Error {}

/** Render an abstract intake Item to a docs/backlog frontmatter file. Returns the written path. */
export function writeItemFile({ backlogDir, item, body = '' }) {
  const { id, ...fm } = item;
  mkdirSync(backlogDir, { recursive: true });
  const path = join(backlogDir, `${id}.md`);
  writeFileSync(path, `---\n${yaml.stringify({ id, ...fm }).trimEnd()}\n---\n\n# ${id}\n${body ? `\n${body}\n` : ''}`);
  return path;
}

export async function driveIntake({ finding, backlogDir, checksDir, fulfil, capabilities }) {
  const runId = `intake-${finding.id}`;
  const { journal } = capabilities;
  journal.begin(runId, { runId, auto: false });
  if (fulfil) journal.fulfil(runId, fulfil.key, fulfil.value);
  const registry = loadRegistry({ checksDir });
  let parked = null;
  const stepExecute = async (task) => {
    const r = await journal.step(runId, `execute:${task.id}`, () => capabilities.execute(task));
    if (r?.status === 'paused') { parked = r; throw new IntakeParked(); }
    return r;
  };
  let result;
  try {
    result = await intake({ finding, registry, backlog: readItems(backlogDir),
      capabilities: { ...capabilities, execute: stepExecute } });
  } catch (e) {
    if (e instanceof IntakeParked) return { exit: 3, out: { result: parked, pending: pendingDecisions(journal.read(runId)) } };
    return { exit: 1, out: { error: e.message } };
  }
  const written = result.items.map((item) => writeItemFile({ backlogDir, item, body: finding.detail }));
  journal.record(runId, `intake:${finding.id}:filed`, { route: result.route, files: written });
  return { exit: 0, out: { route: result.route, rationale: result.rationale, written } };
}

async function main() {
  const fi = process.argv.indexOf('--finding');
  const ff = process.argv.indexOf('--fulfil'); const vi = process.argv.indexOf('--value');
  const findingPath = fi >= 0 ? process.argv[fi + 1] : undefined;
  const fv = ff >= 0 ? process.argv[ff + 1] : undefined; const vv = vi >= 0 ? process.argv[vi + 1] : undefined;
  const badPair = ff >= 0 && (fv === undefined || fv.startsWith('--') || vv === undefined || vv.startsWith('--'));
  if (!findingPath || (ff >= 0) !== (vi >= 0) || badPair) {
    console.error('usage: run-intake.mjs --finding <finding.json> [--fulfil <key> --value <json>]'); process.exit(2);
  }
  const finding = JSON.parse(readFileSync(findingPath, 'utf8'));
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const capabilities = makeClaudeCodeCapabilities({});
  const { exit, out } = await driveIntake({ finding, backlogDir: cfg.backlogDir ?? 'docs/backlog',
    checksDir: cfg.checksDir, fulfil: ff >= 0 ? { key: fv, value: JSON.parse(vv) } : undefined, capabilities });
  console.log(JSON.stringify(out, null, 2));
  process.exit(exit);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test + the runtime suite + typecheck**

Run: `node --test runtime/adapters/claude-code/test/run-intake.test.mjs && node --test runtime/adapters/claude-code/test/*.test.mjs && npx tsc --noEmit -p runtime/tsconfig.json`
Expected: PASS (import-boundary tests unaffected — this is ring 2).

- [ ] **Step 5: Commit**

```bash
git add runtime/adapters/claude-code/run-intake.mjs runtime/adapters/claude-code/test/run-intake.test.mjs
git commit --no-verify -m "feat(runtime): run-intake.mjs headless intake driver (park/fulfil, ring-2)" && git log --oneline -1
```

---

### Task 5: `runtime-grade.mjs` — the journal-invariants grading layer

**Files:**
- Create: `scripts/parity-oracle/runtime-grade.mjs`
- Test: `scripts/parity-oracle/test/runtime-grade.test.mjs`

**Interfaces:**
- Consumes: `gradeScenario` from `../benchmark-backlog/grade.mjs`; `makeJournal`, `pendingDecisions` from `runtime/engine/lib/journal.mjs`.
- Produces: `gradeJournal(scenario, sandboxDir) → {pass, failures[]}` over `scenario.journal: [{runId, has: <stepKey>} | {runId, awaiting: <stepKey>} | {runId, absent: <stepKey>}]` (journal root = `<sandboxDir>/.git`); `gradeRuntimeScenario(scenario, runResult, sandboxDir, stubsLog) → {gatePass, golden, invariants, terminalOk, rubric, journal}` — bef's 3 layers AND the journal layer.

- [ ] **Step 1: Write the failing test**

```js
// scripts/parity-oracle/test/runtime-grade.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gradeJournal } from '../runtime-grade.mjs';
import { makeJournal } from '../../../runtime/engine/lib/journal.mjs';

function sandboxWithJournal() {
  const dir = mkdtempSync(join(tmpdir(), 'po-grade-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const j = makeJournal({ root: join(dir, '.git') });
  j.begin('item-x', { runId: 'item-x', auto: false });
  j.record('item-x', 'gate.start', { passed: true, findings: [] });
  j.awaiting('item-x', 'ship-x', { id: 'ship-x', question: 'Ship?', options: [] });
  return dir;
}

test('has / awaiting / absent journal assertions', () => {
  const dir = sandboxWithJournal();
  const ok = gradeJournal({ journal: [
    { runId: 'item-x', has: 'gate.start' },
    { runId: 'item-x', awaiting: 'ship-x' },
    { runId: 'item-x', absent: 'gate.ship' },
  ] }, dir);
  assert.deepEqual(ok, { pass: true, failures: [] });

  const bad = gradeJournal({ journal: [
    { runId: 'item-x', has: 'gate.ship' },          // never recorded
    { runId: 'item-x', absent: 'gate.start' },       // recorded → violation
    { runId: 'missing-run', has: 'anything' },       // FRESH ledger
  ] }, dir);
  assert.equal(bad.pass, false);
  assert.equal(bad.failures.length, 3);
});

test('no journal spec → vacuous pass', () => {
  assert.deepEqual(gradeJournal({}, '/nonexistent'), { pass: true, failures: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/parity-oracle/test/runtime-grade.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `runtime-grade.mjs`**

```js
// scripts/parity-oracle/runtime-grade.mjs — bef's 3 grading layers + the runtime's native evidence
// surface: journal invariants. A journal spec entry asserts a step key is complete ('has'), pending
// ('awaiting'), or absent from a runId's ledger (root = <sandbox>/.git, where the in-sandbox drivers
// write via makeJournal({}) → gitCommonDir()).
import { join } from 'node:path';
import { gradeScenario } from '../benchmark-backlog/grade.mjs';
import { makeJournal, pendingDecisions } from '../../runtime/engine/lib/journal.mjs';

export function gradeJournal(scenario, sandboxDir) {
  const failures = [];
  const specs = scenario.journal ?? [];
  if (!specs.length) return { pass: true, failures };
  const journal = makeJournal({ root: join(sandboxDir, '.git') });
  for (const spec of specs) {
    const ledger = journal.read(spec.runId);
    const step = (k) => ledger?.steps.get(k);
    if (spec.has && step(spec.has)?.status !== 'complete') failures.push(`journal ${spec.runId}: expected complete step "${spec.has}"`);
    if (spec.awaiting && !pendingDecisions(ledger).some((r) => r.key === spec.awaiting)) failures.push(`journal ${spec.runId}: expected awaiting "${spec.awaiting}"`);
    if (spec.absent && step(spec.absent)) failures.push(`journal ${spec.runId}: step "${spec.absent}" should be absent`);
  }
  return { pass: failures.length === 0, failures };
}

export async function gradeRuntimeScenario(scenario, runResult, sandboxDir, stubsLog) {
  const base = await gradeScenario(scenario, runResult, sandboxDir, stubsLog);
  const journal = gradeJournal(scenario, sandboxDir);
  return { ...base, journal, gatePass: base.gatePass && journal.pass };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/parity-oracle/test/runtime-grade.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/parity-oracle/runtime-grade.mjs scripts/parity-oracle/test/runtime-grade.test.mjs
git commit --no-verify -m "feat(parity-oracle): journal-invariants grading layer" && git log --oneline -1
```

---

### Task 6: rt scenario variants + parity structural lint + the two suites

**Files:**
- Create: `scripts/parity-oracle/scenarios/rt-<id>.scenario.mjs` — 11 files (7 intake + 4 worker; list in Step 3)
- Create: `scripts/parity-oracle/structural-lint.mjs`
- Create: `scripts/parity-oracle/suites.mjs`
- Test: `scripts/parity-oracle/test/scenarios-lint.test.mjs`, `scripts/parity-oracle/test/suites.test.mjs`

**Interfaces:**
- Consumes: legacy scenario default exports (`../benchmark-backlog/scenarios/<id>.scenario.mjs`), `OPERATOR_PROMPT`/`MAPPING` (Task 2), `buildRuntimeSandbox` (Task 3), `gradeRuntimeScenario` (Task 5), bef `buildSandbox`/`gradeScenario`/`defineSuite`/`STUB_BINARIES`.
- Produces: `loadSuites() → Promise<{legacySuite, runtimeSuite, pairs: [{id, legacy, runtime}]}>` (in `suites.mjs`; `pairs` covers exactly `mappedIds()`); `lintRtScenario(s) → string[]` (bef's closed key set + `journal`, `rtFixture`, `driver`).

- [ ] **Step 1: Write the failing lint + suites tests**

```js
// scripts/parity-oracle/test/scenarios-lint.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { lintRtScenario } from '../structural-lint.mjs';
import { MAPPING, mappedIds } from '../mapping.mjs';

const scenDir = new URL('../scenarios/', import.meta.url);

test('every mapped entry has its rt scenario file, and vice versa', () => {
  const files = readdirSync(scenDir).filter((f) => f.endsWith('.scenario.mjs')).sort();
  const expected = mappedIds().map((id) => MAPPING[id].runtime.scenario).sort();
  assert.deepEqual(files, expected);
});

test('every rt scenario passes structural lint', async () => {
  for (const f of readdirSync(scenDir).filter((x) => x.endsWith('.scenario.mjs'))) {
    const s = (await import(new URL(f, scenDir))).default;
    assert.deepEqual(lintRtScenario(s), [], f);
    assert.ok(s.id.startsWith('rt-'), `${f}: id must be rt-*`);
    assert.ok(s.prompt.includes('node runtime/adapters/claude-code/'), `${f}: prompt must drive a runtime driver`);
  }
});
```

```js
// scripts/parity-oracle/test/suites.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSuites } from '../suites.mjs';
import { mappedIds } from '../mapping.mjs';

test('loadSuites pairs exactly the mapped ids, both sides defineSuite-shaped', async () => {
  const { legacySuite, runtimeSuite, pairs } = await loadSuites();
  assert.deepEqual(pairs.map((p) => p.id).sort(), mappedIds().sort());
  for (const suite of [legacySuite, runtimeSuite]) {
    assert.equal(typeof suite.buildSandbox, 'function');
    assert.equal(typeof suite.grade, 'function');
    assert.ok(Array.isArray(suite.scenarios) && suite.scenarios.length > 0);
  }
  for (const p of pairs) {
    assert.equal(p.runtime.id, `rt-${p.legacy.id}`);
    assert.equal(p.runtime.fixture, p.legacy.fixture); // same input store (rtFixture may override the COPY, not the name)
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/parity-oracle/test/scenarios-lint.test.mjs scripts/parity-oracle/test/suites.test.mjs`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `structural-lint.mjs`, `suites.mjs`, and the 13 rt scenarios**

`structural-lint.mjs`:

```js
// scripts/parity-oracle/structural-lint.mjs — bef's closed-key discipline extended for rt scenarios.
// bef's own linter is NOT modified (its baseline stays untouched); rt scenarios get their own key set.
import { lintScenario } from '../benchmark-backlog/structural-lint.mjs';

const RT_EXTRA_KEYS = new Set(['journal', 'rtFixture', 'driver']);

export function lintRtScenario(s) {
  const stripped = Object.fromEntries(Object.entries(s).filter(([k]) => !RT_EXTRA_KEYS.has(k)));
  const v = lintScenario(stripped);
  for (const j of s.journal ?? []) {
    if (!j.runId) v.push('journal spec entry needs runId');
    if (!j.has && !j.awaiting && !j.absent) v.push('journal spec entry needs has|awaiting|absent');
  }
  if (s.driver && !['item', 'intake'].includes(s.driver)) v.push(`unknown driver "${s.driver}"`);
  return v;
}
```

`suites.mjs`:

```js
// scripts/parity-oracle/suites.mjs — assemble the two defineSuite instances + the mapped pairs.
import { readdirSync } from 'node:fs';
import { defineSuite } from '../benchmark-backlog/suite.mjs';
import { buildSandbox } from '../benchmark-backlog/sandbox.mjs';
import { gradeScenario } from '../benchmark-backlog/grade.mjs';
import { STUB_BINARIES } from '../benchmark-backlog/structural-lint.mjs';
import { buildRuntimeSandbox } from './runtime-sandbox.mjs';
import { gradeRuntimeScenario } from './runtime-grade.mjs';
import { MAPPING, mappedIds } from './mapping.mjs';

async function importAll(dirUrl) {
  const out = new Map();
  for (const f of readdirSync(dirUrl).filter((x) => x.endsWith('.scenario.mjs')))
    out.set(f.replace('.scenario.mjs', ''), (await import(new URL(f, dirUrl))).default);
  return out;
}

export async function loadSuites() {
  const legacyById = await importAll(new URL('../benchmark-backlog/scenarios/', import.meta.url));
  const rtById = await importAll(new URL('./scenarios/', import.meta.url));
  const pairs = mappedIds().map((id) => ({
    id,
    legacy: legacyById.get(id),
    runtime: rtById.get(MAPPING[id].runtime.scenario.replace('.scenario.mjs', '')),
  }));
  const legacySuite = defineSuite({ buildSandbox, stubs: STUB_BINARIES, grade: gradeScenario,
    scenarios: pairs.map((p) => p.legacy) });
  const runtimeSuite = defineSuite({ buildSandbox: buildRuntimeSandbox, stubs: STUB_BINARIES,
    grade: gradeRuntimeScenario, scenarios: pairs.map((p) => p.runtime) });
  return { legacySuite, runtimeSuite, pairs };
}
```

The 11 rt scenarios. Two shown in full; the remaining nine follow the same shape with the table below. **All import their legacy sibling and spread it first** so `fixture`/`timeoutMs` stay shared.

`scenarios/rt-add-fold-core.scenario.mjs` (full):

```js
import legacy from '../../benchmark-backlog/scenarios/add-fold-core.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// The finding text mirrors the legacy prompt's finding; the filed id follows the runtime slug
// convention (from-<finding.check>), NOT the legacy title-derived slug — parity is on the ROUTING
// OUTCOME (fold as core into the active epic), not on the filename convention.
const finding = {
  id: 'f-acme-error-contract', check: 'acme-interface-review', kind: 'gap', scope: ['docs/**'],
  detail: 'while redesigning the acme public interface that the acme epic is delivering, the new public interface has no error-return contract; the epic done_when requires the interface change to be merged, and an interface without its error contract is incomplete — part of the epic done-definition, not orthogonal.',
};

export default {
  ...legacy,
  id: 'rt-add-fold-core',
  driver: 'intake',
  setup: async ({ dir }) => {
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(dir, 'finding.json'), JSON.stringify(finding, null, 2));
  },
  prompt: OPERATOR_PROMPT(
    'Route the finding in ./finding.json through the runtime intake. Driver command: node runtime/adapters/claude-code/run-intake.mjs --finding finding.json — classify the route per the backlog-add epic-aware router rules in CLAUDE.md (this finding is load-bearing for the active epic done_when → fold as core).'),
  terminal: 'completed',
  golden: {
    frontmatter: { 'from-acme-interface-review': { epic: 'acme-epic', epic_role: 'core', status: 'parking' } },
  },
  journal: [{ runId: 'intake-f-acme-error-contract', has: 'intake:f-acme-error-contract:filed' }],
  rubric: ['The finding is load-bearing for the active acme epic done_when. Did the intake route it as fold with epic_role core (required for closure) rather than captured/orphan?'],
};
```

`scenarios/rt-next-lane-complex-ship.scenario.mjs` (full):

```js
import legacy from '../../benchmark-backlog/scenarios/next-lane-complex-ship.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Driver parity: the worker spine drives the same item the legacy /backlog-next drive-to-ship works.
// The run ends PARKED at the ship floor ask (the engine NEVER auto-ships) — the operator recognizes
// the non-execute pending decision and emits the pause sentinel. Work happens during the execute park.
export default {
  ...legacy,
  id: 'rt-next-lane-complex-ship',
  driver: 'item',
  prompt: OPERATOR_PROMPT(
    `Work the backlog item the fixture marks as queued rank 0 through the runtime worker. Driver command: node runtime/adapters/claude-code/run-item.mjs <item-id> — read docs/BACKLOG.md to find the top queued item id first. When parked on execute:<item-id>, perform the item's work as described in its backlog file (including any deploy the file calls for, via infrastructure/scripts/deploy.sh), commit your work, then fulfil. The ship decision is a floor decision.`),
  terminal: 'pause',
  // AUTHORING (enforced by the lint test — no unresolved fields may survive): read the legacy fixture,
  // set <item-id> to its queued-rank-0 item id, then make these concrete. Shown here for fixture item
  // id `ITEM` — substitute the real id everywhere:
  golden: undefined,                                // worker scenarios assert via state/callLog/journal, not frontmatter
  state: { fileContains: [{ file: 'docs/backlog/ITEM.md', needle: 'status' }] },  // replace with the legacy scenario's work-product assertion
  callLog: legacy.callLog,                          // same op assertions (deploy.sh fired, no gh pr merge)
  journal: [
    { runId: 'item-ITEM', has: 'gate.start' },
    { runId: 'item-ITEM', has: 'gate.ship' },
    { runId: 'item-ITEM', awaiting: 'ship-ITEM' },
  ],
  rubric: ['Did the runtime worker complete the item work, pass its gates, and stop at the ship floor without auto-shipping?'],
};
```

> **Authoring rule for the nine remaining files** (applies to the two above as well — the `null`/`undefined` placeholders in `rt-next-lane-complex-ship` above MUST be resolved by reading the legacy scenario + fixture at authoring time; the lint test rejects unresolved shapes): open the legacy scenario, keep `fixture`/`timeoutMs`/`callLog` semantics, replace `prompt` with `OPERATOR_PROMPT(<task line naming the driver command>)`, set `golden` to the runtime-outcome equivalent (intake files keyed by `from-<finding.check>`; worker scenarios keep the legacy golden minus skill-specific fields), and add `journal` assertions per the table:

| rt scenario | driver | terminal | golden core | journal assertions |
|---|---|---|---|---|
| rt-add-atomicity-split | intake | completed | two files `from-<check>-<a>`,`from-<check>-<b>` present (route split) | `intake-<fid>` has `intake:<fid>:filed` |
| rt-add-commit-scope | intake | completed | orphan file present, `state.fileContains` on it; operator commits (state.originMainContains n/a — working-tree commit asserted via `state.branchCreated: false` + fileContains) | filed record |
| rt-add-fold-captured | intake | completed | `epic: <active epic>`, `epic_role: captured` | filed record |
| rt-add-fold-core | intake | completed | (full file above) | (above) |
| rt-add-join-theme | intake | completed | `epic: <theme epic id>`, no `epic_role: core` demand | filed record |
| rt-add-mint-aggregation | intake | completed | `epic: <new aggregation id>` on filed item (mint-aggregation route) | filed record |
| rt-add-orphan | intake | completed | orphan file present, no `epic` key (`absent: [{file, field: 'epic'}]`) | filed record |
| rt-next-lane-complex-ship | item | pause | work-product `state.fileContains` + `callLog.called: ['deploy.sh']`, `neverCalled: ['gh pr merge']` | `item-<id>` has `gate.start`, has `gate.ship`, awaiting `ship-<id>` |
| rt-next-auto-floor-pause | item | pause | fixture item's work done | `item-<id>` awaiting `ship-<id>` |
| rt-next-auto-finishing-pr-stop | item | pause | same as floor-pause with the legacy fixture; `neverCalled: ['gh pr merge']` | awaiting `ship-<id>` |
| rt-next-preflight-dirty-stop | item | completed | out-of-scope dirt intact (scenario `setup` writes an unstaged file OUTSIDE the item scope, mirroring the legacy dirty-tree seed) | `item-<id>` has `gate.start` — and the operator's summary reports the gate blocked (rubric-verified); NO `execute:` step recorded (`absent`) |
| — | | | | |

(`<fid>` = the rt finding id defined in that scenario file; `<id>` = the fixture's item id, read from the legacy fixture at authoring time.)

- [ ] **Step 4: Run the tests until green**

Run: `node --test scripts/parity-oracle/test/scenarios-lint.test.mjs scripts/parity-oracle/test/suites.test.mjs`
Expected: PASS — in particular no unresolved `null`/`undefined` golden/journal fields (the lint test's journal-shape check catches them).

- [ ] **Step 5: Commit**

```bash
git add scripts/parity-oracle/scenarios scripts/parity-oracle/structural-lint.mjs scripts/parity-oracle/suites.mjs scripts/parity-oracle/test
git commit --no-verify -m "feat(parity-oracle): 13 rt scenario variants + suites + rt structural lint" && git log --oneline -1
```

---

### Task 7: `verdict.mjs` — dominance math

**Files:**
- Create: `scripts/parity-oracle/verdict.mjs`
- Test: `scripts/parity-oracle/test/verdict.test.mjs`

**Interfaces:**
- Consumes: aggregated rows (`aggregate()` shape, incl. optional `diagnostics`).
- Produces: `failureClasses(aggRow) → Set<string>`; `pairVerdict({legacy, runtime}) → {dominant: boolean, reasons: string[]}`; `overallParity({pairs, differential}) → {green, nonDominant: string[], redRules: string[]}`. D2 semantics: dominant ⇔ `runtime.gatePassRate >= legacy.gatePassRate` AND no failure class in runtime's diagnostics absent from legacy's. Tokens never gated.

- [ ] **Step 1: Write the failing test**

```js
// scripts/parity-oracle/test/verdict.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureClasses, pairVerdict, overallParity } from '../verdict.mjs';

const row = (gatePassRate, diagnostics) => ({ gatePassRate, tokens: { total: 1 }, diagnostics });

test('failureClasses normalizes diagnostics into class labels', () => {
  const c = failureClasses(row(0.5, {
    terminalOk: false,
    goldenFailures: ['x.status: expected "shipped", got "active"'],
    invariantFailures: ['expected call-log "deploy.sh" not found', 'run timed out'],
    rubricScores: null,
  }));
  assert.ok(c.has('terminal'));
  assert.ok(c.has('golden:x.status'));
  assert.ok(c.has('invariant:expected call-log "deploy.sh" not found'));
});

test('dominance: rate >= and no new failure class', () => {
  assert.equal(pairVerdict({ legacy: row(1), runtime: row(1) }).dominant, true);
  assert.equal(pairVerdict({ legacy: row(0.5, { invariantFailures: ['a'] }), runtime: row(1) }).dominant, true);
  const worse = pairVerdict({ legacy: row(1), runtime: row(0.5, { invariantFailures: ['a'] }) });
  assert.equal(worse.dominant, false);
  assert.ok(worse.reasons.some((r) => r.includes('gatePassRate')));
  // equal rate but a NEW class on the runtime side → not dominant
  const newClass = pairVerdict({
    legacy: row(0.5, { invariantFailures: ['a'] }),
    runtime: row(0.5, { invariantFailures: ['b'] }),
  });
  assert.equal(newClass.dominant, false);
});

test('errored rows are never dominant; overall parity composes pairs + differential', () => {
  assert.equal(pairVerdict({ legacy: row(1), runtime: { error: 'boom' } }).dominant, false);
  const parity = overallParity({
    pairs: [
      { id: 'p1', verdict: { dominant: true, reasons: [] } },
      { id: 'p2', verdict: { dominant: false, reasons: ['x'] } },
    ],
    differential: { rows: [
      { rule: 'r1', mapped: true, class: 'legacy-only' },
      { rule: 'r5', mapped: false, class: 'legacy-only' },
    ] },
  });
  assert.equal(parity.green, false);
  assert.deepEqual(parity.nonDominant, ['p2']);
  assert.deepEqual(parity.redRules, ['r1']);   // unmapped legacy-only rows are honest gaps, not red
});
```

- [ ] **Step 2: Run test to verify it fails** — `node --test scripts/parity-oracle/test/verdict.test.mjs` → module not found.

- [ ] **Step 3: Write `verdict.mjs`**

```js
// scripts/parity-oracle/verdict.mjs — pure D2 dominance math. A failure CLASS is a normalized label
// from an aggregate row's diagnostics: 'terminal', 'golden:<field path>' (text before the first ':'),
// or 'invariant:<full failure string>'. Tokens are never part of the verdict (D2).
export function failureClasses(row) {
  const d = row?.diagnostics;
  const classes = new Set();
  if (!d) return classes;
  if (d.terminalOk === false) classes.add('terminal');
  for (const f of d.goldenFailures ?? []) classes.add(`golden:${String(f).split(':')[0].trim()}`);
  for (const f of d.invariantFailures ?? []) classes.add(`invariant:${String(f).trim()}`);
  return classes;
}

export function pairVerdict({ legacy, runtime }) {
  if (legacy?.error || runtime?.error) return { dominant: false, reasons: [`errored: ${legacy?.error ?? runtime?.error}`] };
  const reasons = [];
  if (runtime.gatePassRate < legacy.gatePassRate) reasons.push(`gatePassRate ${runtime.gatePassRate} < legacy ${legacy.gatePassRate}`);
  const legacyClasses = failureClasses(legacy);
  for (const c of failureClasses(runtime)) if (!legacyClasses.has(c)) reasons.push(`new failure class: ${c}`);
  return { dominant: reasons.length === 0, reasons };
}

export function overallParity({ pairs, differential }) {
  const nonDominant = pairs.filter((p) => !p.verdict.dominant).map((p) => p.id);
  const redRules = (differential?.rows ?? []).filter((r) => r.mapped && r.class === 'legacy-only').map((r) => r.rule);
  return { green: nonDominant.length === 0 && redRules.length === 0, nonDominant, redRules };
}
```

- [ ] **Step 4: Run test** — PASS. **Step 5: Commit**

```bash
git add scripts/parity-oracle/verdict.mjs scripts/parity-oracle/test/verdict.test.mjs
git commit --no-verify -m "feat(parity-oracle): strict-dominance verdict math (D2)" && git log --oneline -1
```

---

### Task 8: lint differential — `store-sandbox.mjs`, `lint-differential.mjs`, per-rule fixtures

**Files:**
- Create: `scripts/parity-oracle/store-sandbox.mjs`, `scripts/parity-oracle/lint-differential.mjs`
- Create: `scripts/parity-oracle/fixtures/lint/<rule>/{good,bad}/…` (inventory below)
- Test: `scripts/parity-oracle/test/lint-differential.test.mjs`

**Interfaces:**
- Consumes: `.claude/skills/backlog-lint/lint.mjs` (spawned; exit 0 = clean), `runtime/engine/lib/run-watch.mjs` CLI (`--on=manual`; exit 0 clean / 1 findings / 2 crash), starter + selected content check YAMLs.
- Produces: `buildStoreSandbox({fixtureDir}) → {dir, cleanup}` (temp git repo: fixture → `docs/`, working-tree `runtime/` with registry seeded from `SEED_CHECKS`, `.claude/skills/backlog-lint` copied, `yaml`+`zod` symlinks); `RULE_MAP` (all 11 rules + index + element-shape); `runDifferential() → {rows: [{rule, checks, mapped, class, legacy, runtime}]}` with `class ∈ both-catch | legacy-only | runtime-only | both-miss | good-false-positive`.

- [ ] **Step 1: Author the fixture inventory.** Each fixture is a store: `BACKLOG.md` + `backlog/*.md`. Every `bad/` violates EXACTLY its rule; every `good/` is the minimal clean twin. All items otherwise ItemSchema-valid (`id`, `status`, `type`). Complete inventory (create all 24):

| fixture | bad/ content (the violation) | good/ twin |
|---|---|---|
| `r1-id-matches-filename` | `backlog/wrong-name.md` with `id: other-name` | id == filename |
| `r2-single-active` | two non-epic items both `status: active` (each with `out_of_scope: ["x"]`) | one active |
| `r3-references-valid` | `type: design`, `status: parking`, `references: ["docs/missing-file.md#nope"]` | reference to a real file committed in the fixture (`docs/spec.md` with the anchor) |
| `r4-active-out-of-scope` | `status: active` with `out_of_scope: []` (plus one other clean parking item) | `out_of_scope: ["x"]` |
| `r5-shipped-validation-gate` | `status: shipped` with `validation_gate: null` | `validation_gate: "evidence"` |
| `r6-queued-ranks` | two `status: queued` items both `rank: 1` | ranks 1 and 2 |
| `r8-promotion-trigger` | `status: queued`, `rank: 1`, body contains "Promote when the deps ship." | body without trigger language |
| `r9-epic-closure` | `type: epic, status: shipped, validation_gate: "x"` + member `epic: <it>, epic_role: core, status: parking` | member `status: shipped, validation_gate: "x"` |
| `r10-epic-pointer` | member `epic: not-an-epic` where `not-an-epic.md` is `type: bug` | pointer to a real `type: epic` file |
| `r11-single-active-epic` | two `type: epic` both `status: active` (with `out_of_scope`, `done_when`, `scope` non-empty) | one active epic |
| `index-matches` | `BACKLOG.md` omits an existing parking item | index lists it |
| `element-shape` | `out_of_scope: [{oops: true}]` (object inside the list — the class legacy lint is blind to) | `out_of_scope: ["x"]` |

Every fixture's `BACKLOG.md` must otherwise match its items (only `index-matches/bad` breaks that on purpose) — author by copying the render format from an existing bef fixture's `BACKLOG.md`.

- [ ] **Step 2: Write the failing test**

```js
// scripts/parity-oracle/test/lint-differential.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULE_MAP, runDifferential } from '../lint-differential.mjs';

test('RULE_MAP totality: all 11 lint rules + index + element-shape present', () => {
  const rules = RULE_MAP.map((r) => r.rule);
  for (const r of ['r1-id-matches-filename', 'r2-single-active', 'r3-references-valid', 'r4-active-out-of-scope',
    'r5-shipped-validation-gate', 'r6-queued-ranks', 'r8-promotion-trigger', 'r9-epic-closure',
    'r10-epic-pointer', 'r11-single-active-epic', 'index-matches', 'element-shape']) {
    assert.ok(rules.includes(r), r);
  }
  for (const row of RULE_MAP) if (row.mapped) assert.ok(row.checks.length > 0, `${row.rule}: mapped needs checks`);
});

test('differential over all fixtures: expected classes (THE deterministic parity table)', async () => {
  const { rows } = await runDifferential();
  const byRule = Object.fromEntries(rows.map((r) => [r.rule, r]));
  // mapped rules: runtime must catch what legacy catches
  for (const rule of ['r1-id-matches-filename', 'r2-single-active', 'r3-references-valid', 'r11-single-active-epic', 'index-matches'])
    assert.equal(byRule[rule].class, 'both-catch', `${rule}: ${JSON.stringify(byRule[rule])}`);
  // unmapped rules: legacy-only is the HONEST gap (feeds P4), never red here
  for (const rule of ['r4-active-out-of-scope', 'r5-shipped-validation-gate', 'r6-queued-ranks', 'r8-promotion-trigger', 'r9-epic-closure', 'r10-epic-pointer'])
    assert.equal(byRule[rule].class, 'legacy-only', rule);
  // the runtime-only bonus: the element-shape class legacy lint is blind to
  assert.equal(byRule['element-shape'].class, 'runtime-only');
  // no good fixture may false-positive on either engine
  assert.ok(rows.every((r) => r.class !== 'good-false-positive'), JSON.stringify(rows.filter((r) => r.class === 'good-false-positive')));
});
```

- [ ] **Step 3: Run test to verify it fails** — module not found.

- [ ] **Step 4: Write `store-sandbox.mjs` + `lint-differential.mjs`**

```js
// scripts/parity-oracle/store-sandbox.mjs — a minimal store sandbox for the deterministic differential:
// fixture → docs/, working-tree runtime/ with the registry seeded from SEED_CHECKS, the legacy
// backlog-lint skill, yaml+zod symlinks, git init+commit (scope-gate shells `git diff`).
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE }).toString().trim();

// The differential registry: the 6 starter checks + the two store-content checks. registry-integrity is
// EXCLUDED — the meta-check asserts repo-level surface↔entry wiring that a fixture sandbox doesn't carry;
// including it would grade the sandbox, not the store. Tune here if bring-up shows another env-dependent check.
export const SEED_CHECKS = {
  starter: ['single-active.yaml', 'active-item-scope-gate.yaml', 'references-valid.yaml', 'index-fresh.yaml', 'no-unsafe-casts.yaml'],
  content: ['item-store-valid.yaml', 'backlog-id-matches-filename.yaml'],
};

export function buildStoreSandbox({ fixtureDir }) {
  const dir = mkdtempSync(join(tmpdir(), 'po-diff-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), '{"name":"po-diff","version":"0.0.0","private":true}\n');
  cpSync(fixtureDir, join(dir, 'docs'), { recursive: true });
  cpSync(join(REPO, 'runtime'), join(dir, 'runtime'), { recursive: true });
  rmSync(join(dir, 'runtime/content/checks'), { recursive: true, force: true });
  mkdirSync(join(dir, 'runtime/content/checks'), { recursive: true });
  for (const f of SEED_CHECKS.starter) cpSync(join(dir, 'runtime/starter/checks', f), join(dir, 'runtime/content/checks', f));
  for (const f of SEED_CHECKS.content) cpSync(join(REPO, 'runtime/content/checks', f), join(dir, 'runtime/content/checks', f));
  mkdirSync(join(dir, '.claude/skills'), { recursive: true });
  cpSync(join(REPO, '.claude/skills/backlog-lint'), join(dir, '.claude/skills/backlog-lint'), { recursive: true });
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  for (const dep of ['yaml', 'zod']) if (existsSync(join(REPO, 'node_modules', dep))) symlinkSync(join(REPO, 'node_modules', dep), join(dir, 'node_modules', dep));
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=po@x', '-c', 'user.name=po', 'commit', '-qm', 'store'], { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
```

```js
// scripts/parity-oracle/lint-differential.mjs — the deterministic half of lint parity: run BOTH engines
// over shared per-rule good/bad stores and classify. No LLM. Legacy = backlog-lint lint.mjs (exit code);
// runtime = run-watch --on=manual over the seeded registry (exit code; 2 = crash = treated as no-catch
// AND surfaced). classes: both-catch | legacy-only | runtime-only | both-miss | good-false-positive.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStoreSandbox } from './store-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const RULE_MAP = [
  { rule: 'r1-id-matches-filename', checks: ['backlog-id-matches-filename'], mapped: true },
  { rule: 'r2-single-active', checks: ['single-active'], mapped: true },
  { rule: 'r3-references-valid', checks: ['references-valid'], mapped: true },
  { rule: 'r4-active-out-of-scope', checks: [], mapped: false },
  { rule: 'r5-shipped-validation-gate', checks: [], mapped: false },
  { rule: 'r6-queued-ranks', checks: [], mapped: false },
  { rule: 'r8-promotion-trigger', checks: [], mapped: false },
  { rule: 'r9-epic-closure', checks: [], mapped: false },
  { rule: 'r10-epic-pointer', checks: [], mapped: false },
  { rule: 'r11-single-active-epic', checks: ['single-active'], mapped: true },
  { rule: 'index-matches', checks: ['index-fresh'], mapped: true },
  { rule: 'element-shape', checks: ['item-store-valid'], mapped: true, runtimeOnly: true },
];

function legacyExit(dir) {
  const r = spawnSync('node', ['.claude/skills/backlog-lint/lint.mjs'], { cwd: dir, encoding: 'utf8',
    env: { ...process.env, NESTFOLIO_MEMORY_DIR: join(dir, '.mem') } });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}
function runtimeExit(dir) {
  const r = spawnSync('node', ['runtime/engine/lib/run-watch.mjs', '--on=manual'], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}
const caught = (x) => x.code !== 0;   // exit 1 findings, exit 2 crash — a crash is NOT a catch, see classify

function classify({ row, bad, good }) {
  if (good.legacy.code !== 0 || good.runtime.code === 1) return 'good-false-positive';
  const l = caught(bad.legacy), r = bad.runtime.code === 1;   // runtime exit 2 (crash) ≠ a catch
  if (l && r) return row.runtimeOnly ? 'runtime-only-expected-legacy-caught' : 'both-catch';
  if (l && !r) return 'legacy-only';
  if (!l && r) return 'runtime-only';
  return 'both-miss';
}

export async function runDifferential() {
  const fixturesRoot = join(HERE, 'fixtures/lint');
  const rows = [];
  for (const row of RULE_MAP) {
    const run = (kind) => {
      const { dir, cleanup } = buildStoreSandbox({ fixtureDir: join(fixturesRoot, row.rule, kind) });
      try { return { legacy: legacyExit(dir), runtime: runtimeExit(dir) }; } finally { cleanup(); }
    };
    const bad = run('bad'), good = run('good');
    rows.push({ rule: row.rule, checks: row.checks, mapped: row.mapped,
      class: classify({ row, bad, good }),
      legacy: { bad: bad.legacy.code, good: good.legacy.code },
      runtime: { bad: bad.runtime.code, good: good.runtime.code } });
  }
  return { rows };
}

async function main() {
  const { rows } = await runDifferential();
  for (const r of rows) console.log(`${r.rule}\t${r.class}\tlegacy bad=${r.legacy.bad} good=${r.legacy.good}\truntime bad=${r.runtime.bad} good=${r.runtime.good}`);
  const red = rows.filter((r) => r.mapped && r.class === 'legacy-only');
  process.exit(red.length ? 1 : 0);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 5: Run the differential test; iterate fixtures until the class table matches.** This step IS the deterministic bring-up: expect issues like `element-shape/bad` making `single-active`'s `readItems` throw (exit 1 from the cmd evaluator → looks like a catch by the wrong check — acceptable: class is per-rule verdict, runtime caught the bad store) and index-render format drift in hand-authored `BACKLOG.md`. Fix FIXTURES (and, only if a seeded check is env-dependent, `SEED_CHECKS`) — never the engines.

Run: `node --test scripts/parity-oracle/test/lint-differential.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/parity-oracle/store-sandbox.mjs scripts/parity-oracle/lint-differential.mjs scripts/parity-oracle/fixtures/lint scripts/parity-oracle/test/lint-differential.test.mjs
git commit --no-verify -m "feat(parity-oracle): deterministic lint differential (11 rules vs registry)" && git log --oneline -1
```

---

### Task 9: `run.mjs` — parity CLI (parity | differential | rebaseline | compare) + report

**Files:**
- Create: `scripts/parity-oracle/run.mjs`, `scripts/parity-oracle/parity-report.mjs`
- Test: `scripts/parity-oracle/test/run-loop.test.mjs`, `scripts/parity-oracle/test/parity-report.test.mjs`

**Interfaces:**
- Consumes: `loadSuites` (Task 6), `defaultRunOne`/`aggregate`/`PAUSE_CONVENTION` (Task 1), `pairVerdict`/`overallParity` (Task 7), `runDifferential` (Task 8), bef `writeReport`/`flagBands`.
- Produces:
  - `runParity({opts, pairs, legacySuite, runtimeSuite}) → rows: [{id, legacy: aggRow, runtime: aggRow, verdict}]` — interleaved L,R per iteration; per-pair try/catch (an errored pair is a non-dominant row, sweep continues); `opts.runOneLegacy`/`opts.runOneRuntime` injectable for tests.
  - `compareToBaseline({rows, baseline}) → {regressions: [{id, reason}]}` — regression ⇔ `runtime.gatePassRate` dropped vs baseline row OR dominant flipped true→false.
  - CLI: `node scripts/parity-oracle/run.mjs <parity|differential|rebaseline|compare> [--scenario=id1,id2] [--iterations=N] [--model=…] [--keep]`. `parity`/`compare` exit non-zero on red/regression. `rebaseline` writes `parity-baseline.json` + `parity-baseline.provenance.json` via scratch→validate→rename (crash-safe). Every mode writes a markdown report to `benchmarks/parity-oracle/` and prints the path to stderr.
  - `parity-report.mjs`: `buildParityReport({mode, rows, differential, mapping, model, generatedAt}) → markdown` — parity table (`pair | legacy gate | rt gate | legacy totTok | rt totTok | verdict`), differential table, and ALWAYS the unmapped-rows table (id + reason — the P5 checklist; no silent caps).

- [ ] **Step 1: Write the failing tests.** `run-loop.test.mjs` drives `runParity` with injected `runOneLegacy`/`runOneRuntime` thunks (no live claude): asserts interleaving order (L,R,L,R via a shared call-log array), aggregation, verdict attachment, error isolation (one throwing pair → `verdict.dominant === false`, other pairs still run), and `--scenario` filtering. `compareToBaseline`: gate drop → regression; flat → none. `parity-report.test.mjs`: report contains the three tables, every unmapped id + reason, and the PARITY GREEN/RED headline.

```js
// scripts/parity-oracle/test/run-loop.test.mjs (core shape — write all assertions listed above)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runParity, compareToBaseline } from '../run.mjs';

const fakeRun = (log, tag, gatePass) => async (s) => {
  log.push(`${tag}:${s.id}`);
  return { gatePass, numTurns: 1, costUsd: 0, rr: { perTurn: [{ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }] } };
};

test('interleaves legacy/runtime per iteration and attaches verdicts', async () => {
  const log = [];
  const pairs = [{ id: 'a', legacy: { id: 'a' }, runtime: { id: 'rt-a' } }];
  const rows = await runParity({ opts: { iterations: 2, runOneLegacy: fakeRun(log, 'L', true), runOneRuntime: fakeRun(log, 'R', true) }, pairs });
  assert.deepEqual(log, ['L:a', 'R:rt-a', 'L:a', 'R:rt-a']);
  assert.equal(rows[0].verdict.dominant, true);
});

test('an errored pair is non-dominant and does not abort the sweep', async () => {
  const boom = async () => { throw new Error('boom'); };
  const log = [];
  const pairs = [
    { id: 'bad', legacy: { id: 'bad' }, runtime: { id: 'rt-bad' } },
    { id: 'ok', legacy: { id: 'ok' }, runtime: { id: 'rt-ok' } },
  ];
  const rows = await runParity({ opts: { iterations: 1, runOneLegacy: boom, runOneRuntime: fakeRun(log, 'R', true) }, pairs });
  assert.equal(rows[0].verdict.dominant, false);
  assert.equal(rows[1].verdict.dominant, true);
});

test('compareToBaseline flags gate drops and verdict flips', () => {
  const baseline = { pairs: [{ id: 'a', runtime: { gatePassRate: 1 }, verdict: { dominant: true } }] };
  const rows = [{ id: 'a', runtime: { gatePassRate: 0.5 }, legacy: { gatePassRate: 0.5 }, verdict: { dominant: true } }];
  const { regressions } = compareToBaseline({ rows, baseline });
  assert.equal(regressions.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail** — modules not found.

- [ ] **Step 3: Implement `run.mjs` + `parity-report.mjs`.** `runParity` core:

```js
export async function runParity({ opts, pairs, legacySuite, runtimeSuite }) {
  const iterations = Number(opts.iterations ?? 1);
  const runL = opts.runOneLegacy ?? defaultRunOne(legacySuite, opts);
  const runR = opts.runOneRuntime ?? defaultRunOne(runtimeSuite, opts);
  const only = opts.scenario ? new Set(String(opts.scenario).split(',').map((s) => s.trim())) : null;
  const progress = (m) => process.stderr.write(`[po] ${m}\n`);
  const rows = [];
  for (const p of pairs.filter((x) => !only || only.has(x.id))) {
    progress(`parity ${p.id} x${iterations}`);
    try {
      const a = [], b = [];
      for (let i = 0; i < iterations; i++) { a.push(await runL(p.legacy, 'HEAD')); b.push(await runR(p.runtime, 'HEAD')); }
      const legacy = aggregate(a), runtime = aggregate(b);
      rows.push({ id: p.id, legacy, runtime, verdict: pairVerdict({ legacy, runtime }) });
    } catch (e) {
      progress(`parity ${p.id} ERRORED: ${e?.message ?? e}`);
      rows.push({ id: p.id, error: String(e?.message ?? e), verdict: { dominant: false, reasons: [`errored: ${e?.message ?? e}`] } });
    }
  }
  return rows;
}
```

Baseline write (rebaseline mode) — crash-safe:

```js
const scratch = join(tmpdir(), `parity-baseline-${process.pid}.json`);
writeFileSync(scratch, JSON.stringify({ pairs: rows, differential: diff.rows }, null, 2));
JSON.parse(readFileSync(scratch, 'utf8'));                       // validate before touching the committed file
cpSync(scratch, join(HERE, 'parity-baseline.json'));
writeFileSync(join(HERE, 'parity-baseline.provenance.json'), JSON.stringify({
  generatedAt, model: opts.model ?? 'claude-opus-4-8', iterations, sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: HERE }).toString().trim(),
}, null, 2));
```

CLI `main()`: parse `--k=v`/bare flags exactly like bef run.mjs; dispatch modes; always `buildParityReport` + `writeReport({dir: join(process.cwd(), 'benchmarks', 'parity-oracle'), …})` + stderr path; exit codes: `parity` → `overallParity(...).green ? 0 : 1`; `differential` → red-mapped-rules ? 1 : 0; `compare` → regressions ? 1 : 0.

- [ ] **Step 4: Run all parity-oracle unit tests** — `node --test scripts/parity-oracle/test/*.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/parity-oracle/run.mjs scripts/parity-oracle/parity-report.mjs scripts/parity-oracle/test
git commit --no-verify -m "feat(parity-oracle): parity/differential/rebaseline/compare CLI + report" && git log --oneline -1
```

---

### Task 10: Greenfield adoption e2e (deterministic)

**Files:**
- Create: `runtime/eval/e2e/greenfield.test.mjs`
- Modify: `runtime/project.json` — add `runtime/eval/e2e/*.test.mjs` to the `test` target's glob list (read the existing target first and append in the same format).

**Interfaces:**
- Consumes: `runtime/cli.mjs` (`init`), `runtime/adapters/git/pre-commit-gate.mjs` (as the pre-commit hook), `runtime/adapters/claude-code/run-backward.mjs` (mint/curate park→fulfil; decision ids `mint-<check>-g1` / `curate-<check>-g1`; fulfil value `{"decisionId":"<id>","value":"ratify"|"retire"}`), `CandidateDraftSchema` (proposal = `{entry, eval_scenario, rationale}`, `entry.status: 'candidate'`, no `provenance.ratified`).
- Produces: the full-loop cold-start proof; sandbox contains ONLY `runtime/` + a minimal store + git.

- [ ] **Step 1: Write the e2e (it will fail at the first unbuilt assertion — that's the TDD loop for this task; iterate to green fixing TEST assumptions, never engine code).** Full test:

```js
// runtime/eval/e2e/greenfield.test.mjs — the greenfield adoption e2e (parity-oracle deliverable d).
// A bare repo + runtime/ only: init seeds starter checks → a violation commit is BLOCKED → a check is
// MINTED at the floor (park→fulfil) and has teeth → CURATE retires it → the commit passes. The test
// plays the human via --fulfil. No LLM, no Nestfolio content. Cold-start/portability proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, symlinkSync, chmodSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: join(HERE, '..') }).toString().trim();
const sh = (dir, cmd, args, env = {}) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
const git = (dir, ...a) => sh(dir, 'git', ['-c', 'user.email=gf@x', '-c', 'user.name=gf', ...a]);

function buildGreenfield() {
  const dir = mkdtempSync(join(tmpdir(), 'greenfield-'));
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'package.json'), '{"name":"greenfield","version":"0.0.0","private":true}\n');
  cpSync(join(REPO, 'runtime'), join(dir, 'runtime'), { recursive: true });
  // greenfield = EMPTY content ring; init seeds it. Keep triggers.yaml (cadence config ships with runtime/).
  for (const sub of ['checks', 'lessons']) {
    const p = join(dir, 'runtime/content', sub);
    if (existsSync(p)) { execFileSync('rm', ['-rf', p]); mkdirSync(p, { recursive: true }); }
  }
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  for (const dep of ['yaml', 'zod']) symlinkSync(join(REPO, 'node_modules', dep), join(dir, 'node_modules', dep));
  // minimal governed store: one parking item + matching index (index-fresh + single-active hold)
  mkdirSync(join(dir, 'docs/backlog'), { recursive: true });
  writeFileSync(join(dir, 'docs/backlog/seed-item.md'), '---\nid: seed-item\nstatus: parking\ntype: bug\n---\n\n# seed-item\n');
  writeFileSync(join(dir, 'docs/BACKLOG.md'), '# BACKLOG\n\n- [seed-item](backlog/seed-item.md)\n');
  writeFileSync(join(dir, '.git/hooks/pre-commit'), '#!/bin/sh\nexec node runtime/adapters/git/pre-commit-gate.mjs\n');
  chmodSync(join(dir, '.git/hooks/pre-commit'), 0o755);
  git(dir, 'add', '-A');
  const c = git(dir, 'commit', '-qm', 'greenfield baseline', '-q');
  assert.equal(c.status, 0, c.stderr); // baseline commit passes the (not-yet-seeded → empty-registry) gate? see init order below
  return dir;
}

test('greenfield: init → violation blocked → mint has teeth → curate → pass', async (t) => {
  const dir = buildGreenfield();

  // 1. init seeds the starter registry (AFTER baseline commit so the baseline needn't pass gates)
  const init = sh(dir, 'node', ['runtime/cli.mjs', 'init']);
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /seeded \d+ starter checks/);
  const reg = sh(dir, 'node', ['runtime/engine/lib/load-registry.mjs', '--checks-dir', 'runtime/content/checks']);
  assert.equal(reg.status, 0, reg.stdout + reg.stderr);
  git(dir, 'add', '-A'); assert.equal(git(dir, 'commit', '-qm', 'init starter pack').status, 0);

  // 2. a starter-check violation is BLOCKED at commit (no-unsafe-casts scans services/**)
  mkdirSync(join(dir, 'services/demo/api/src'), { recursive: true });
  writeFileSync(join(dir, 'services/demo/api/src/bad.ts'), 'export const x = (1 as unknown as string);\n');
  git(dir, 'add', '-A');
  const blocked = git(dir, 'commit', '-qm', 'violation');
  assert.notEqual(blocked.status, 0, 'gate must block the unsafe-cast commit');
  assert.match(blocked.stderr + blocked.stdout, /no-unsafe-casts/);
  git(dir, 'reset', '-q'); execFileSync('rm', ['-rf', join(dir, 'services')]);

  // 3. mint a NEW check at the floor (park → fulfil ratify)
  mkdirSync(join(dir, 'eval-checks'), { recursive: true });
  writeFileSync(join(dir, 'eval-checks/no-forbidden-todo.mjs'),
    `#!/usr/bin/env node\nimport { execSync } from 'node:child_process';\nlet out = '';\ntry { out = execSync("grep -rn 'TODO-FORBIDDEN' src services 2>/dev/null || true", { encoding: 'utf8' }); } catch {}\nif (out.trim()) { console.log(out.trim()); process.exit(1); }\nprocess.exit(0);\n`);
  writeFileSync(join(dir, 'lesson.md'), '# lesson: forbidden TODO markers\nTODO-FORBIDDEN markers rotted in prod.\n');
  const proposal = {
    entry: {
      id: 'no-forbidden-todo', property: 'no TODO-FORBIDDEN markers in source', kind: 'drift',
      evaluator: { type: 'deterministic', run: 'cmd:node eval-checks/no-forbidden-todo.mjs' },
      cost_tier: 'cheap', contexts: ['invariant', 'gate'], scope: { paths: ['src/**', 'services/**'] },
      status: 'candidate', provenance: { minted_by: 'greenfield-e2e', lesson: 'lesson.md' },
    },
    eval_scenario: { path: 'runtime/eval/scenarios/no-forbidden-todo.scenario.mjs', fixtures: { good: ['src/ok.ts'], bad: ['src/bad.ts'] }, target_pass_rate: 1 },
    rationale: 'mechanizable, recurring, still intended (greenfield proof)',
  };
  writeFileSync(join(dir, 'proposal.json'), JSON.stringify(proposal, null, 2));
  git(dir, 'add', '-A'); assert.equal(git(dir, 'commit', '-qm', 'mint inputs').status, 0);

  const mint1 = sh(dir, 'node', ['runtime/adapters/claude-code/run-backward.mjs', 'mint', '--item', 'seed-item', '--lesson', 'lesson.md', '--proposal', 'proposal.json']);
  assert.equal(mint1.status, 3, `expected park, got ${mint1.status}: ${mint1.stdout} ${mint1.stderr}`);
  const pending = JSON.parse(mint1.stdout).pending;
  const mintKey = pending.find((p) => p.key.startsWith('mint-no-forbidden-todo')).key;
  const mint2 = sh(dir, 'node', ['runtime/adapters/claude-code/run-backward.mjs', 'mint', '--item', 'seed-item', '--lesson', 'lesson.md', '--proposal', 'proposal.json',
    '--fulfil', mintKey, '--value', JSON.stringify({ decisionId: mintKey, value: 'ratify' })]);
  assert.equal(mint2.status, 0, mint2.stdout + mint2.stderr);
  const minted = parse(readFileSync(join(dir, 'runtime/content/checks/no-forbidden-todo.yaml'), 'utf8'));
  assert.equal(minted.status, 'active');
  assert.ok(minted.provenance.ratified, 'ratify stamps provenance.ratified');
  assert.ok(existsSync(join(dir, 'runtime/eval/scenarios/no-forbidden-todo.scenario.mjs')), 'eval scenario landed');
  git(dir, 'add', '-A'); assert.equal(git(dir, 'commit', '-qm', 'minted check').status, 0);

  // 4. the minted check has TEETH
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/todo.ts'), '// TODO-FORBIDDEN: fix later\n');
  git(dir, 'add', '-A');
  const blocked2 = git(dir, 'commit', '-qm', 'todo violation');
  assert.notEqual(blocked2.status, 0);
  assert.match(blocked2.stderr + blocked2.stdout, /no-forbidden-todo/);

  // 5. curate: retire at the floor → the same commit now passes
  const cur1 = sh(dir, 'node', ['runtime/adapters/claude-code/run-backward.mjs', 'curate', '--check', 'no-forbidden-todo', '--trigger', 'ship-gate', '--reason', 'greenfield retire']);
  assert.equal(cur1.status, 3, cur1.stdout + cur1.stderr);
  const curKey = JSON.parse(cur1.stdout).pending.find((p) => p.key.startsWith('curate-no-forbidden-todo')).key;
  const cur2 = sh(dir, 'node', ['runtime/adapters/claude-code/run-backward.mjs', 'curate', '--check', 'no-forbidden-todo', '--trigger', 'ship-gate', '--reason', 'greenfield retire',
    '--fulfil', curKey, '--value', JSON.stringify({ decisionId: curKey, value: 'retire' })]);
  assert.equal(cur2.status, 0, cur2.stdout + cur2.stderr);
  assert.equal(parse(readFileSync(join(dir, 'runtime/content/checks/no-forbidden-todo.yaml'), 'utf8')).status, 'retired');
  const pass = git(dir, 'commit', '-qm', 'todo violation now permitted');
  assert.equal(pass.status, 0, pass.stderr + pass.stdout);

  // 6. journal evidence on the shared backward ledger
  const steps = readFileSync(join(dir, '.git/journal/backward/steps.ndjson'), 'utf8');
  assert.match(steps, /mint-no-forbidden-todo/);
  assert.match(steps, /curate-no-forbidden-todo/);
});
```

- [ ] **Step 2: Run it, iterate to green.** `node --test runtime/eval/e2e/greenfield.test.mjs`. Expected friction points (fix the TEST/sandbox, never the engine): the baseline-commit-before-init ordering (an empty registry may make `run-watch` exit 2 fail-closed on the hook — if so, install the hook AFTER the baseline commit, before step 2); `landEvalScenario` fixture-path expectations; exact pending-key generation suffix (`-g1`). If a genuine ENGINE bug surfaces, stop and route per systematic-debugging (bounded 3 cycles) — an engine fix is a separate commit with its own regression test.

- [ ] **Step 3: Add the e2e glob to `runtime/project.json`'s test target + run the full runtime suite**

Run: `node --test runtime/engine/test/*.test.mjs runtime/engine/backward/test/*.test.mjs runtime/engine/loop/test/*.test.mjs runtime/adapters/claude-code/test/*.test.mjs runtime/adapters/git/test/*.test.mjs runtime/eval/test/*.test.mjs runtime/eval/e2e/*.test.mjs && npx tsc --noEmit -p runtime/tsconfig.json`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add runtime/eval/e2e/greenfield.test.mjs runtime/project.json
git commit --no-verify -m "feat(runtime): greenfield adoption e2e — init/block/mint/teeth/curate/pass" && git log --oneline -1
```

---

### Task 11: Oracle-teeth tests (the verdict can say NO)

**Files:**
- Create: `scripts/parity-oracle/test/oracle-teeth.test.mjs`

**Interfaces:** consumes `runParity` (injected runners), `runDifferential`/`buildStoreSandbox`, `pairVerdict`.

- [ ] **Step 1: Write the tests**

```js
// scripts/parity-oracle/test/oracle-teeth.test.mjs — sabotage each layer and assert the verdict flips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runParity } from '../run.mjs';
import { overallParity } from '../verdict.mjs';
import { buildStoreSandbox } from '../store-sandbox.mjs';

const goodRun = async () => ({ gatePass: true, numTurns: 1, costUsd: 0, rr: { perTurn: [] } });
const badRun = async () => ({ gatePass: false, numTurns: 1, costUsd: 0,
  graded: { terminalOk: false, golden: { failures: [] }, invariants: { failures: ['forbidden call-log "gh pr merge" present'] }, rubric: null },
  rr: { perTurn: [] } });

test('a runtime-side behavioral regression flips the pair and the overall verdict to RED', async () => {
  const pairs = [{ id: 'a', legacy: { id: 'a' }, runtime: { id: 'rt-a' } }];
  const rows = await runParity({ opts: { iterations: 1, runOneLegacy: goodRun, runOneRuntime: badRun }, pairs });
  assert.equal(rows[0].verdict.dominant, false);
  assert.equal(overallParity({ pairs: rows, differential: { rows: [] } }).green, false);
});

test('a corrupted runtime registry in a store sandbox is caught fail-closed (differential teeth)', () => {
  const { dir, cleanup } = buildStoreSandbox({ fixtureDir: new URL('../fixtures/lint/r2-single-active/good/', import.meta.url).pathname });
  try {
    writeFileSync(join(dir, 'runtime/content/checks/corrupt.yaml'), 'id: [unclosed\n');
    const r = spawnSync('node', ['runtime/engine/lib/run-watch.mjs', '--on=manual'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2, 'registry corruption must fail closed (exit 2), never pass silently');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run** — `node --test scripts/parity-oracle/test/oracle-teeth.test.mjs` → PASS (adjust `badRun`'s `graded` shape to whatever `aggregate` reads for diagnostics if the first assertion misses — the point is the flip, verified end-to-end through `aggregate`→`pairVerdict`).

- [ ] **Step 3: Commit**

```bash
git add scripts/parity-oracle/test/oracle-teeth.test.mjs
git commit --no-verify -m "test(parity-oracle): oracle teeth — verdict flips on sabotage" && git log --oneline -1
```

---

### Task 12: Live bring-up — one live run per mapped scenario (quota: ~15–25M tokens, approved D4)

**Files:** none created up-front; fixes land where bring-up points (rt scenario files, `runtime-sandbox.mjs`, rt fixtures — never bef files, never engine files without a regression test).

- [ ] **Step 1: Smoke the runtime side alone first** (cheapest signal): `node scripts/parity-oracle/run.mjs parity --scenario=add-orphan --iterations=1 --keep`. Triage with the kept sandbox + transcript.
- [ ] **Step 2: Bring up the 7 intake pairs, then the 4 worker pairs**, one at a time: `node scripts/parity-oracle/run.mjs parity --scenario=<id> --iterations=1 --keep`. For each failure classify: (a) harness bug (fix scenario/sandbox/prompt — commit), (b) fixture ItemSchema failure (derived rt fixture per Global Constraints — commit), (c) genuine engine gap (STOP — file via `backlog-add` router or fix with regression test per its blast radius; bounded 3 debug cycles per scenario, floor on exceed).
- [ ] **Step 3: Re-run each fixed scenario once green; keep a running bring-up log** in the workstream decision log (one `decision-log.mjs append` per engine-gap finding, not per prompt tweak).
- [ ] **Step 4: Commit after each green scenario** (small commits: `fix(parity-oracle): bring-up <id> — <what>`).

---

### Task 13: 1× interleaved parity baseline + compare self-check

**Files:**
- Create (generated): `scripts/parity-oracle/parity-baseline.json`, `scripts/parity-oracle/parity-baseline.provenance.json`

- [ ] **Step 1: COST GATE — AskUserQuestion before firing** with the measured per-scenario token numbers from Task 12 (11 pairs × 2 sides × 1 iteration; estimate from bring-up actuals). Proceed only on approval (D4 requires this re-confirmation).
- [ ] **Step 2: Run** `node scripts/parity-oracle/run.mjs rebaseline --iterations=1 2>run.log` (rows to stdout via the crash-safe scratch path; report path on stderr).
- [ ] **Step 3: Sanity + compare self-check**: `node scripts/parity-oracle/run.mjs compare --iterations=0` MUST load the fresh baseline and (with 0 fresh iterations, compare loads baseline-vs-baseline) exit 0 — if `--iterations=0` is not meaningful in the implementation, instead validate `parity-baseline.json` parses and `compareToBaseline({rows: baseline.pairs, baseline})` returns zero regressions via a one-off node -e check.
- [ ] **Step 4: Read the report; render the PARITY headline + unmapped table; record the verdict** (GREEN or the exact red rows) in the workstream file body.
- [ ] **Step 5: Commit**

```bash
git add scripts/parity-oracle/parity-baseline.json scripts/parity-oracle/parity-baseline.provenance.json
git commit --no-verify -m "feat(parity-oracle): 1x interleaved parity baseline (D4)" && git log --oneline -1
```

---

### Task 14: Full validation sweep

- [ ] **Step 1:** `node --test scripts/parity-oracle/test/*.test.mjs` → all pass.
- [ ] **Step 2:** `node --test scripts/benchmark-backlog/test/*.test.mjs` → all pass (legacy suite untouched).
- [ ] **Step 3:** full runtime suite + typecheck (Global Constraints fallback command) → all pass.
- [ ] **Step 4:** `node scripts/parity-oracle/run.mjs differential` → exit 0, table matches Task 8's classes.
- [ ] **Step 5:** Commit anything outstanding; `git status --short` clean.

## Self-review checklist (run after writing, fixed inline)

- Spec coverage: (a) parity = Tasks 2,3,5,6,7,9,12,13; (a-det) = Task 8; (b) = Task 9,13; (c) = Tasks 4,6,12 (operator-driven live adapter); (d) = Task 10; teeth = Task 11; budget D4 = Tasks 12–13. ✓
- No placeholders: Task 6's table + authoring rule resolves every rt scenario field; the two `null` markers in the rt-next-lane-complex-ship listing are explicitly flagged MUST-resolve with the lint test as enforcement. ✓
- Type consistency: `{dir, originDir, cleanup}` sandbox contract, `aggregate` row shape, `{exit, out}` driver contract, `pairVerdict` reasons — names match across tasks. ✓
