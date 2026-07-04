# Runtime Red-Team Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 10 confirmed mechanical red-team findings in the Long-Horizon Engineering Runtime (fail-closed registry, rename-aware gate, atomic/guarded/single-writer journal, runnable meta-check CLI, epic-aware single-active, self-contained starter pack, scope-true cmd attribution, gate-clean sha teeth, curate write-order fault-injection), each with a regression test.

**Architecture:** Every fix is a mechanical hardening of an existing seam — no ring-1 schema (zod contract) changes. New surfaces: a `writer.json` per-runId lease sidecar (journal), three generic starter evaluators under `runtime/starter/evaluators/`, a loaded-registry CLI on `meta-check.mjs`, an injectable `persist` seam on `curateGuard`, and a pure `gateCleanFreshness` helper in postflight.

**Tech Stack:** Node 24 zero-build `.mjs` + `.ts`-zod hybrid, `node:test`, `yaml` package. No new dependencies.

## Global Constraints

- No ring-1 schema changes: `journal.schema.ts`, `check.schema.ts`, `finding.schema.ts`, `item.schema.ts` stay byte-identical (epic out_of_scope: contracts frozen).
- Tests live in each package's existing `test/` dir; run with the glob form `node --test <dir>/*.test.mjs` (Node 24 does not discover suites from a bare dir).
- Worktree commits need `--no-verify` AND a `git log` verification that the commit landed (pre-commit hook silently rejects in worktrees).
- Every fix ships WITH its regression test in the same commit (feedback_regression_tests).
- Empirical gates: after T7/T8/T9 the touched CLI must be run against the REAL repo state and be green (or surface real drift to fix in-task) — the red-team findings were empirical; the fixes must be too.
- Repo root for all paths below: the worktree root (`.claude/worktrees/runtime-redteam-hardening`).

---

### Task 1: Atomic + guarded `meta.json` (backlog item 3)

**Files:**
- Modify: `runtime/engine/lib/journal.mjs:68-78` (the `makeJournal` fs backing)
- Test: `runtime/engine/test/journal.test.mjs`

**Interfaces:**
- Consumes: existing `makeJournal({root})` contract.
- Produces: unchanged public contract; `readMeta` now returns `null` on torn JSON (heals like the steps tail); `writeMeta` is write-tmp-then-rename.

- [ ] **Step 1: Write the failing tests**

```js
// append to runtime/engine/test/journal.test.mjs
test('H1: a torn meta.json reads as FRESH and begin() heals it, preserving the steps ledger', async () => {
  const root = freshRoot();
  const j1 = makeJournal({ root }); j1.begin('item-t', meta('item-t'));
  await j1.step('item-t', 'E1', async () => 'v1');
  writeFileSync(join(root, 'journal', 'item-t', 'meta.json'), '{"runId": "item-t", TORN');  // torn write
  const j2 = makeJournal({ root });
  assert.equal(j2.read('item-t'), null);                       // torn meta → FRESH, not a crash
  j2.begin('item-t', meta('item-t'));                          // heal
  const ledger = j2.read('item-t');
  assert.equal(ledger.meta.runId, 'item-t');
  assert.equal(ledger.steps.get('E1').value, 'v1');            // ledger survived the heal
});

test('H2: writeMeta is atomic — no .tmp residue and valid JSON after begin()', () => {
  const root = freshRoot();
  makeJournal({ root }).begin('item-a', meta('item-a'));
  const dir = join(root, 'journal', 'item-a');
  assert.ok(!existsSync(join(dir, 'meta.json.tmp')));
  assert.equal(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).runId, 'item-a');
});
```

Add `existsSync` to the test file's `node:fs` import if missing.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test runtime/engine/test/journal.test.mjs`
Expected: H1 FAILS (JSON.parse throws `SyntaxError` out of `read`), H2 passes or fails incidentally.

- [ ] **Step 3: Implement**

In `runtime/engine/lib/journal.mjs`: add `renameSync` to the `node:fs` import, then replace the two backing lines:

```js
    readMeta: (runId) => {
      if (!existsSync(metaPath(runId))) return null;
      try { return JSON.parse(readFileSync(metaPath(runId), 'utf8')); }
      catch { return null; }   // torn meta heals like the steps tail: treated as absent, begin() rewrites
    },
    writeMeta: (runId, meta) => {
      mkdirSync(runDir(runId), { recursive: true });
      writeFileSync(metaPath(runId) + '.tmp', JSON.stringify(meta, null, 2) + '\n');
      renameSync(metaPath(runId) + '.tmp', metaPath(runId));   // atomic on POSIX
    },
```

- [ ] **Step 4: Run to verify green**

Run: `node --test runtime/engine/test/journal.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/journal.mjs runtime/engine/test/journal.test.mjs
git commit --no-verify -m "fix(runtime): atomic write-tmp-rename + parse-guarded meta.json (redteam item 3)" && git log --oneline -1
```

---

### Task 2: Journal single-writer lease per runId (backlog item 4)

**Files:**
- Modify: `runtime/engine/lib/errors.mjs` (new `JournalWriterConflict`)
- Modify: `runtime/engine/lib/journal.mjs` (`makeJournal` gains a lease; `writeMeta`/`appendStep` assert it)
- Test: `runtime/engine/test/journal.test.mjs`

**Interfaces:**
- Consumes: Task 1's backing.
- Produces: `makeJournal({root, lease})` — `lease` optional `{pid, host, alive(pid)}` (defaults: `process.pid`, `os.hostname()`, `process.kill(pid,0)` probe), test-injectable. New export from errors.mjs: `class JournalWriterConflict extends Error` with `.holder`. Read path (`read`, `pendingDecisions`, postflight consumers) takes NO lease.

- [ ] **Step 1: Write the failing tests**

