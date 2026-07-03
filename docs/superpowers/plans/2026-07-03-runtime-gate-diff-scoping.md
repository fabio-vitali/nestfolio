# Runtime Gate Diff-Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline + visible, per the epic protocol — NOT worker-isolating subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pre-commit gate block only on violations attributable to the staged files, not on pre-existing whole-tree debt — realizing the make-it-fire spec's "scoped to the staged files" intent without weakening the frozen invariant floor.

**Architecture:** Thread a new, optional, concrete `stagedFiles` list from the ring-2 gate down through `runWatch → runCheck → resolveEvaluator`, distributed into each evaluator's native scan channel (cmd → `RUNTIME_STAGED_PATHS` env + a staged mode in the shared `text-scan.mjs`; eslint → staged∩scope file args; module → unchanged, whole-scope). Attribution narrows *what a check scans*, never *which checks run* (the frozen §6/§11 selection floor is untouched). Separately, fix the mis-bound `backlog-id-matches-filename` check (zero-arg crash) with a runtime-owned adapter, then wire + smoke the gate.

**Tech Stack:** Node ≥24 (native `.ts` type-stripping, zero build), `node:test`, zod schemas, bash pre-commit hook via `pnpm run prepare`.

## Global Constraints

- **Node ≥24**, zero build. `.mjs` logic imports `.ts` schemas with explicit `.ts` extensions.
- **Tests:** `node --test`; runtime tests live under the globs in `runtime/project.json`'s `test` target. Assert with `node:assert/strict`.
- **`stagedFiles` is a DISTINCT param from `changedScope`.** `changedScope` (selection, may carry globs like `['**/*']`) is untouched. `stagedFiles` (attribution) is `undefined` on the audit/CLI path (→ whole-tree) and a concrete repo-relative list (possibly `[]`) from the gate. All signature changes are additive/optional.
- **Staged-mode env keys on PRESENCE:** `'RUNTIME_STAGED_PATHS' in process.env` — `''` means *nothing staged* (scan nothing); *unset* means *whole-tree*.
- **Frozen floor:** do NOT touch `find-by-scope.mjs` selection or the invariant-ride semantics (§6/§11 frozen).
- **Ring boundary:** `runtime/engine/**` must never import `.claude/skills/` or `runtime/adapters/` (enforced by `runtime/engine/test/import-boundary.test.mjs`). The backlog-id adapter is content-ring (`runtime/content/**`), which may import project skills.
- **Commits:** one per task, on branch `runtime-make-it-fire` (not a worktree — normal commits; the pre-commit hook stays the non-gate version until Task 5 Step 2). No `--no-verify` needed pre-Task-5.

## File Structure

- `tools/lib/text-scan.mjs` — MODIFY: add `stagedPaths()` + a staged branch in `walkFiles`. The shared scanner seam; all 5 dogfood cmd tools inherit staged mode for free.
- `tools/lib/text-scan.test.mjs` — MODIFY: add staged-mode tests.
- `runtime/engine/lib/resolve-evaluator.mjs` — MODIFY: add `stagedFiles` param; cmd sets `RUNTIME_STAGED_PATHS` env; eslint uses new exported `eslintFiles()` helper; add a header `§ delta` note.
- `runtime/engine/test/resolve-evaluator.test.mjs` — MODIFY: cmd env + `eslintFiles` unit tests.
- `runtime/engine/lib/run-check.mjs` — MODIFY: add `stagedFiles` param, forward to `resolveEvaluator`.
- `runtime/engine/lib/run-watch.mjs` — MODIFY: accept `stagedFiles`, forward to each `runCheck`.
- `runtime/engine/test/run-check.test.mjs` — MODIFY: assert `stagedFiles` forwarding.
- `runtime/adapters/git/pre-commit-gate.mjs` — MODIFY: pass `stagedFiles: readStaged()` into `runWatch` (already computes staged set for `changedScope`).
- `runtime/adapters/git/test/pre-commit-gate.test.mjs` — MODIFY: assert the gate passes `stagedFiles` into its injected `watch`.
- `runtime/content/lib/backlog-id-core.mjs` — CREATE: zero-arg adapter wrapping `ruleIdMatchesFilename`.
- `runtime/content/test/backlog-id-core.test.mjs` — CREATE: adapter tests.
- `runtime/content/checks/backlog-id-matches-filename.yaml` — MODIFY: re-point `module:` at the adapter.
- `runtime/project.json` — MODIFY: add `runtime/content/**/test/*.test.mjs` to the `test` command glob.
- `scripts/verify-structure.sh` — MODIFY: insert the gate call before the services-only early-exit.