```js
// append to runtime/engine/test/journal.test.mjs
import { JournalWriterConflict } from '../lib/errors.mjs';

test('W1: a live foreign same-host writer → JournalWriterConflict on append (single-writer per runId)', async () => {
  const root = freshRoot();
  mkdirSync(join(root, 'journal', 'item-w'), { recursive: true });
  writeFileSync(join(root, 'journal', 'item-w', 'writer.json'),
    JSON.stringify({ pid: 4242, host: 'h1', acquired_at: 't' }));
  const j = makeJournal({ root, lease: { pid: 1, host: 'h1', alive: () => true } });
  await assert.rejects(
    () => j.step('item-w', 'E1', async () => 'x'),
    (e) => e instanceof JournalWriterConflict && e.holder.pid === 4242);
});

test('W2: a DEAD same-host holder is taken over; lease now records the new writer', async () => {
  const root = freshRoot();
  mkdirSync(join(root, 'journal', 'item-w'), { recursive: true });
  writeFileSync(join(root, 'journal', 'item-w', 'writer.json'),
    JSON.stringify({ pid: 4242, host: 'h1', acquired_at: 't' }));
  const j = makeJournal({ root, lease: { pid: 7, host: 'h1', alive: () => false } });
  j.begin('item-w', meta('item-w'));
  assert.equal(await j.step('item-w', 'E1', async () => 'x'), 'x');
  assert.equal(JSON.parse(readFileSync(join(root, 'journal', 'item-w', 'writer.json'), 'utf8')).pid, 7);
});

test('W3: a FOREIGN-host holder is never taken over (liveness unverifiable — fail closed)', () => {
  const root = freshRoot();
  mkdirSync(join(root, 'journal', 'item-w'), { recursive: true });
  writeFileSync(join(root, 'journal', 'item-w', 'writer.json'),
    JSON.stringify({ pid: 4242, host: 'other-host', acquired_at: 't' }));
  const j = makeJournal({ root, lease: { pid: 7, host: 'h1', alive: () => false } });
  assert.throws(() => j.begin('item-w', meta('item-w')), JournalWriterConflict);
});

test('W4: same-pid re-acquire is a no-op; the READ path never takes the lease', () => {
  const root = freshRoot();
  const j = makeJournal({ root, lease: { pid: 7, host: 'h1', alive: () => true } });
  j.begin('item-r', meta('item-r'));
  j.record('item-r', 'k', { ok: true });                        // same writer, twice — fine
  const reader = makeJournal({ root, lease: { pid: 999, host: 'h1', alive: () => true } });
  assert.equal(reader.read('item-r').steps.get('k').value.ok, true);  // foreign reader: no throw
});

test('W5: a torn writer.json is reclaimed, not a crash', () => {
  const root = freshRoot();
  mkdirSync(join(root, 'journal', 'item-w'), { recursive: true });
  writeFileSync(join(root, 'journal', 'item-w', 'writer.json'), '{TORN');
  const j = makeJournal({ root, lease: { pid: 7, host: 'h1', alive: () => true } });
  j.begin('item-w', meta('item-w'));                            // no throw
  assert.equal(JSON.parse(readFileSync(join(root, 'journal', 'item-w', 'writer.json'), 'utf8')).pid, 7);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test runtime/engine/test/journal.test.mjs`
Expected: W1/W3 FAIL (no conflict thrown), W2/W5 fail on missing lease write.

- [ ] **Step 3: Implement**

`runtime/engine/lib/errors.mjs` — append:

```js
export class JournalWriterConflict extends Error {
  constructor(runId, holder) {
    super(`journal runId "${runId}" is held by a live writer (pid ${holder?.pid}@${holder?.host}) — single-writer rule (§5)`);
    this.name = 'JournalWriterConflict'; this.holder = holder;
  }
}
```

`runtime/engine/lib/journal.mjs` — add imports `import { hostname } from 'node:os';` and `import { JournalWriterConflict } from './errors.mjs';`, then inside `makeJournal`:

```js
export function makeJournal({ root = gitCommonDir(), lease } = {}) {
  const me = { pid: process.pid, host: hostname(),
    alive: (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }, ...lease };
  const runDir = (runId) => join(root, 'journal', runId);
  const metaPath = (runId) => join(runDir(runId), 'meta.json');
  const stepsPath = (runId) => join(runDir(runId), 'steps.ndjson');
  const leasePath = (runId) => join(runDir(runId), 'writer.json');
  // §5 single-writer per runId: the root is shared across worktrees, so every MUTATION asserts the
  // lease. Dead same-host holders are taken over (short-lived CLI writers chain); a live foreign pid
  // or any foreign host (liveness unverifiable) throws. Reads are lease-free.
  const acquireLease = (runId) => {
    mkdirSync(runDir(runId), { recursive: true });
    if (existsSync(leasePath(runId))) {
      let holder = null;
      try { holder = JSON.parse(readFileSync(leasePath(runId), 'utf8')); } catch { holder = null; } // torn → reclaim
      if (holder && holder.pid === me.pid && holder.host === me.host) return;
      if (holder && (holder.host !== me.host || me.alive(holder.pid))) throw new JournalWriterConflict(runId, holder);
    }
    writeFileSync(leasePath(runId), JSON.stringify({ pid: me.pid, host: me.host, acquired_at: isoNow() }, null, 2) + '\n');
  };
  return makeBacking({
    readMeta: /* Task 1 body unchanged */,
    writeMeta: (runId, meta) => { acquireLease(runId); /* Task 1 body */ },
    readSteps: /* unchanged */,
    appendStep: (runId, rec) => { acquireLease(runId); appendFileSync(stepsPath(runId), JSON.stringify(rec) + '\n'); },
  });
}
```

(Write the real bodies, not the comments — shown compressed here to pin the wiring; the `mkdirSync` in `appendStep` is subsumed by `acquireLease`.)

- [ ] **Step 4: Run the full runtime suite** (the lease must not break gate/ship-recheck/backward tests that share `makeJournal`)

Run: `node --test runtime/engine/test/*.test.mjs runtime/adapters/git/test/*.test.mjs runtime/adapters/claude-code/test/*.test.mjs runtime/engine/backward/test/*.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/journal.mjs runtime/engine/lib/errors.mjs runtime/engine/test/journal.test.mjs
git commit --no-verify -m "fix(runtime): enforce per-runId single-writer lease on the shared journal root (redteam item 4)" && git log --oneline -1
```

---

### Task 3: Fail-closed registry errors in all three enforcement mains (backlog item 1)

**Files:**
- Modify: `runtime/engine/lib/load-registry.mjs` (new `registryErrorLines`)
- Modify: `runtime/adapters/git/pre-commit-gate.mjs:58-59` (main)
- Modify: `runtime/engine/lib/run-watch.mjs:50` (main)
- Modify: `runtime/adapters/git/ship-recheck.mjs:36` (main — same law; the item names the first two, the sibling gets the same fix)
- Test: `runtime/engine/test/load-registry.test.mjs`, `runtime/adapters/git/test/pre-commit-gate.test.mjs`

**Interfaces:**
- Produces: `registryErrorLines(registry): string[] | null` exported from load-registry.mjs (null when clean).

- [ ] **Step 1: Write the failing tests**

```js
// append to runtime/engine/test/load-registry.test.mjs
import { registryErrorLines } from '../lib/load-registry.mjs';

test('registryErrorLines: null when clean, located lines when corrupt', () => {
  assert.equal(registryErrorLines({ errors: [] }), null);
  const lines = registryErrorLines({ errors: [{ file: 'checks/bad.yaml', error: 'malformed YAML: x' }] });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /checks\/bad\.yaml.*malformed YAML/);
});
```

```js
// append to runtime/adapters/git/test/pre-commit-gate.test.mjs
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('a corrupt check YAML blocks the commit fail-closed (exit 2, located error)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  execSync('git init -q . && git config user.email t@t && git config user.name t', { cwd: dir });
  mkdirSync(join(dir, 'runtime'), { recursive: true });
  mkdirSync(join(dir, 'checks'));
  writeFileSync(join(dir, 'checks', 'bad.yaml'), 'id: [unclosed\n');
  writeFileSync(join(dir, 'runtime', 'runtime.config.json'),
    JSON.stringify({ checksDir: 'checks', triggersFile: 'triggers.yaml' }));
  writeFileSync(join(dir, 'triggers.yaml'),
    'triggers:\n  - on: commit\n    contexts: [invariant, gate]\n    cost_ceiling: cheap\n');
  writeFileSync(join(dir, 'a.txt'), 'x');
  execSync('git add a.txt', { cwd: dir });
  const gate = fileURLToPath(new URL('../pre-commit-gate.mjs', import.meta.url));
  const r = spawnSync('node', [gate], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /registry corrupt/i);
  assert.match(r.stderr, /bad\.yaml/);
});
```

(Dedup imports against what the file already has.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test runtime/engine/test/load-registry.test.mjs runtime/adapters/git/test/pre-commit-gate.test.mjs`
Expected: FAIL — `registryErrorLines` not exported; gate exits 0 (corrupted YAML silently ignored — the finding itself).

- [ ] **Step 3: Implement**

`load-registry.mjs` — append before `main()`:

```js
/** Fail-closed helper for enforcement mains: located error lines, or null when the registry is clean. */
export function registryErrorLines(registry) {
  if (!registry.errors.length) return null;
  return registry.errors.map((e) => `  ✖ registry: ${e.file}: ${e.error}`);
}
```

In each of the three mains, immediately after `const registry = loadRegistry(...)`:

```js
    const errLines = registryErrorLines(registry);
    if (errLines) {
      console.error('runtime gate: check registry corrupt — blocking (fail-closed):');   // gate wording
      for (const line of errLines) console.error(line);
      process.exit(2);
    }
```

Wording per main: `'runtime gate: check registry corrupt — blocking commit (fail-closed):'` (pre-commit-gate), `'run-watch: check registry corrupt (fail-closed):'` (run-watch), `'ship-recheck: check registry corrupt (fail-closed):'` (ship-recheck). Import `registryErrorLines` next to the existing `loadRegistry` import in each file.

- [ ] **Step 4: Run to verify green**

Run: `node --test runtime/engine/test/load-registry.test.mjs runtime/adapters/git/test/pre-commit-gate.test.mjs runtime/adapters/git/test/ship-recheck.test.mjs runtime/engine/test/run-watch.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/load-registry.mjs runtime/adapters/git/pre-commit-gate.mjs runtime/engine/lib/run-watch.mjs runtime/adapters/git/ship-recheck.mjs runtime/engine/test/load-registry.test.mjs runtime/adapters/git/test/pre-commit-gate.test.mjs
git commit --no-verify -m "fix(runtime): registry errors block gate/watch/ship-recheck fail-closed (redteam item 1)" && git log --oneline -1
```

---

### Task 4: `--diff-filter=ACMR` in `readStaged` (backlog item 2)

**Files:**
- Modify: `runtime/adapters/git/pre-commit-gate.mjs:22`
- Test: `runtime/adapters/git/test/pre-commit-gate.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('readStaged includes renames: --diff-filter=ACMR', () => {
  let cmd;
  const files = readStaged((c) => { cmd = c; return 'a.ts\nrenamed.ts\n'; });
  assert.match(cmd, /--diff-filter=ACMR\b/);
  assert.deepEqual(files, ['a.ts', 'renamed.ts']);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test runtime/adapters/git/test/pre-commit-gate.test.mjs` → FAIL (`ACM` ≠ `ACMR`).

- [ ] **Step 3: Implement** — in `readStaged`, change the command to:

```js
  return exec('git diff --cached --name-only --diff-filter=ACMR').split('\n').filter(Boolean);
```

- [ ] **Step 4: Run to verify green** — same command, all PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/adapters/git/pre-commit-gate.mjs runtime/adapters/git/test/pre-commit-gate.test.mjs
git commit --no-verify -m "fix(runtime): gate reads staged renames (--diff-filter=ACMR, redteam item 2)" && git log --oneline -1
```

---

### Task 5: cmd evaluators narrow `RUNTIME_STAGED_PATHS` + attribution to staged ∩ scope (backlog item 8a)

**Files:**
- Modify: `runtime/engine/lib/resolve-evaluator.mjs` (rename `eslintFiles` → `scopedStagedFiles`; use it in the cmd branch)
- Test: `runtime/engine/test/resolve-evaluator.test.mjs`

**Interfaces:**
- Produces: `scopedStagedFiles(check, stagedFiles)` (renamed export — update ALL importers: `grep -rn "eslintFiles" runtime/`; no-deprecation, rename everywhere).
- cmd branch behavior: `stagedFiles == null` → env untouched, finding scope = `check.scope.paths` (audit path unchanged). `stagedFiles` present → `RUNTIME_STAGED_PATHS` = staged ∩ scope (may be `''` — the presence-keyed contract in `tools/lib/text-scan.mjs:13-16` treats that as "nothing staged"), finding scope = the intersection.

- [ ] **Step 1: Write the failing test**

```js
// append to runtime/engine/test/resolve-evaluator.test.mjs (reuse the file's existing check-fixture helper)
test('cmd: RUNTIME_STAGED_PATHS and attribution are staged ∩ scope, not the raw staged set', async () => {
  const check = {
    id: 'c1', property: 'p', kind: 'drift', cost_tier: 'cheap', contexts: ['gate'], status: 'active',
    scope: { paths: ['services/**/*.ts'] },
    evaluator: { type: 'deterministic',
      run: 'cmd:node -e "console.error(process.env.RUNTIME_STAGED_PATHS); process.exit(1)"' },
    provenance: { minted_by: 't', ratified: '2026-01-01' },
  };
  const { invoke } = resolveEvaluator({ check, stagedFiles: ['services/x/a.ts', 'docs/unrelated.md'] });
  const [f] = await invoke();
  assert.deepEqual(f.scope, ['services/x/a.ts']);            // attribution = intersection
  assert.match(f.evidence, /services\/x\/a\.ts/);            // env carried the narrowed list
  assert.ok(!f.evidence.includes('docs/unrelated.md'));      // out-of-scope path NOT passed
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test runtime/engine/test/resolve-evaluator.test.mjs` → FAIL (scope is the whole glob list; evidence contains `docs/unrelated.md`).

- [ ] **Step 3: Implement** — rename the helper and rewrite the cmd branch:

```js
/** staged files (if provided) that match this check's scope globs; else the check's whole scope (audit path). */
export function scopedStagedFiles(check, stagedFiles) {
  if (stagedFiles == null) return check.scope.paths;
  return stagedFiles.filter((f) => check.scope.paths.some((p) => globsOverlap(f, p)));
}
```

```js
  if (scheme === 'cmd') {
    return { kind: 'deterministic', invoke: () => {
      const scoped = stagedFiles == null ? null : scopedStagedFiles(check, stagedFiles);   // staged ∩ scope
      const env = scoped == null ? process.env : { ...process.env, RUNTIME_STAGED_PATHS: scoped.join('\n') };
      const r = spawnSync(target, { shell: true, encoding: 'utf8', env });
      if (r.status === 0) return [];
      return toFindings([{ detail: check.property, evidence: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(),
        scope: scoped ?? check.scope.paths }], check);
    } };
  }
```

Update the eslint branch's call site and every `eslintFiles` importer/test to the new name.

- [ ] **Step 4: Run to verify green** — `node --test runtime/engine/test/resolve-evaluator.test.mjs runtime/engine/test/run-check.test.mjs` → all PASS, plus `grep -rn "eslintFiles" runtime/ tools/ .claude/` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/resolve-evaluator.mjs runtime/engine/test/resolve-evaluator.test.mjs
git commit --no-verify -m "fix(runtime): cmd evaluators narrow env+attribution to staged∩scope (redteam item 8a)" && git log --oneline -1
```

---

### Task 6: Align `no-states-runtime-catch` registry scope with its tool (backlog item 8b)

**Files:**
- Modify: `runtime/content/checks/no-states-runtime-catch.yaml` (scope.paths)
- Test: `runtime/engine/test/content-ring.test.mjs`

The tool (`tools/check-no-states-runtime-catch.mjs:21`) walks `includeUnder: ['services', 'libs', 'infrastructure']`, ext `.ts`; the registry scope says only `services/**/src/**/*.ts` — so libs/infrastructure findings are mis-attributed and scope-based selection under-fires.

- [ ] **Step 1: Write the failing drift-pin test**

```js
// append to runtime/engine/test/content-ring.test.mjs
test('no-states-runtime-catch scope matches its tool filters (services+libs+infrastructure .ts)', () => {
  const reg = loadRegistry({ checksDir: 'runtime/content/checks' });
  const c = reg.byId.get('no-states-runtime-catch');
  assert.deepEqual(c.scope.paths.slice().sort(),
    ['infrastructure/**/*.ts', 'libs/**/*.ts', 'services/**/*.ts']);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test runtime/engine/test/content-ring.test.mjs` → FAIL.

- [ ] **Step 3: Implement** — in the yaml, replace the scope block:

```yaml
scope:
  paths:
    - services/**/*.ts
    - libs/**/*.ts
    - infrastructure/**/*.ts
  dossiers:
    - feedback_states_runtime_uncatchable.md
```

- [ ] **Step 4: Run to verify green** — same test command, all PASS.

- [ ] **Step 5: Commit**

```bash
git add runtime/content/checks/no-states-runtime-catch.yaml runtime/engine/test/content-ring.test.mjs
git commit --no-verify -m "fix(runtime): no-states-runtime-catch scope matches tool filters (redteam item 8b)" && git log --oneline -1
```

---

### Task 7: Runnable `registry-integrity` CLI on meta-check (backlog item 5)

**Files:**
- Modify: `runtime/engine/lib/meta-check.mjs:59` (replace the stub `main()`)
- Test: `runtime/engine/test/meta-check.test.mjs`

**Interfaces:**
- CLI: `node runtime/engine/lib/meta-check.mjs [--checks-dir <dir>]` — default `checksDir` from `runtime/runtime.config.json` (cwd-relative, matching the gate). Exit 0 clean / 1 findings-or-registry-errors / 2 usage (no dir resolvable). `env` built in-CLI: `resolveGlobs` via `git ls-files -- <globs>` (outside a git repo → `['x']`, i.e. skip rot-detection rather than false-flag); `enforcedSurfaces: []`, `storedKnobs: []` (those need SPEC-3-level wiring; assertions 2/3 + cheap-by-construction + rot-i are the CLI's teeth).

- [ ] **Step 1: Write the failing CLI tests**

```js
// append to runtime/engine/test/meta-check.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../lib/meta-check.mjs', import.meta.url));
const VALID = `id: ok-check
property: "p"
kind: drift
evaluator: { type: deterministic, run: "cmd:true" }
cost_tier: cheap
contexts: [gate]
scope: { paths: ["**/*"] }
status: active
provenance: { minted_by: "t", ratified: "2026-01-01" }
`;

test('CLI: clean registry → exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-'));
  mkdirSync(join(dir, 'checks'));
  writeFileSync(join(dir, 'checks', 'ok.yaml'), VALID);
  const r = spawnSync('node', [CLI, '--checks-dir', join(dir, 'checks')], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0);
});

test('CLI: unresolvable module evaluator → exit 1 with a finding (assertion 2 runs)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-'));
  mkdirSync(join(dir, 'checks'));
  writeFileSync(join(dir, 'checks', 'dangling.yaml'),
    VALID.replace('id: ok-check', 'id: dangling').replace('run: "cmd:true"', 'run: "module:./nope.mjs#f"'));
  const r = spawnSync('node', [CLI, '--checks-dir', join(dir, 'checks')], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /does not resolve/);
});