---

### Task 1: `text-scan.mjs` staged mode (the shared attribution seam)

**Files:**
- Modify: `tools/lib/text-scan.mjs`
- Test: `tools/lib/text-scan.test.mjs`

**Interfaces:**
- Produces: `stagedPaths(): string[] | null` (exported); `walkFiles(root, opts)` gains staged behavior keyed on `RUNTIME_STAGED_PATHS` presence. `runGate`/`walkFiles` callers (all 5 dogfood tools) inherit it unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `tools/lib/text-scan.test.mjs` (after TS4):

```js
test('TS5 walkFiles staged mode: RUNTIME_STAGED_PATHS narrows to staged paths passing the filters', () => {
  const root = tree({ 'services/x/src/a.ts': 'A', 'services/x/src/b.ts': 'B', 'services/y/src/c.ts': 'C', 'services/x/test/d.ts': 'D' });
  const prev = process.env.RUNTIME_STAGED_PATHS;
  try {
    process.env.RUNTIME_STAGED_PATHS = 'services/x/src/a.ts\nservices/x/test/d.ts\nservices/y/src/c.js';
    const rels = [...walkFiles(root, { includeUnder: ['services'], ext: ['.ts'], excludeTest: true })].map((f) => f.relPath).sort();
    // a.ts staged+passes; d.ts excluded (test/); c.js wrong ext; b.ts/c.ts not staged
    assert.deepEqual(rels, ['services/x/src/a.ts']);
  } finally { restoreEnv(prev); clean(root); }
});

test('TS6 walkFiles staged mode: empty string → nothing; path outside includeUnder dropped; unset → whole-tree', () => {
  const root = tree({ 'services/x/src/a.ts': 'A', 'libs/z/src/e.ts': 'E' });
  const prev = process.env.RUNTIME_STAGED_PATHS;
  try {
    process.env.RUNTIME_STAGED_PATHS = '';                       // set-but-empty → nothing staged
    assert.deepEqual([...walkFiles(root, { includeUnder: ['services'], ext: ['.ts'] })].map((f) => f.relPath), []);
    process.env.RUNTIME_STAGED_PATHS = 'libs/z/src/e.ts';        // not under includeUnder:['services']
    assert.deepEqual([...walkFiles(root, { includeUnder: ['services'], ext: ['.ts'] })].map((f) => f.relPath), []);
    delete process.env.RUNTIME_STAGED_PATHS;                     // unset → whole-tree
    assert.deepEqual([...walkFiles(root, { includeUnder: ['services'], ext: ['.ts'] })].map((f) => f.relPath), ['services/x/src/a.ts']);
  } finally { restoreEnv(prev); clean(root); }
});
```

And add the `restoreEnv` helper next to `clean` (near line 13):

```js
const restoreEnv = (prev) => { if (prev === undefined) delete process.env.RUNTIME_STAGED_PATHS; else process.env.RUNTIME_STAGED_PATHS = prev; };
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/lib/text-scan.test.mjs`
Expected: FAIL — TS5/TS6 fail (staged mode not implemented; `walkFiles` still whole-tree).

- [ ] **Step 3: Implement the staged mode**

In `tools/lib/text-scan.mjs`, add `stagedPaths` (after `lineOf`, ~line 10) and a staged branch at the top of `walkFiles`, plus the `stagedFiles` generator. Replace the current `walkFiles` export with:

```js
/** Attribution seam: RUNTIME_STAGED_PATHS (newline list, repo-relative) narrows the walk to those paths.
 *  Keyed on PRESENCE: unset → whole-tree (null); '' → nothing staged ([]); set → that list. */
export function stagedPaths() {
  if (!('RUNTIME_STAGED_PATHS' in process.env)) return null;
  return process.env.RUNTIME_STAGED_PATHS.split('\n').map((s) => s.trim()).filter(Boolean);
}

export function* walkFiles(root, { includeUnder = ['services'], ext = ['.ts'], excludeFragments = DEFAULT_EXCLUDE, excludeTest = false } = {}) {
  const staged = stagedPaths();
  if (staged) { yield* stagedWalk(root, staged, { includeUnder, ext, excludeTest }); return; }
  const seen = new Set();
  for (const u of includeUnder) {
    for (const abs of walk(join(root, u), excludeFragments)) {
      if (!ext.some((e) => abs.endsWith(e))) continue;
      const rel = relative(root, abs).split(sep).join('/');
      if (excludeTest && /(^|\/)test\//.test(rel)) continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      let text; try { text = readFileSync(abs, 'utf8'); } catch { continue; }
      yield { relPath: rel, text };
    }
  }
}

function* stagedWalk(root, staged, { includeUnder, ext, excludeTest }) {
  const seen = new Set();
  for (const rel of staged) {
    if (!includeUnder.some((u) => rel === u || rel.startsWith(`${u}/`))) continue;
    if (!ext.some((e) => rel.endsWith(e))) continue;
    if (excludeTest && /(^|\/)test\//.test(rel)) continue;
    if (seen.has(rel)) continue;
    seen.add(rel);
    let text; try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    yield { relPath: rel, text };
  }
}
```

> Note: `staged` is `null` when unset (falsy → whole-tree) and `[]` when the env is `''` (truthy-empty-array → `stagedWalk` yields nothing). The `if (staged)` guard is correct because `[]` is truthy in JS.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/lib/text-scan.test.mjs`
Expected: PASS — TS1–TS6 all green (TS1–TS4 unchanged: env unset → whole-tree).

- [ ] **Step 5: Commit**

```bash
git add tools/lib/text-scan.mjs tools/lib/text-scan.test.mjs
git commit -m "feat(runtime): text-scan staged mode via RUNTIME_STAGED_PATHS (diff-scoping seam)"
```

---

### Task 2: `resolve-evaluator.mjs` — `stagedFiles` attribution for cmd + eslint

**Files:**
- Modify: `runtime/engine/lib/resolve-evaluator.mjs`
- Test: `runtime/engine/test/resolve-evaluator.test.mjs`

**Interfaces:**
- Consumes: `stagedPaths` seam from Task 1 (via the child env); `globsOverlap(a, b)` from `./glob-overlap.mjs`.
- Produces: `resolveEvaluator({ check, judge, stagedFiles })` — cmd sets `RUNTIME_STAGED_PATHS` env when `stagedFiles != null`; eslint uses `eslintFiles(check, stagedFiles)`. `eslintFiles(check, stagedFiles): string[]` exported.

- [ ] **Step 1: Write the failing tests**

Add to `runtime/engine/test/resolve-evaluator.test.mjs`. Extend the top imports to include `eslintFiles`:

```js
import { resolveEvaluator, eslintFiles } from '../lib/resolve-evaluator.mjs';
```

Then append:

```js
// SF1 — cmd: check receives RUNTIME_STAGED_PATHS from stagedFiles; undefined → env unset
test('a cmd: check receives RUNTIME_STAGED_PATHS from stagedFiles', () => withTmpDir((root) => {
  const script = join(root, 's.mjs');
  writeFileSync(script, 'process.stdout.write(process.env.RUNTIME_STAGED_PATHS ?? "<unset>"); process.exit(1);', 'utf8');
  const check = validCheck({ evaluator: { type: 'deterministic', run: `cmd:node ${script}` } });
  const scoped = resolveEvaluator({ check, stagedFiles: ['libs/a/src/x.ts', 'libs/a/src/y.ts'] }).invoke();
  assert.equal(scoped[0].evidence, 'libs/a/src/x.ts\nlibs/a/src/y.ts');
  const audit = resolveEvaluator({ check }).invoke();
  assert.equal(audit[0].evidence, '<unset>');
  const empty = resolveEvaluator({ check, stagedFiles: [] }).invoke();
  assert.equal(empty[0].evidence, '');   // set-but-empty → '' (nothing staged), NOT <unset>
}));