test('CLI: corrupt YAML in the registry → exit 1, located (fail-closed self-check)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-'));
  mkdirSync(join(dir, 'checks'));
  writeFileSync(join(dir, 'checks', 'bad.yaml'), 'id: [unclosed\n');
  const r = spawnSync('node', [CLI, '--checks-dir', join(dir, 'checks')], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /bad\.yaml/);
});

test('CLI: no dir and no config → exit 2 usage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-'));
  const r = spawnSync('node', [CLI], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2);
});
```

- [ ] **Step 2: Run to verify they fail** — `node --test runtime/engine/test/meta-check.test.mjs` → the CLI tests FAIL (stub exits 2 unconditionally — the empirically-verified finding).

- [ ] **Step 3: Implement** — add imports (`readFileSync` to the fs import, `execSync` from `node:child_process`, `loadRegistry` + `registryErrorLines` from `./load-registry.mjs`), replace `main()`:

```js
function main() {
  const argv = process.argv.slice(2);
  const flag = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  let checksDir = flag('--checks-dir');
  if (!checksDir) {
    try { checksDir = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8')).checksDir; }
    catch { /* fall through to usage */ }
  }
  if (!checksDir) { console.error('usage: meta-check.mjs [--checks-dir <dir>] (default: runtime/runtime.config.json)'); process.exit(2); }
  const registry = loadRegistry({ checksDir });
  const errLines = registryErrorLines(registry);
  if (errLines) { for (const l of errLines) console.error(l); process.exit(1); }   // self-check is fail-closed too
  const resolveGlobs = (globs) => {
    try {
      return execSync(`git ls-files -- ${globs.map((g) => `'${g}'`).join(' ')}`, { encoding: 'utf8' })
        .split('\n').filter(Boolean);
    } catch { return ['x']; }   // not a git repo → skip rot-detection rather than false-flag
  };
  const findings = metaCheck({ registry, env: { resolveGlobs, enforcedSurfaces: [], storedKnobs: [] } });
  for (const f of findings) console.log(`${f.check}\t${f.kind}\t${f.detail}`);
  process.exit(findings.length ? 1 : 0);
}
```

- [ ] **Step 4: Run to verify green + EMPIRICAL GATE** —
`node --test runtime/engine/test/meta-check.test.mjs` → all PASS. Then run the real self-check from the repo root: `node runtime/engine/lib/meta-check.mjs` and `node runtime/engine/lib/meta-check.mjs --checks-dir runtime/starter/checks`. Expected: exit 0. If either surfaces REAL findings (e.g. a stale scope), fix that drift in this task (it is exactly what the self-check exists to catch) and note it in the commit body.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/meta-check.mjs runtime/engine/test/meta-check.test.mjs
git commit --no-verify -m "feat(runtime): loaded-registry CLI for meta-check — registry-integrity actually runs (redteam item 5)" && git log --oneline -1
```

---

### Task 8: Epic-aware `single-active` semantics (backlog item 6)

**Files:**
- Modify: `runtime/engine/lib/scope-gate.mjs` (`singleActive` → `activePartition`; both CLI modes)
- Test: `runtime/engine/test/scope-gate.test.mjs`

**Interfaces:**
- Produces: `activePartition(items): { executables: Item[], epics: Item[] }` (active non-epic / active `type: 'epic'`). `singleActive` is DELETED (no-deprecation) — update its importers/tests (`grep -rn "singleActive" runtime/`).
- Law: ≤1 active non-epic AND ≤1 active epic; **zero active is legal** (between workstreams). The scope-gate self-resolve mode gates on the active EXECUTABLE (an active epic alongside is legal and ignored).

- [ ] **Step 1: Write the failing tests**

```js
// append to runtime/engine/test/scope-gate.test.mjs
import { activePartition } from '../lib/scope-gate.mjs';

const it = (id, status, type) => ({ id, status, ...(type ? { type } : {}) });

test('activePartition splits active epics from active executables', () => {
  const { executables, epics } = activePartition([
    it('a', 'active'), it('e', 'active', 'epic'), it('q', 'queued'), it('p', 'parking', 'epic')]);
  assert.deepEqual(executables.map((i) => i.id), ['a']);
  assert.deepEqual(epics.map((i) => i.id), ['e']);
});
```

CLI-level (same file; `spawnSync` a temp `--backlog-dir` fixture — reuse the pattern if the file already spawns, else add):

```js
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SG = fileURLToPath(new URL('../lib/scope-gate.mjs', import.meta.url));
const md = (id, status, type) => `---\nid: ${id}\nstatus: ${status}\n${type ? `type: ${type}\n` : ''}---\n`;
const fixtureDir = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'sa-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
};
const runSA = (d) => spawnSync('node', [SG, `--single-active`, `--backlog-dir=${d}`], { encoding: 'utf8' });

test('single-active: ZERO active is legal (exit 0) — the empirical redteam repro', () => {
  assert.equal(runSA(fixtureDir({ 'q.md': md('q', 'queued') })).status, 0);
});
test('single-active: one active epic + one active member is legal (exit 0)', () => {
  assert.equal(runSA(fixtureDir({ 'e.md': md('e', 'active', 'epic'), 'm.md': md('m', 'active') })).status, 0);
});
test('single-active: two active non-epics break the law (exit 1)', () => {
  const r = runSA(fixtureDir({ 'a.md': md('a', 'active'), 'b.md': md('b', 'active') }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /2 active non-epic/);
});
test('single-active: two active epics break the law (exit 1)', () => {
  assert.equal(runSA(fixtureDir({ 'e1.md': md('e1', 'active', 'epic'), 'e2.md': md('e2', 'active', 'epic') })).status, 1);
});
```

- [ ] **Step 2: Run to verify they fail** — `node --test runtime/engine/test/scope-gate.test.mjs` → zero-active and epic+member cases FAIL (current code requires exactly-one and counts epics).

- [ ] **Step 3: Implement** — replace `singleActive` and both CLI usages:

```js
/** The real single-active law: ≤1 active non-epic (the executable), ≤1 active epic; zero legal. */
export function activePartition(items) {
  const actives = items.filter((i) => i.status === 'active');
  return { executables: actives.filter((i) => i.type !== 'epic'), epics: actives.filter((i) => i.type === 'epic') };
}
```

```js
  if ('single-active' in args) {                                        // the `single-active` starter check
    const { executables, epics } = activePartition(readItems(backlogDir));
    const broken = executables.length > 1 || epics.length > 1;
    if (broken) console.log(`single-active broken: ${executables.length} active non-epic (${executables.map((i) => i.id).join(', ')}); ${epics.length} active epic(s) (${epics.map((i) => i.id).join(', ')})`);
    process.exit(broken ? 1 : 0);
  }
```

```js
  else {
    const { executables } = activePartition(readItems(backlogDir));
    if (executables.length !== 1) { console.log(`scope-gate: expected exactly one active non-epic item, found ${executables.length}`); process.exit(executables.length === 0 ? 0 : 1); }
    activeItem = executables[0];
  }
```

- [ ] **Step 4: Run to verify green + EMPIRICAL GATE** — `node --test runtime/engine/test/scope-gate.test.mjs` all PASS; then on the real repo: `node runtime/engine/lib/scope-gate.mjs --single-active` → expected exit 0 (one active non-epic: this workstream; zero active epics). Before this fix it exits 1 — capture both for the validation gate.

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/scope-gate.mjs runtime/engine/test/scope-gate.test.mjs
git commit --no-verify -m "fix(runtime): single-active law is ≤1 non-epic + ≤1 epic, zero legal (redteam item 6)" && git log --oneline -1
```

---

### Task 9: Starter-pack self-containment (backlog item 7)

**Files:**
- Create: `runtime/starter/evaluators/no-unsafe-casts.mjs`
- Create: `runtime/starter/evaluators/references-valid.mjs`
- Create: `runtime/starter/evaluators/index-fresh.mjs`
- Modify: `runtime/starter/checks/no-unsafe-casts.yaml`, `runtime/starter/checks/references-valid.yaml`, `runtime/starter/checks/index-fresh.yaml` (run: → the new evaluators; index-fresh property text + drop its project-specific `fix:`)
- Test: `runtime/engine/test/starter-pack.test.mjs`

**Interfaces:**
- Each evaluator is a self-contained CLI (exit 0 clean / 1 findings), honoring the presence-keyed `RUNTIME_STAGED_PATHS` contract where meaningful (the casts scanner) and `--backlog-dir` / `--index` overrides for hermetic tests.
- The starter YAML `property:` for index-fresh becomes the honest generic form: `"the index lists every live (non-shipped/dropped) item and links only existing item files"`.
- The content ring keeps its Nestfolio bindings (`tools/…`, lint) — only `runtime/starter/**` must be self-contained.

- [ ] **Step 1: Write the failing self-containment test**

```js
// append to runtime/engine/test/starter-pack.test.mjs
import { existsSync } from 'node:fs';

test('the starter pack is SELF-CONTAINED: every evaluator is cmd:node <file under runtime/> and exists', () => {
  const reg = loadRegistry({ checksDir: 'runtime/starter/checks' });
  for (const c of reg.checks) {
    const m = c.evaluator.run.match(/^cmd:node\s+(\S+)/);
    assert.ok(m, `${c.id}: starter evaluator must be cmd:node <file> (got: ${c.evaluator.run})`);
    assert.ok(m[1].startsWith('runtime/'), `${c.id}: evaluator escapes runtime/: ${m[1]}`);
    assert.ok(existsSync(m[1]), `${c.id}: evaluator file missing: ${m[1]}`);
  }
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test runtime/engine/test/starter-pack.test.mjs` → FAIL on the 3 non-self-contained checks (the finding).

- [ ] **Step 3: Implement the three evaluators**

`runtime/starter/evaluators/no-unsafe-casts.mjs`:

```js
#!/usr/bin/env node
// Generic starter evaluator (§13 self-containment law): unsafe-cast scan, zero project dependencies.
// RUNTIME_STAGED_PATHS presence contract (== tools/lib/text-scan.mjs): unset → walk roots; '' → nothing.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const ROOTS = ['services', 'libs'];
const PATTERNS = [/\bas\s+any\b/, /\bas\s+unknown\s+as\b/, /eslint-disable/];
const isTest = (p) => /(^|\/)tests?\//.test(p) || /\.(test|spec)\./.test(p);
function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') yield* walk(p); }
    else yield p;
  }
}
function targets() {
  if ('RUNTIME_STAGED_PATHS' in process.env) {
    return process.env.RUNTIME_STAGED_PATHS.split('\n').map((s) => s.trim()).filter(Boolean)
      .filter((p) => extname(p) === '.ts' && !isTest(p) && existsSync(p));
  }
  const out = [];
  for (const r of ROOTS) if (existsSync(r)) for (const p of walk(r)) if (extname(p) === '.ts' && !isTest(p)) out.push(p);
  return out;
}
let bad = 0;
for (const f of targets()) {
  const text = readFileSync(f, 'utf8');
  const hit = PATTERNS.find((rx) => rx.test(text));
  if (hit) { console.log(`${f}: matches ${hit}`); bad++; }
}
process.exit(bad ? 1 : 0);
```

`runtime/starter/evaluators/references-valid.mjs`:

```js
#!/usr/bin/env node
// Generic starter evaluator: every item's `references:` entry resolves — path exists (repo-root or
// item-dir relative) and, when a #anchor is given, a matching heading exists outside code fences.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import yaml from 'yaml';
const argv = process.argv.slice(2);
const flag = (f, dflt) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : dflt; };
const dir = flag('--backlog-dir', 'docs/backlog');
const slug = (h) => h.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
const headings = (text) => text.replace(/```[\s\S]*?```/g, '')
  .split('\n').filter((l) => /^#{1,6}\s/.test(l)).map((l) => slug(l.replace(/^#{1,6}\s+/, '')));
let bad = 0;
if (existsSync(dir)) for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
  const m = readFileSync(join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/);
  let fm; try { fm = m ? yaml.parse(m[1]) : {}; } catch { continue; }   // malformed frontmatter is another check's job
  for (const ref of fm?.references ?? []) {
    const [path, anchor] = String(ref).split('#');
    const resolved = existsSync(path) ? path : (existsSync(join(dir, path)) ? join(dir, path) : null);
    if (!resolved) { console.log(`${f}: dangling reference path: ${ref}`); bad++; continue; }
    if (anchor && !headings(readFileSync(resolved, 'utf8')).includes(anchor)) {
      console.log(`${f}: anchor not found: ${ref}`); bad++;
    }
  }
}
process.exit(bad ? 1 : 0);
```

`runtime/starter/evaluators/index-fresh.mjs`:

```js
#!/usr/bin/env node
// Generic starter evaluator: the index lists every LIVE item (status not shipped/dropped) and links
// only existing item files. (The byte-exact render law is project-specific and lives in the content ring.)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
const argv = process.argv.slice(2);
const flag = (f, dflt) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : dflt; };
const index = flag('--index', 'docs/BACKLOG.md');
const dir = flag('--backlog-dir', 'docs/backlog');
if (!existsSync(index)) { console.log(`index missing: ${index}`); process.exit(1); }
const text = readFileSync(index, 'utf8');
let bad = 0;
if (existsSync(dir)) for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
  const m = readFileSync(join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/);
  let fm; try { fm = m ? yaml.parse(m[1]) : {}; } catch { continue; }
  if (fm?.status && !['shipped', 'dropped'].includes(fm.status) && !text.includes(f)) {
    console.log(`live item not in index: ${f} (status: ${fm.status})`); bad++;
  }
}
for (const link of text.matchAll(/\((?:\.\/)?backlog\/([^)#\s]+\.md)\)/g)) {
  if (!existsSync(join(dir, link[1]))) { console.log(`index links a missing item: ${link[1]}`); bad++; }
}
process.exit(bad ? 1 : 0);
```

- [ ] **Step 4: Re-point the three starter YAMLs**

`no-unsafe-casts.yaml`: `run: "cmd:node runtime/starter/evaluators/no-unsafe-casts.mjs"`.
`references-valid.yaml`: `run: "cmd:node runtime/starter/evaluators/references-valid.mjs"`, property → `"every item's references path (and #anchor heading) resolves"`.
`index-fresh.yaml`: `run: "cmd:node runtime/starter/evaluators/index-fresh.mjs"`, DELETE the `fix:` line, property → `"the index lists every live (non-shipped/dropped) item and links only existing item files"`.

- [ ] **Step 5: Write evaluator unit tests** (same starter-pack.test.mjs; hermetic temp fixtures)

```js
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EV = (n) => fileURLToPath(new URL(`../../starter/evaluators/${n}`, import.meta.url));

test('no-unsafe-casts evaluator: flags `as any` in scanned root, honors empty RUNTIME_STAGED_PATHS', () => {
  const d = mkdtempSync(join(tmpdir(), 'nuc-'));
  mkdirSync(join(d, 'services'));
  writeFileSync(join(d, 'services', 'x.ts'), 'const a = b as any;\n');
  assert.equal(spawnSync('node', [EV('no-unsafe-casts.mjs')], { cwd: d, encoding: 'utf8' }).status, 1);
  const r0 = spawnSync('node', [EV('no-unsafe-casts.mjs')], { cwd: d, encoding: 'utf8',
    env: { ...process.env, RUNTIME_STAGED_PATHS: '' } });   // presence + empty ⇒ nothing staged ⇒ pass
  assert.equal(r0.status, 0);
});

test('references-valid evaluator: dangling path → 1; resolving path+anchor → 0', () => {
  const d = mkdtempSync(join(tmpdir(), 'rv-'));
  mkdirSync(join(d, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(d, 'docs', 'target.md'), '# Real Heading\nbody\n');
  writeFileSync(join(d, 'docs', 'backlog', 'ok.md'), '---\nid: ok\nstatus: queued\nreferences: ["docs/target.md#real-heading"]\n---\n');
  assert.equal(spawnSync('node', [EV('references-valid.mjs')], { cwd: d, encoding: 'utf8' }).status, 0);
  writeFileSync(join(d, 'docs', 'backlog', 'bad.md'), '---\nid: bad\nstatus: queued\nreferences: ["docs/nope.md"]\n---\n');
  const r = spawnSync('node', [EV('references-valid.mjs')], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /dangling reference/);
});

test('index-fresh evaluator: unlisted live item → 1; listed → 0; dangling index link → 1', () => {
  const d = mkdtempSync(join(tmpdir(), 'if-'));
  mkdirSync(join(d, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(d, 'docs', 'backlog', 'a.md'), '---\nid: a\nstatus: queued\n---\n');
  writeFileSync(join(d, 'docs', 'BACKLOG.md'), 'nothing here\n');
  assert.equal(spawnSync('node', [EV('index-fresh.mjs')], { cwd: d, encoding: 'utf8' }).status, 1);
  writeFileSync(join(d, 'docs', 'BACKLOG.md'), '- [a](backlog/a.md)\n');
  assert.equal(spawnSync('node', [EV('index-fresh.mjs')], { cwd: d, encoding: 'utf8' }).status, 0);
  writeFileSync(join(d, 'docs', 'BACKLOG.md'), '- [a](backlog/a.md)\n- [ghost](backlog/ghost.md)\n');
  assert.equal(spawnSync('node', [EV('index-fresh.mjs')], { cwd: d, encoding: 'utf8' }).status, 1);
});
```

- [ ] **Step 6: Run to verify green + EMPIRICAL GATE** — `node --test runtime/engine/test/starter-pack.test.mjs` all PASS. Then against the REAL repo (from the worktree root): `node runtime/starter/evaluators/references-valid.mjs`, `node runtime/starter/evaluators/index-fresh.mjs` → both MUST exit 0 (backlog-lint keeps these true today; if index-fresh flags live items missing from the index, restrict the live-statuses list to `['active','queued']` and update the yaml property text to match — verify which statuses the real index actually lists exhaustively before choosing).

- [ ] **Step 7: Commit**

```bash
git add runtime/starter/ runtime/engine/test/starter-pack.test.mjs
git commit --no-verify -m "feat(runtime): self-contained starter pack — generic evaluators ship inside runtime/ (redteam item 7)" && git log --oneline -1
```

---

### Task 10: gate-clean sha-freshness teeth in postflight (backlog item 9)

**Files:**
- Modify: `.claude/skills/backlog-next/postflight.mjs` (new pure `gateCleanFreshness`; main wires git resolution)
- Test: `.claude/skills/backlog-next/test/backward-evidence.test.mjs`

**Interfaces:**
- Produces: `gateCleanFreshness({cleanValue, filesSinceClean}): {failures, warnings}` — pure.
  - `filesSinceClean: null` ⇒ sha unresolvable against HEAD (squash-merge) → 1 warning, no failure.
  - files ⊆ sanctioned docs tail (`docs/backlog/**`, `docs/BACKLOG.md`) → clean (the 6.5/6.6 ship+index commits and decision-log appends are the legal post-recheck tail).
  - any other path → `ship-gate-evidence` FAILURE (unadjudicated post-recheck code commit — the `--no-verify` escape this closes).
- main(): only when a fresh gate-clean record exists with a `sha`; resolve `git merge-base --is-ancestor <sha> HEAD` → ancestor ⇒ `git diff --name-only <sha>..HEAD`, else null. Reuse the file's existing safe-shell helper for both calls.

- [ ] **Step 1: Write the failing tests**

```js
// append to .claude/skills/backlog-next/test/backward-evidence.test.mjs
import { gateCleanFreshness } from '../postflight.mjs';

test('sha teeth: docs-only tail after gate-clean is sanctioned', () => {
  const r = gateCleanFreshness({ cleanValue: { sha: 'abc' },
    filesSinceClean: ['docs/backlog/x.md', 'docs/BACKLOG.md'] });
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.warnings, []);
});

test('sha teeth: a non-docs path after gate-clean FAILS ship-gate-evidence (the --no-verify escape)', () => {
  const r = gateCleanFreshness({ cleanValue: { sha: 'abc' },
    filesSinceClean: ['docs/backlog/x.md', 'services/x/src/handler.ts'] });
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].rule, 'ship-gate-evidence');
  assert.match(r.failures[0].message, /after the last gate-clean/);
  assert.match(r.failures[0].detail, /services\/x\/src\/handler\.ts/);
});

test('sha teeth: unresolvable sha (squash-merge) degrades to a warning, never a false failure', () => {
  const r = gateCleanFreshness({ cleanValue: { sha: 'abc' }, filesSinceClean: null });
  assert.deepEqual(r.failures, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /not an ancestor of HEAD/);
});
```

- [ ] **Step 2: Run to verify they fail** — `node --test .claude/skills/backlog-next/test/backward-evidence.test.mjs` → FAIL (`gateCleanFreshness` not exported).

- [ ] **Step 3: Implement** — in postflight.mjs, next to `backwardEvidenceFailures`:

```js
/** Item-9 teeth (redteam 2026-07-04): the only sanctioned commits AFTER a green ship-recheck are the
 * 6.5/6.6 docs tail. A non-docs path in <gate-clean.sha>..HEAD is an unadjudicated code commit.
 * filesSinceClean == null ⇒ the sha is not an ancestor of HEAD (squash-merge) — warn, cannot adjudicate. */
const SANCTIONED_POST_RECHECK = [/^docs\/backlog\//, /^docs\/BACKLOG\.md$/];
export function gateCleanFreshness({ cleanValue, filesSinceClean }) {
  if (filesSinceClean == null) return { failures: [], warnings: [
    `gate-clean sha ${cleanValue?.sha ?? '(missing)'} is not an ancestor of HEAD — cannot adjudicate post-recheck commits (squash-merge?); verify the branch delta manually.`] };
  const code = filesSinceClean.filter((f) => !SANCTIONED_POST_RECHECK.some((rx) => rx.test(f)));
  if (!code.length) return { failures: [], warnings: [] };
  return { failures: [{ rule: 'ship-gate-evidence',
    message: `${code.length} non-docs path(s) changed after the last gate-clean (${cleanValue.sha}) — unadjudicated code commits; re-run ship-recheck.`,
    detail: code.join('\n') }], warnings: [] };
}
```

In main(), inside the existing `args.id && (simple|complex)` block (postflight.mjs:226-236), after merging `backwardEvidenceFailures`' results: read the gate-clean record again, and when it is `complete` with a `value.sha`, resolve ancestry + diff via the file's existing safe-shell helper and merge `gateCleanFreshness(...)`'s failures/warnings the same way. (Adapt to the helper's actual `{ok, out}` shape in the file.)

- [ ] **Step 4: Run to verify green** — `node --test .claude/skills/backlog-next/test/*.test.mjs` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-next/postflight.mjs .claude/skills/backlog-next/test/backward-evidence.test.mjs
git commit --no-verify -m "feat(backlog-next): gate-clean sha teeth — non-docs commits after ship-recheck fail postflight (redteam item 9)" && git log --oneline -1
```

---

### Task 11: curate-guard injectable persist seam + write-order/torn-write regressions (backlog item 10)

**Files:**
- Modify: `runtime/engine/backward/lib/curate-guard.mjs` (persist seam)
- Test: `runtime/engine/backward/test/curate-guard.test.mjs`

**Interfaces:**
- `curateGuard({..., persist})` — `persist = { mkdir: mkdirSync, write: writeFileSync }` default; the two YAML writes at curate-guard.mjs:53-55 go through it. No behavior change with the default.

- [ ] **Step 1: Write the failing tests** (reuse the file's existing supersede fixtures — guard entry + successor draft — from `runtime/engine/backward/test/_fixtures.mjs`; match the existing supersede test's argument shape exactly)

```js
// append to runtime/engine/backward/test/curate-guard.test.mjs
test('F-order: the guard YAML is the LAST write (commit point) — successor lands first', async () => {
  const seq = [];
  const persist = { mkdir: () => {}, write: (path) => seq.push(path) };
  await curateGuard({ /* same supersede args as the existing green supersede test */, persist });
  assert.equal(seq.length, 2);
  assert.match(seq[0], /<successor-id>\.yaml$/);     // use the fixture's real successor id
  assert.match(seq[1], /<guard-id>\.yaml$/);          // guard write LAST — swapping the lines fails here
});

test('F-torn: a crash on the guard write leaves the guard ACTIVE on disk; the retry converges', async () => {
  const checksDir = mkdtempSync(join(tmpdir(), 'cg-'));
  writeFileSync(join(checksDir, '<guard-id>.yaml'), stringify(<active guard fixture>));   // pre-existing ACTIVE guard
  const journal = inMemoryJournal();
  let calls = 0;
  const torn = { mkdir: mkdirSync, write: (p, body) => {
    if (++calls === 2) throw new Error('disk full');   // successor landed, guard write crashes
    writeFileSync(p, body);
  } };
  await assert.rejects(() => curateGuard({ /* supersede args */, journal, checksDir, persist: torn }));
  const onDisk = parse(readFileSync(join(checksDir, '<guard-id>.yaml'), 'utf8'));
  assert.equal(onDisk.status, 'active');                                   // guard NOT superseded on disk
  assert.equal(journal.read('backward'), null);                            // nothing journaled (step fn threw)
  const r = await curateGuard({ /* same args */, journal, checksDir });    // retry, default persist
  assert.equal(r.decision.transition, 'supersede');
  assert.equal(parse(readFileSync(join(checksDir, '<guard-id>.yaml'), 'utf8')).status, 'superseded');
});
```

(`<guard-id>`/`<successor-id>`/arg spread: copy from the file's existing passing supersede test — same fixtures, same `floorApproval`; only `persist`, `journal`, `checksDir` differ. Import `parse, stringify` from `yaml` and the temp-dir helpers as in sibling tests. If `journal.read('backward')` is non-null because `begin` ran elsewhere in the fixture path, assert instead that no step key matching `/^curate:/` is `complete`.)

- [ ] **Step 2: Run to verify they fail** — `node --test runtime/engine/backward/test/curate-guard.test.mjs` → FAIL (`persist` not accepted / writes not injectable).

- [ ] **Step 3: Implement** — in `curateGuard`'s signature add `persist = { mkdir: mkdirSync, write: writeFileSync }`, and replace lines 53-55:

```js
    // floor decision 2026-07-04: successor YAML FIRST, guard YAML LAST — the guard write is the commit
    // point of the act. (Ordering + torn-write behavior are pinned by F-order / F-torn regressions.)
    persist.mkdir(checksDir, { recursive: true });
    if (res.successor) persist.write(join(checksDir, `${res.successor.id}.yaml`), stringify(res.successor), 'utf8');
    persist.write(join(checksDir, `${res.check.id}.yaml`), stringify(res.check), 'utf8');   // guard LAST = commit point