// SF2 — eslintFiles: undefined → whole scope; list → staged∩scope; empty intersection → []
test('eslintFiles narrows staged files to the check scope', () => {
  const check = validCheck({ scope: { paths: ['libs/**/src/**/*.ts'] }, evaluator: { type: 'deterministic', run: 'eslint:@nx/enforce-module-boundaries' } });
  assert.deepEqual(eslintFiles(check, undefined), ['libs/**/src/**/*.ts']);
  assert.deepEqual(eslintFiles(check, ['libs/a/src/x.ts', 'services/b/src/y.ts']), ['libs/a/src/x.ts']);
  assert.deepEqual(eslintFiles(check, []), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test runtime/engine/test/resolve-evaluator.test.mjs`
Expected: FAIL — `eslintFiles` is not exported; SF1 cmd env not set (evidence is `<unset>`).

- [ ] **Step 3: Implement**

In `runtime/engine/lib/resolve-evaluator.mjs`: (a) add the `globsOverlap` import and update the header note; (b) add the `eslintFiles` export; (c) add `stagedFiles` to the signature; (d) set the cmd env; (e) use `eslintFiles` in the eslint branch.

Header (line 2–4) — append one line to the existing comment:
```js
// SPEC 3 §-delta (diff-scoping): resolveEvaluator takes an optional concrete `stagedFiles` list and narrows
// attribution — cmd via RUNTIME_STAGED_PATHS env, eslint via staged∩scope file args. Additive; audit path unaffected.
```

Add after the imports (after line 10):
```js
import { globsOverlap } from './glob-overlap.mjs';

/** staged files (if provided) that match this check's scope globs; else the check's whole scope (audit path). */
export function eslintFiles(check, stagedFiles) {
  if (stagedFiles == null) return check.scope.paths;
  return stagedFiles.filter((f) => check.scope.paths.some((p) => globsOverlap(f, p)));
}
```

Change the signature (line 18):
```js
export function resolveEvaluator({ check, judge, stagedFiles }) {
```

Replace the `cmd` branch (lines 30–36) with:
```js
  if (scheme === 'cmd') {
    return { kind: 'deterministic', invoke: () => {
      const env = stagedFiles == null ? process.env : { ...process.env, RUNTIME_STAGED_PATHS: stagedFiles.join('\n') };
      const r = spawnSync(target, { shell: true, encoding: 'utf8', env });
      if (r.status === 0) return [];
      return toFindings([{ detail: check.property, evidence: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), scope: check.scope.paths }], check);
    } };
  }
```

Replace the `eslint` branch (lines 49–54) with:
```js
  // eslint:
  if (!target.length) throw new EvaluatorUnresolved(check.evaluator.run, 'empty eslint rule id');
  return { kind: 'deterministic', invoke: () => {
    const files = eslintFiles(check, stagedFiles);
    if (!files.length) return [];
    const r = spawnSync('npx', ['eslint', '--rule', `{"${target}":"error"}`, ...files], { encoding: 'utf8' });
    return r.status === 0 ? [] : toFindings([{ detail: check.property, evidence: (r.stdout ?? '').trim(), scope: check.scope.paths }], check);
  } };
```

> `stagedFiles == null` (undefined) → whole-scope/env-unset (audit, unchanged). `stagedFiles === []` → `RUNTIME_STAGED_PATHS=''` (cmd scans nothing) and `eslintFiles` returns `[]` (no spawn).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test runtime/engine/test/resolve-evaluator.test.mjs`
Expected: PASS — SF1, SF2, and all pre-existing F1–F4/E0 tests green (the module/skill branches and the no-`stagedFiles` cmd path are unchanged).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/resolve-evaluator.mjs runtime/engine/test/resolve-evaluator.test.mjs
git commit -m "feat(runtime): resolveEvaluator threads stagedFiles into cmd env + eslint file args"
```

---

### Task 3: thread `stagedFiles` through `run-check.mjs` + `run-watch.mjs`

**Files:**
- Modify: `runtime/engine/lib/run-check.mjs`
- Modify: `runtime/engine/lib/run-watch.mjs`
- Test: `runtime/engine/test/run-check.test.mjs`

**Interfaces:**
- Consumes: `resolveEvaluator({ check, judge, stagedFiles })` from Task 2.
- Produces: `runCheck({ check, context, judge, stagedFiles })`; `runWatch({ registry, trigger, changedScope, stagedFiles, judge })` forwards `stagedFiles` into each `runCheck`.

- [ ] **Step 1: Write the failing test**

Add to `runtime/engine/test/run-check.test.mjs`. Ensure the imports include `withTmpDir`, `validCheck` (from `./_fixtures.mjs`), `writeFileSync` (`node:fs`), and `join` (`node:path`) — add any that are missing. Then append:

```js
// SF3 — runCheck forwards stagedFiles to the evaluator (observable via the cmd env)
test('runCheck forwards stagedFiles to the evaluator', async () => {
  await withTmpDir(async (root) => {
    const script = join(root, 's.mjs');
    writeFileSync(script, 'process.stdout.write(process.env.RUNTIME_STAGED_PATHS ?? "<unset>"); process.exit(1);', 'utf8');
    const check = validCheck({ contexts: ['invariant'], evaluator: { type: 'deterministic', run: `cmd:node ${script}` } });
    const r = await runCheck({ check, context: 'invariant', stagedFiles: ['libs/a/src/x.ts'] });
    assert.equal(r.ran, true);
    assert.equal(r.findings[0].evidence, 'libs/a/src/x.ts');
  });
});
```

> If `withTmpDir` is sync-only (takes a sync callback), inline a `mkdtempSync`/`rmSync` pair instead, mirroring Task 4's tmp handling.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test runtime/engine/test/run-check.test.mjs`
Expected: FAIL — evidence is `<unset>` (runCheck drops `stagedFiles`).

- [ ] **Step 3: Implement the threading**

`runtime/engine/lib/run-check.mjs` — replace `runCheck` (lines 7–14):
```js
export async function runCheck({ check, context, judge, stagedFiles }) {
  if (!check.contexts.includes(context)) {
    return { findings: [], ran: false, skippedReason: 'context-not-declared' };
  }
  const { invoke } = resolveEvaluator({ check, judge, stagedFiles });
  const findings = await invoke();
  return { findings: findings.map((f) => ({ ...f, kind: check.kind })), ran: true };
}
```

`runtime/engine/lib/run-watch.mjs` — add `stagedFiles` to `runWatch`'s params (line 24) and pass it into `runCheck` (line 29):
```js
export async function runWatch({ registry, trigger, changedScope, stagedFiles, judge }) {
```
```js
    try { result = await runCheck({ check, context, judge, stagedFiles }); }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test runtime/engine/test/run-check.test.mjs runtime/engine/test/run-watch.test.mjs`
Expected: PASS — SF3 green; all existing run-check/run-watch tests still pass (`stagedFiles` is `undefined` in those → whole-tree, unchanged).

- [ ] **Step 5: Commit**

```bash
git add runtime/engine/lib/run-check.mjs runtime/engine/lib/run-watch.mjs runtime/engine/test/run-check.test.mjs
git commit -m "feat(runtime): thread stagedFiles through runCheck + runWatch"
```

---

### Task 4: backlog-id zero-arg adapter + re-point the check + extend the test glob

**Files:**
- Create: `runtime/content/lib/backlog-id-core.mjs`
- Create: `runtime/content/test/backlog-id-core.test.mjs`
- Modify: `runtime/content/checks/backlog-id-matches-filename.yaml`
- Modify: `runtime/project.json` (add the content test glob)

**Interfaces:**
- Consumes: `loadBacklogFiles(dir)` + `ruleIdMatchesFilename(file)` from `.claude/skills/backlog-lint/lib/`.
- Produces: `backlogIdViolations(dir = 'docs/backlog'): Array<{detail, scope, evidence}>` — a zero-arg-callable core matching the runtime `module:` convention.

- [ ] **Step 1: Extend the runtime test glob so content tests run**

In `runtime/project.json`, the `test` target `command` currently ends with `runtime/eval/test/*.test.mjs`. Add the content glob:
```
node --test runtime/engine/test/*.test.mjs runtime/engine/backward/test/*.test.mjs runtime/engine/loop/test/*.test.mjs runtime/adapters/**/test/*.test.mjs runtime/eval/test/*.test.mjs runtime/content/test/*.test.mjs
```
(`content/**/*` is already in the `test` target `inputs`, so cache invalidation already covers it.)

- [ ] **Step 2: Write the failing tests**

Create `runtime/content/test/backlog-id-core.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backlogIdViolations } from '../lib/backlog-id-core.mjs';

// writes docs/backlog/<name> with the given frontmatter id; returns the backlog dir + a cleanup root
function backlogDir(files) {
  const root = mkdtempSync(join(tmpdir(), 'nf-bid-'));
  const dir = join(root, 'docs', 'backlog');
  mkdirSync(dir, { recursive: true });
  for (const [name, id] of Object.entries(files)) writeFileSync(join(dir, name), `---\nid: ${id}\nstatus: parking\ntype: bug\n---\n\nbody\n`, 'utf8');
  return { dir, root };
}

test('BID1 zero-arg-callable; clean dir → no violations', () => {
  const { dir, root } = backlogDir({ 'alpha.md': 'alpha', 'beta.md': 'beta' });
  try { assert.deepEqual(backlogIdViolations(dir), []); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BID2 id ≠ filename → one violation with detail + evidence', () => {
  const { dir, root } = backlogDir({ 'alpha.md': 'WRONG', 'beta.md': 'beta' });
  try {
    const v = backlogIdViolations(dir);
    assert.equal(v.length, 1);
    assert.match(v[0].detail, /does not match filename/);
    assert.equal(v[0].evidence, 'alpha.md');
    assert.deepEqual(v[0].scope, ['docs/backlog/*.md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test runtime/content/test/backlog-id-core.test.mjs`
Expected: FAIL — `../lib/backlog-id-core.mjs` does not exist (import error).

- [ ] **Step 4: Implement the adapter**

Create `runtime/content/lib/backlog-id-core.mjs`:
```js
// runtime/content/lib/backlog-id-core.mjs — zero-arg core (runtime `module:` convention) wrapping the
// backlog-lint per-file rule ruleIdMatchesFilename, so backlog-id-matches-filename runs without args.
// Repo-integrity check: enforces the WHOLE backlog dir (not diff-scoped) — a wrong id is wrong regardless
// of what's staged. Reusable pattern: wrap a per-item lint rule in a zero-arg core for the runtime seam.
import { loadBacklogFiles } from '../../../.claude/skills/backlog-lint/lib/frontmatter.mjs';
import { ruleIdMatchesFilename } from '../../../.claude/skills/backlog-lint/lib/rules.mjs';

export function backlogIdViolations(dir = 'docs/backlog') {
  return loadBacklogFiles(dir)
    .flatMap(ruleIdMatchesFilename)
    .map((v) => ({ detail: v.message, scope: ['docs/backlog/*.md'], evidence: v.file }));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test runtime/content/test/backlog-id-core.test.mjs`
Expected: PASS — BID1 clean → `[]`; BID2 mismatch → one violation.

- [ ] **Step 6: Re-point the check YAML**

In `runtime/content/checks/backlog-id-matches-filename.yaml`, change the `run:` line to the adapter:
```yaml
  run: "module:runtime/content/lib/backlog-id-core.mjs#backlogIdViolations"
```

- [ ] **Step 7: Verify the check no longer crashes against the real registry**

Run: `node runtime/engine/lib/run-watch.mjs --on=commit --changed='docs/backlog/**'`
Expected: no `backlog-id-matches-filename ... evaluator error` line. (The backlog dir is lint-clean, so backlog-id contributes 0 findings; other checks may still print — that is fine, this step only asserts the crash is gone.)

- [ ] **Step 8: Full runtime suite green**

Run: `pnpm nx test runtime`
Expected: PASS — including the new `runtime/content/test/backlog-id-core.test.mjs` (proves Step 1's glob works).

- [ ] **Step 9: Commit**

```bash
git add runtime/content/lib/backlog-id-core.mjs runtime/content/test/backlog-id-core.test.mjs runtime/content/checks/backlog-id-matches-filename.yaml runtime/project.json
git commit -m "fix(runtime): backlog-id check via zero-arg adapter (was crashing zero-arg on a 1-arg rule)"
```

---

### Task 5: pass `stagedFiles` from the gate, wire `verify-structure.sh`, smoke both ways

**Files:**
- Modify: `runtime/adapters/git/pre-commit-gate.mjs`
- Test: `runtime/adapters/git/test/pre-commit-gate.test.mjs`
- Modify: `scripts/verify-structure.sh`

**Interfaces:**
- Consumes: `runWatch({ registry, trigger, changedScope, stagedFiles, judge })` from Task 3.

- [ ] **Step 1: Write the failing test (gate passes `stagedFiles`)**

In `runtime/adapters/git/test/pre-commit-gate.test.mjs`, add a test that the pure core forwards `stagedFiles` to its injected `watch`:
```js
test('runPreCommitGate passes stagedFiles into watch', async () => {
  let seen;
  const watch = async (args) => { seen = args; return []; };
  await runPreCommitGate({ stagedFiles: ['libs/a/src/x.ts'], registry: { checks: [] }, trigger: { on: 'commit', contexts: ['invariant'], cost_ceiling: 'cheap' }, watch });
  assert.deepEqual(seen.stagedFiles, ['libs/a/src/x.ts']);
  assert.deepEqual(seen.changedScope, ['libs/a/src/x.ts']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test runtime/adapters/git/test/pre-commit-gate.test.mjs`
Expected: FAIL — `seen.stagedFiles` is `undefined` (the core passes only `changedScope`).

- [ ] **Step 3: Pass `stagedFiles` in the gate core**

In `runtime/adapters/git/pre-commit-gate.mjs`, update `runPreCommitGate` (line 13–16) to forward `stagedFiles` alongside `changedScope`:
```js
export async function runPreCommitGate({ stagedFiles, registry, trigger, watch = runWatch }) {
  const findings = await watch({ registry, trigger, changedScope: stagedFiles, stagedFiles });
  return { exitCode: findings.length ? 1 : 0, findings };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test runtime/adapters/git/test/pre-commit-gate.test.mjs`
Expected: PASS — including the existing gate tests (they inject their own `watch` and are unaffected by the extra arg).

- [ ] **Step 5: Insert the gate into `verify-structure.sh`**

In `scripts/verify-structure.sh`, immediately after the `WARNINGS=0` line and its blank line, before `CHANGED_SERVICES=$(...)`, insert:
```sh
# Runtime enforcement gate (runtime-make-it-fire) — content-ring commit-trigger checks over the STAGED set,
# via the ring-1 watch engine (diff-scoped: findings are attributed to staged files). Runs on EVERY commit,
# so it MUST precede the services-only early-exit below. Fail-closed: non-zero exit blocks the commit.
if ! node runtime/adapters/git/pre-commit-gate.mjs; then
  exit 1
fi
```

- [ ] **Step 6: Reinstall the hook and confirm the gate landed**

Run: `pnpm run prepare`
Run: `grep -c pre-commit-gate .git/hooks/pre-commit`
Expected: `1`.

- [ ] **Step 7: Smoke — a staged violation is BLOCKED (diff-scoped red)**

```bash
mkdir -p libs/_smoke/src && printf 'export const x = (0 as any);\n' > libs/_smoke/src/bad.ts
git add libs/_smoke/src/bad.ts
node runtime/adapters/git/pre-commit-gate.mjs; echo "exit=$?"
git restore --staged libs/_smoke/src/bad.ts && rm -rf libs/_smoke
```
Expected: exactly one `✖ no-unsafe-casts …` line + `exit=1`. **Crucially, NO other `✖` lines** (no-ddb-scan / no-ddb-seed / no-states-runtime / no-agent-result-fallback / backlog-id) — they scan only the staged `bad.ts`, which trips none of them. If any pre-existing-debt finding appears, diff-scoping is not engaged — stop and diagnose (is `stagedFiles` reaching the cmd env?).

- [ ] **Step 8: Smoke — a clean staged set PASSES (green)**

```bash
mkdir -p libs/_smoke/src && printf 'export const y = 1;\n' > libs/_smoke/src/ok.ts
git add libs/_smoke/src/ok.ts
node runtime/adapters/git/pre-commit-gate.mjs; echo "exit=$?"
git restore --staged libs/_smoke/src/ok.ts && rm -rf libs/_smoke
```
Expected: no `✖` lines and `exit=0`. (This is the make-it-fire green path that was impossible under whole-tree scanning.)

- [ ] **Step 9: Full runtime suite green**

Run: `pnpm nx test runtime`
Expected: PASS.

- [ ] **Step 10: Commit (dogfood — this commit runs under the live gate)**

```bash
git add scripts/verify-structure.sh runtime/adapters/git/pre-commit-gate.mjs runtime/adapters/git/test/pre-commit-gate.test.mjs
git commit -m "feat(runtime): fire the diff-scoped pre-commit gate from verify-structure.sh (make-it-fire T2)"
git --no-pager log --oneline -1
```
Expected: the commit succeeds. The staged files (`scripts/`, `runtime/adapters/**`) are outside every source-drift check's scope (`services/**`, `libs/**`, `apps/**`) and the backlog dir is clean, so the gate passes with 0 findings — the gate greenlighting its own wiring commit is the end-to-end proof. If it blocks spuriously, do NOT `--no-verify`; diagnose (a spurious block is a real bug).

---

## Self-Review

**1. Spec coverage** — every design section maps to a task:

| Design § | Requirement | Task |
|---|---|---|
| §3 principle (attribution not selection) | thread `stagedFiles`, never touch `find-by-scope` | T2/T3 (thread), untouched selection |
| §4 cmd distribution | `RUNTIME_STAGED_PATHS` env + text-scan staged mode | T1 (seam) + T2 (env) |
| §4 eslint distribution | staged∩scope file args | T2 (`eslintFiles`) |
| §4 module (whole-scope) | unchanged | T2 (module branch untouched) |
| §4 threading | `runWatch → runCheck → resolveEvaluator` | T3 |
| §5 backlog-id crash | zero-arg adapter + re-point | T4 |
| §6 wire + smoke | `verify-structure.sh` + red/green smoke | T5 |
| §7 fail-closed | exit 0/1/2 + `RUNTIME_GATE_SKIP` | unchanged (T1 gate) |
| §8 testing | per-type threading + staged mode + adapter + smoke | T1–T5 |
| §9 debt filed | source debt + over-broad check | POST-PLAN (backlog-add at ship — not a code task) |
| §10 out of scope | no selection change, no debt remediation | honored |

No uncovered code requirement. §9 (debt filing) is a backlog-add activity handled at ship, deliberately not a TDD task.

**2. Placeholder scan** — no `TBD`/`TODO`/"handle errors"/"add validation". Every code step carries complete code; every command states its expected result. The only conditional ("if `withTmpDir` is sync-only") gives an explicit fallback. None found.

**3. Type consistency** — the threaded param is `stagedFiles` everywhere (gate → `runWatch` → `runCheck` → `resolveEvaluator`); `eslintFiles(check, stagedFiles)` is defined in T2 and used only there; `stagedPaths()` defined in T1 and consumed via the child env (never imported cross-ring); `backlogIdViolations(dir)` defined in T4 and referenced by the YAML `module:` ref. `stagedFiles == null` (undefined) vs `[]` (empty) semantics are consistent across text-scan (env presence), resolveEvaluator (cmd env / eslintFiles), and the gate. No drift.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-03-runtime-gate-diff-scoping.md`.

Per the runtime epic protocol (+ `feedback_no_worker_isolating_subagents`), execution is **inline + visible** via `superpowers:executing-plans`, batched by task with a green-test checkpoint after each. Five tasks on branch `runtime-make-it-fire`, then: file the §9 debt via `backlog-add`, reconcile the make-it-fire backlog file to reflect T1+T2 shipped, and `superpowers:finishing-a-development-branch` → single PR against `main`.