```

- [ ] **Step 4: Run to verify green, then prove the teeth** — `node --test runtime/engine/backward/test/curate-guard.test.mjs` all PASS. Then TEMPORARILY swap the two `persist.write` lines and re-run: F-order MUST fail. Swap back, re-run green. (This is the "swapping the two writeFileSync lines passes all 369 tests" hole — prove it is closed.)

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/backward/lib/curate-guard.mjs runtime/engine/backward/test/curate-guard.test.mjs
git commit --no-verify -m "test(runtime): persist seam + write-order/torn-write regressions for curate supersede (redteam item 10)" && git log --oneline -1
```

---

### Task 12: Full-suite verification + empirical sweep

**Files:** none new — verification only.

- [ ] **Step 1: Full runtime + skills test sweep**

```bash
node --test runtime/engine/test/*.test.mjs runtime/engine/backward/test/*.test.mjs \
  runtime/engine/loop/test/*.test.mjs runtime/adapters/git/test/*.test.mjs \
  runtime/adapters/claude-code/test/*.test.mjs runtime/content/test/*.test.mjs \
  runtime/eval/test/*.test.mjs 2>&1 | tail -8
node --test .claude/skills/backlog-next/test/*.test.mjs 2>&1 | tail -8
node --test .claude/skills/backlog-lint/test/*.test.mjs 2>&1 | tail -8
```

Expected: 0 fail everywhere. Capture the pass counts for the validation gate.

- [ ] **Step 2: Empirical CLI sweep on the real repo** (each was an empirical red-team claim — re-verify the fix end-to-end)

```bash
node runtime/engine/lib/meta-check.mjs; echo "meta-check(content): $?"          # expect 0
node runtime/engine/lib/meta-check.mjs --checks-dir runtime/starter/checks; echo "meta-check(starter): $?"  # expect 0
node runtime/engine/lib/scope-gate.mjs --single-active; echo "single-active: $?" # expect 0 (was 1)
node runtime/starter/evaluators/references-valid.mjs; echo "refs: $?"            # expect 0
node runtime/starter/evaluators/index-fresh.mjs; echo "index: $?"                # expect 0
```

- [ ] **Step 3: True-affected resolver + lint** (skill Step 6.2)

```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
[ -n "$AFFECTED" ] && pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"
node .claude/skills/backlog-lint/lint.mjs --fix
```

Expected: runtime/ + .claude/skills are not nx projects → likely "no affected projects"; lint green.

- [ ] **Step 4: no commit** — this task produces no changes; if Step 2/3 surface drift, fix it in the owning task's files and amend THAT area with a follow-up commit, then re-run this task.

---

## Self-review notes

- **Spec coverage:** items 1→T3, 2→T4, 3→T1, 4→T2, 5→T7, 6→T8, 7→T9, 8→T5+T6, 9→T10, 10→T11; T12 is the empirical gate the red-team methodology demands. All 10 covered.
- **Type consistency:** `registryErrorLines` (T3) is consumed by T7's CLI; `scopedStagedFiles` rename (T5) has a grep step for stragglers; `activePartition` (T8) replaces deleted `singleActive` with a grep-enforced rename; `gateCleanFreshness` merges into the existing `{failures, warnings}` postflight shape.
- **Known verify-at-impl points (flagged in-task, not placeholders):** T11 copies fixture arg shapes from the existing green supersede test; T10 adapts to the file's safe-shell helper shape; T9 Step 6 verifies which statuses the real index lists exhaustively before finalizing the live-status set.
