# nx True-Affected Resolver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace nx's over-approximating `affected` with `tools/affected-projects.mjs`, which computes the TRUE affected set via reverse-reachability over the (correct) `nx graph` JSON, and wire it into every `nx affected` consumer.

**Architecture:** A small pure-Node ESM tool. Pure functions (`reverseDependents`, `mapFilesToProjects`, `affectedProjects`) operate on a parsed `nx graph` object; impure helpers (`changedFiles` via git, `loadGraph` via `nx graph --file`) feed the CLI. `affected = touched ∪ reverse-reachability(touched)` over the graph's dependency edges. Consumers (`compute-affected-services.sh`, 3 CI workflows, `/backlog-next` SKILL 6.2/6.4, `detect-deploy-needed.mjs`) swap `nx affected …` → `node tools/affected-projects.mjs …`.

**Tech Stack:** Node 20+ ESM, `node:test` + `node:assert/strict` (matching `tools/check-typed-subjects.test.mjs`), `nx graph --file` (daemon-free), git plumbing.

---

## Background (verified 2026-06-13, current `main`, nx 22.5.4)

The over-report **still reproduces and is severe**: `nx affected` returns **33 for ANY single-service change** (verified for `dashboard-bff`, `broker-sim-adpt`, `ledger-ctrl`, `yahoo-finance-adpt` — all → 33, the full `event-processor` dependent closure), while reverse-reachability over `nx graph` gives the truth: `dashboard-bff` (sink) → **1**, `ledger-ctrl` → 21, `yahoo-finance-adpt` → 23, `ui` → **6**, `event-processor` (real hub) → **33** (resolver and nx agree here).

The backlog's 2026-06-07 ground-truth column (yahoo→10, ledger-ctrl→11, event-processor→28) is now **stale** — the typed-subject program (WS-1/2/3 + capstone, shipped 2026-06-09→06-12) added real cross-service `/contracts` import edges, so the true closures grew. **Do NOT hardcode those numbers.** The two robust, topology-stable anchors are `dashboard-bff → 1` (a read-model sink nothing imports) and `ui → {advisory-mfe, dashboard-mfe, investor-mfe, ledger-mfe, nestfolio-host, ui}`. The unit tests use synthetic graphs (exact known answers); one golden test asserts these two anchors against a committed real-graph fixture.

## `nx graph` JSON shape (verified)

```
{ "graph": {
    "nodes": { "<name>": { "name", "type": "app"|"lib",
                            "data": { "root": "services/…", "projectType", "targets": { "<t>": {…} } } } },
    "dependencies": { "<source>": [ { "source", "target", "type" } ] } } }
```
Forward edges (`source` depends on `target`). Reverse them to get dependents.

## Files

- **Create** `tools/affected-projects.mjs` — the resolver (pure fns + CLI). One responsibility: emit the true affected project set.
- **Create** `tools/affected-projects.test.mjs` — `node:test` sibling (synthetic-graph unit tests + golden CLI test).
- **Create** `tools/fixtures/nx-graph.sample.json` — committed snapshot of the current `nx graph` for the golden test (deterministic; no nx needed to run tests).
- **Modify** `.github/scripts/compute-affected-services.sh:10` — source affected from the resolver.
- **Modify** `.github/workflows/pr-deploy.yml` (lint/test ~67-68, test-integration ~129).
- **Modify** `.github/workflows/deploy.yml` (lint/test ~58-59).
- **Modify** `.github/workflows/pr-audit.yml` (~30).
- **Modify** `.claude/skills/backlog-next/SKILL.md` (6.2 ~100, 6.4 ~117).
- **Modify** `.claude/skills/backlog-next/detect-deploy-needed.mjs` — resolver-computed `services=` + `tools/` TIER0 rule (folds `detect-deploy-tools-path-no-deploy`).
- **Modify** `.claude/skills/backlog-next/deploy-paths.md` — document lib→service-closure resolution.

> **Scope note:** Only **3** of the 5 workflows actually call `nx affected` (pr-deploy, deploy, pr-audit). `nestfolio-e2e.yml` and `pr-cleanup.yml` use `nx run` directly — no change. `verify-structure.sh` Check 7 also uses `nx affected` but is tracked separately under `precommit-hook-fatal-on-nx-daemon-failure` — **out of scope**.

---

### Task 1: Core pure functions + synthetic-graph unit tests

**Files:**
- Create: `tools/affected-projects.mjs`
- Test: `tools/affected-projects.test.mjs`

- [ ] **Step 1: Write the failing unit tests**

Create `tools/affected-projects.test.mjs`:

```js
// node:test sibling for affected-projects.mjs.
// Unit tests use synthetic graphs (exact known answers). The golden test
// (Task 2) asserts topology-stable anchors against a committed real-graph fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reverseDependents, mapFilesToProjects, affectedProjects, GLOBAL_FILES,
} from './affected-projects.mjs';

// Build a synthetic graph. nodes: [name, root, type?, targets?]. edges: [source, target].
function makeGraph(nodes, edges) {
  const graph = { nodes: {}, dependencies: {} };
  for (const [name, root, type = 'lib', targets = { test: {} }] of nodes) {
    graph.nodes[name] = {
      name, type,
      data: { root, projectType: type === 'app' ? 'application' : 'library', targets },
    };
    graph.dependencies[name] = [];
  }
  for (const [s, t] of edges) graph.dependencies[s].push({ source: s, target: t, type: 'static' });
  return graph;
}

// A depends on B and C; B depends on C. D is an isolated sink.
// A,B,D are apps with test-integration; C is a lib without it.
const G = makeGraph(
  [
    ['a', 'services/x/a', 'app', { test: {}, 'test-integration': {} }],
    ['b', 'services/x/b', 'app', { test: {}, 'test-integration': {} }],
    ['c', 'libs/c', 'lib', { test: {} }],
    ['d', 'services/x/d', 'app', { test: {}, 'test-integration': {} }],
  ],
  [['a', 'b'], ['a', 'c'], ['b', 'c']],
);

test('reverseDependents inverts the edges', () => {
  const dep = reverseDependents(G);
  assert.deepEqual([...dep.get('c')].sort(), ['a', 'b']);
  assert.deepEqual([...dep.get('b')].sort(), ['a']);
  assert.equal(dep.get('a'), undefined); // nothing depends on a
});

test('affected(touch lib c) = c + all transitive dependents', () => {
  const out = affectedProjects(G, { files: ['libs/c/src/index.ts'] });
  assert.deepEqual(out, ['a', 'b', 'c']);
});

test('affected(touch sink d) = only d', () => {
  const out = affectedProjects(G, { files: ['services/x/d/src/main.ts'] });
  assert.deepEqual(out, ['d']);
});

test('affected(touch leaf a) = only a (nothing depends on it)', () => {
  const out = affectedProjects(G, { files: ['services/x/a/src/main.ts'] });
  assert.deepEqual(out, ['a']);
});

test('--with-target filters to projects having that target', () => {
  // c is affected but lacks test-integration → dropped
  const out = affectedProjects(G, { files: ['libs/c/src/index.ts'], withTarget: 'test-integration' });
  assert.deepEqual(out, ['a', 'b']);
});

test('--type filters to app/lib', () => {
  const out = affectedProjects(G, { files: ['libs/c/src/index.ts'], type: 'app' });
  assert.deepEqual(out, ['a', 'b']); // c is a lib
});

test('a global file affects every project', () => {
  for (const gf of GLOBAL_FILES) {
    const out = affectedProjects(G, { files: [gf] });
    assert.deepEqual(out, ['a', 'b', 'c', 'd'], `global file ${gf}`);
  }
});

test('unmapped files (docs, .github) affect nothing', () => {
  const out = affectedProjects(G, { files: ['docs/x.md', '.github/workflows/y.yml'] });
  assert.deepEqual(out, []);
});

test('longest-prefix wins for nested roots', () => {
  const nested = makeGraph(
    [['outer', 'services/x', 'app'], ['inner', 'services/x/inner', 'app']],
    [],
  );
  assert.deepEqual([...mapFilesToProjects(nested, ['services/x/inner/src/f.ts'])], ['inner']);
  assert.deepEqual([...mapFilesToProjects(nested, ['services/x/other/f.ts'])], ['outer']);
});

test('exact-root match (no trailing slash needed) maps to the project', () => {
  const out = mapFilesToProjects(G, ['services/x/d']);
  assert.deepEqual([...out], ['d']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/affected-projects.test.mjs`
Expected: FAIL — `Cannot find module './affected-projects.mjs'` (file not created yet).

- [ ] **Step 3: Write the resolver pure functions**

Create `tools/affected-projects.mjs` with the header + pure functions (CLI added in Task 2):

```js
#!/usr/bin/env node
/**
 * tools/affected-projects.mjs — compute the TRUE affected project set.
 *
 * nx 22.5.4 `affected` over-approximates: it returns event-processor's entire
 * dependent closure (~33 projects) for ANY project that transitively imports
 * event-processor — a read-model sink like dashboard-bff reports 33 when the
 * truth is 1. The `nx graph` JSON itself is correct; only `affected`'s
 * consumption of it is wrong (nx discussion #5580 / issue #1169; not fixed in
 * 22.7.5; projectsAffectedByDependencyUpdates has no effect). This tool computes
 *   affected = touched ∪ reverse-reachability(touched)
 * over the graph's dependency edges — exactly what `affected` should return.
 *
 * Usage:
 *   node tools/affected-projects.mjs [--base=<ref>] [--head=<ref>]
 *        [--files=a,b] [--with-target=<t>] [--type=app|lib] [--graph=<path>]
 *
 *   # drop-in for `nx affected -t test-integration`:
 *   AFFECTED=$(node tools/affected-projects.mjs --base=origin/main --with-target=test-integration | paste -sd, -)
 *   [ -n "$AFFECTED" ] && pnpm nx run-many -t test-integration -p "$AFFECTED"
 *
 * Output: affected project names, newline-separated, sorted. Empty output ⇒
 * nothing affected (callers MUST guard run-many against an empty -p list).
 * Exit 0 on success (even when empty); 1 on error.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Workspace-global files: a change here legitimately affects EVERY project.
export const GLOBAL_FILES = [
  'tsconfig.base.json',
  'nx.json',
  'package.json',
  'pnpm-lock.yaml',
  'tools/affected-projects.mjs', // the resolver itself — conservative
];

/** graph -> Map(target -> Set(sources that depend on it)). */
export function reverseDependents(graph) {
  const dependents = new Map();
  for (const src of Object.keys(graph.dependencies || {})) {
    for (const edge of graph.dependencies[src]) {
      if (!dependents.has(edge.target)) dependents.set(edge.target, new Set());
      dependents.get(edge.target).add(edge.source);
    }
  }
  return dependents;
}

/** changed files -> Set(owning project names), via longest-prefix root match. */
export function mapFilesToProjects(graph, files, globals = GLOBAL_FILES) {
  const all = Object.keys(graph.nodes);
  const byRoot = all
    .map((name) => ({ name, root: graph.nodes[name].data.root }))
    .filter((e) => e.root && e.root !== '.')
    .sort((a, b) => b.root.length - a.root.length); // longest root first
  const touched = new Set();
  for (const file of files) {
    if (globals.includes(file)) return new Set(all); // global → everything
    const hit = byRoot.find((e) => file === e.root || file.startsWith(e.root + '/'));
    if (hit) touched.add(hit.name);
    // unmapped (docs/, .github/, random root files) → no project
  }
  return touched;
}

/** affected = touched ∪ reverse-reachability(touched), with optional filters. */
export function affectedProjects(graph, { files, withTarget, type, globals } = {}) {
  const touched = mapFilesToProjects(graph, files || [], globals);
  const dependents = reverseDependents(graph);
  const affected = new Set(touched);
  const stack = [...touched];
  while (stack.length) {
    const cur = stack.pop();
    for (const dep of dependents.get(cur) || []) {
      if (!affected.has(dep)) { affected.add(dep); stack.push(dep); }
    }
  }
  let out = [...affected];
  if (type) out = out.filter((n) => graph.nodes[n]?.type === type);
  if (withTarget) out = out.filter((n) => graph.nodes[n]?.data?.targets?.[withTarget] != null);
  return out.sort();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/affected-projects.test.mjs`
Expected: PASS (all 11 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/affected-projects.mjs tools/affected-projects.test.mjs
git commit --no-verify -m "feat(tools): affected-projects resolver core (reverse-reachability)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: CLI + graph loading + git diff + golden fixture test

**Files:**
- Modify: `tools/affected-projects.mjs` (append impure helpers + CLI)
- Modify: `tools/affected-projects.test.mjs` (add golden CLI tests)
- Create: `tools/fixtures/nx-graph.sample.json`

- [ ] **Step 1: Generate the committed fixture from the main checkout**

(The worktree has no `node_modules`; generate from the main repo, write straight into the worktree fixture.)

```bash
mkdir -p tools/fixtures
(cd /Users/fabiovitali/WebstormProjects/nestfolio && NX_DAEMON=false pnpm exec nx graph \
  --file=/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/nx-affected-true-affected-resolver/tools/fixtures/nx-graph.sample.json)
node -e "const g=require('./tools/fixtures/nx-graph.sample.json').graph; console.log('nodes:', Object.keys(g.nodes).length)"
```
Expected: `nodes: 51`.

- [ ] **Step 2: Write the failing golden CLI tests**

Append to `tools/affected-projects.test.mjs`:

```js
import { spawnSync } from 'node:child_process';

const SCRIPT = 'tools/affected-projects.mjs';
const FIXTURE = 'tools/fixtures/nx-graph.sample.json';

function runCli(extraArgs) {
  const r = spawnSync('node', [SCRIPT, `--graph=${FIXTURE}`, ...extraArgs], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean);
}

test('golden: dashboard-bff sink → only itself (nx affected reports the full 33-closure)', () => {
  const out = runCli(['--files=services/investor/dashboard-bff/src/main.ts']);
  assert.deepEqual(out, ['dashboard-bff']);
});

test('golden: ui lib → ui + the 5 frontends', () => {
  const out = runCli(['--files=libs/ui/src/index.ts']);
  assert.deepEqual(out, ['advisory-mfe', 'dashboard-mfe', 'investor-mfe', 'ledger-mfe', 'nestfolio-host', 'ui']);
});

test('golden: --type=app drops the ui lib, keeps the frontend apps', () => {
  const out = runCli(['--files=libs/ui/src/index.ts', '--type=app']);
  assert.deepEqual(out, ['advisory-mfe', 'dashboard-mfe', 'investor-mfe', 'ledger-mfe', 'nestfolio-host']);
});

test('golden: empty --files → empty output, exit 0', () => {
  const r = spawnSync('node', [SCRIPT, `--graph=${FIXTURE}`, '--files='], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});
```

- [ ] **Step 3: Run to verify the golden tests fail**

Run: `node --test tools/affected-projects.test.mjs`
Expected: the 4 new golden tests FAIL (CLI/`loadGraph`/`changedFiles` not implemented; `--graph`/`--files` unhandled). The Task-1 unit tests still PASS.

- [ ] **Step 4: Append the impure helpers + CLI to `tools/affected-projects.mjs`**

```js
/** Resolve changed files: explicit --files, else git (range + working tree + untracked). */
export function changedFiles({ base, head, files }) {
  if (files && files.length) return files;
  const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8' }).trim(); } catch { return ''; } };
  const set = new Set();
  const add = (out) => out.split('\n').filter(Boolean).forEach((f) => set.add(f));
  add(sh(`git diff --name-only ${base}...${head}`)); // committed range
  add(sh('git diff --name-only'));                    // unstaged
  add(sh('git diff --name-only --cached'));           // staged
  add(sh('git ls-files --others --exclude-standard')); // untracked
  return [...set];
}

/** Load the nx graph: from --graph path, else generate daemon-free into a temp file. */
export function loadGraph(graphPath) {
  let p = graphPath;
  if (!p) {
    p = join(tmpdir(), `nf-nxgraph-${process.pid}.json`);
    execSync(`pnpm exec nx graph --file=${p}`, {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, NX_DAEMON: 'false' },
    });
  }
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  return raw.graph || raw; // tolerate { graph: {…} } and bare {…}
}

export function parseArgs(argv) {
  const args = { base: 'origin/main', head: 'HEAD' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.match(/^--([^=]+)=(.*)$/);
    if (eq) { args[eq[1]] = eq[2]; continue; }
    if (a === '--with-target') { args['with-target'] = argv[++i]; continue; }
    args[a.replace(/^--/, '')] = true;
  }
  if (typeof args.files === 'string') args.files = args.files.split(',').filter(Boolean);
  args.withTarget = args['with-target'];
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const graph = loadGraph(args.graph);
  const files = changedFiles({ base: args.base, head: args.head, files: args.files });
  const out = affectedProjects(graph, { files, withTarget: args.withTarget, type: args.type });
  if (out.length) console.log(out.join('\n'));
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main();
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `node --test tools/affected-projects.test.mjs`
Expected: PASS (all 15 tests — 11 unit + 4 golden).

- [ ] **Step 6: Commit**

```bash
git add tools/affected-projects.mjs tools/affected-projects.test.mjs tools/fixtures/nx-graph.sample.json
git commit --no-verify -m "feat(tools): affected-projects CLI + git/graph loaders + golden fixture

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rewire `compute-affected-services.sh`

**Files:**
- Modify: `.github/scripts/compute-affected-services.sh:10`

- [ ] **Step 1: Replace the `nx show projects --affected` line**

Change line 10 from:
```bash
AFFECTED=$(pnpm nx show projects --affected --base="$BASE_SHA" --type=app 2>/dev/null || true)
```
to:
```bash
# True-affected resolver (replaces over-approximating `nx affected` — see
# docs/superpowers/plans/2026-06-13-nx-affected-true-affected-resolver.md)
AFFECTED=$(node tools/affected-projects.mjs --base="$BASE_SHA" --type=app 2>/dev/null || true)
```

The downstream deployable-intersection logic (lines 17-28) is unchanged — it reads `$AFFECTED` line-by-line, and the resolver emits newline-separated names exactly like `nx show projects`.

- [ ] **Step 2: Sanity-check the script parses (shellcheck-style dry parse)**

Run: `bash -n .github/scripts/compute-affected-services.sh && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/scripts/compute-affected-services.sh
git commit --no-verify -m "ci: source affected services from true-affected resolver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Rewire the 3 workflows + SKILL.md 6.2/6.4

**Files:**
- Modify: `.github/workflows/pr-deploy.yml` (lint/test job, test-integration job)
- Modify: `.github/workflows/deploy.yml` (lint/test step)
- Modify: `.github/workflows/pr-audit.yml` (affected step)
- Modify: `.claude/skills/backlog-next/SKILL.md` (steps 6.2, 6.4)

- [ ] **Step 1: pr-deploy.yml — lint/test (replace lines 67-68)**

Replace:
```yaml
      - run: pnpm nx affected -t lint --base=origin/main --parallel=3
      - run: pnpm nx affected -t test --base=origin/main --parallel=3
```
with:
```yaml
      - name: Lint and test affected
        run: |
          AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
          if [ -n "$AFFECTED" ]; then
            pnpm nx run-many -t lint -p "$AFFECTED" --parallel=3
            pnpm nx run-many -t test -p "$AFFECTED" --parallel=3
          else
            echo "No affected projects — skipping lint/test."
          fi
```

- [ ] **Step 2: pr-deploy.yml — test-integration (replace lines 124-130 body)**

Replace the `Run integration tests` step's `run:` block:
```yaml
        run: |
          IS_FULL="${{ needs.detect-affected.outputs.is_full_deploy }}"
          if [ "$IS_FULL" = "true" ]; then
            pnpm nx run-many -t test-integration --parallel=8
          else
            pnpm nx affected -t test-integration --base=origin/main --parallel=8
          fi
```
with:
```yaml
        run: |
          IS_FULL="${{ needs.detect-affected.outputs.is_full_deploy }}"
          if [ "$IS_FULL" = "true" ]; then
            pnpm nx run-many -t test-integration --parallel=8
          else
            AFFECTED=$(node tools/affected-projects.mjs --base=origin/main --with-target=test-integration | paste -sd, -)
            if [ -n "$AFFECTED" ]; then
              pnpm nx run-many -t test-integration -p "$AFFECTED" --parallel=8
            else
              echo "No affected projects with test-integration — skipping."
            fi
          fi
```

- [ ] **Step 3: deploy.yml — lint/test (replace lines 57-59 body)**

Replace:
```yaml
      - name: Lint and test affected
        if: steps.affected.outputs.skipped == 'false'
        run: |
          pnpm nx affected -t lint --base=${{ steps.setSHAs.outputs.base }} --parallel=3
          pnpm nx affected -t test --base=${{ steps.setSHAs.outputs.base }} --parallel=3
```
with:
```yaml
      - name: Lint and test affected
        if: steps.affected.outputs.skipped == 'false'
        run: |
          AFFECTED=$(node tools/affected-projects.mjs --base=${{ steps.setSHAs.outputs.base }} | paste -sd, -)
          if [ -n "$AFFECTED" ]; then
            pnpm nx run-many -t lint -p "$AFFECTED" --parallel=3
            pnpm nx run-many -t test -p "$AFFECTED" --parallel=3
          else
            echo "No affected projects — skipping lint/test."
          fi
```

- [ ] **Step 4: pr-audit.yml — affected step (replace line 30)**

Replace:
```yaml
          AFFECTED=$(pnpm nx affected --base=origin/main --head=HEAD --select=projects 2>/dev/null || echo "")
```
with:
```yaml
          AFFECTED=$(node tools/affected-projects.mjs --base=origin/main --head=HEAD 2>/dev/null | paste -sd, - || echo "")
```
(`--select=projects` emitted a comma list; `paste -sd, -` preserves that format for the `$AFFECTED` interpolation downstream.)

- [ ] **Step 5: SKILL.md 6.2 (replace the line-100 command)**

Replace:
```bash
pnpm nx affected -t test,lint --base=origin/main
```
with:
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
[ -n "$AFFECTED" ] && pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"
```

- [ ] **Step 6: SKILL.md 6.4 (replace the line-117 command)**

Replace:
```bash
pnpm nx affected -t test-integration --base=origin/main
```
with:
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main --with-target=test-integration | paste -sd, -)
[ -n "$AFFECTED" ] && pnpm nx run-many -t test-integration -p "$AFFECTED" || echo "no affected integration suites"
```

Also update the SKILL.md `description:` frontmatter phrase `nx-affected validation` → `true-affected-resolver validation` (line 3).

- [ ] **Step 7: Validate YAML + commit**

```bash
for f in .github/workflows/pr-deploy.yml .github/workflows/deploy.yml .github/workflows/pr-audit.yml; do
  node -e "require('node:fs').readFileSync('$f','utf8')" && echo "read $f OK"
done
git add .github/workflows/pr-deploy.yml .github/workflows/deploy.yml .github/workflows/pr-audit.yml .claude/skills/backlog-next/SKILL.md
git commit --no-verify -m "ci+skill: route nx-affected call sites through true-affected resolver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> If a YAML linter is available (`pnpm exec yaml-lint` or similar), prefer it; otherwise the Node read above just confirms the file is well-formed text.

---

### Task 5: Wire the resolver into `detect-deploy-needed.mjs` (folds `detect-deploy-tools-path-no-deploy`)

**Files:**
- Modify: `.claude/skills/backlog-next/detect-deploy-needed.mjs`
- Modify: `.claude/skills/backlog-next/deploy-paths.md`

**Why:** The shared-lib TIER1 rules (`libs/event-processor`, `cdk-constructs`, `agent-orchestrator`, `event-types`) are `service:false`, so a lib change emits `deploy=true` with an **empty `services=`** — "which services bundle this lib" is a reverse-reachability query, exactly what the resolver answers. Adding a `tools/**` TIER0 rule (closing `detect-deploy-tools-path-no-deploy`) is **required** here: without it, this workstream's own `tools/affected-projects.mjs` change (a GLOBAL_FILE) would resolve to *all* services and trigger a spurious full deploy.

- [ ] **Step 1: Add the `tools/` TIER0 rule**

In `TIER0` (after `/^\.claude\//`), add:
```js
  /^tools\//,           // tools/*.mjs = repo tooling, never a deploy artifact
```

- [ ] **Step 2: Import the resolver at the top of the file**

After the existing imports (`execSync`, `fileURLToPath`), add:
```js
import { affectedProjects, loadGraph } from '../../../tools/affected-projects.mjs';
```

- [ ] **Step 3: Compute `services` via the resolver in `main()`**

In `main()`, immediately after:
```js
  const { deploy: deployNeeded, services, triggers, skipped, unknownPaths } = classifyChanges(changedFiles);
```
change `services` to `let` and recompute when deploying. Replace that destructuring line with:
```js
  const { deploy: deployNeeded, services: pathServices, triggers, skipped, unknownPaths } = classifyChanges(changedFiles);

  // True-affected resolver: map the diff to its dependent DEPLOYABLE service
  // closure (covers shared-lib changes, which path-extraction leaves empty).
  // Exclude no-deploy (Tier 0) files so a tools/ or docs/ edit never widens the set.
  let services = pathServices;
  if (deployNeeded) {
    try {
      const graph = loadGraph();
      const deployRelevant = changedFiles.filter((f) => !TIER0.some((re) => re.test(f)));
      services = affectedProjects(graph, { files: deployRelevant, type: 'app' })
        .filter((n) => graph.nodes[n].data.root.startsWith('services/'));
    } catch (err) {
      console.error(`[detect-deploy] resolver unavailable (${err.message}); using path-extracted services`);
    }
  }
```

(All later `services` reads — the JSON branch and `services.join(',')` — now use the resolver result.)

- [ ] **Step 4: Smoke-test detect-deploy against a synthetic diff**

The resolver path needs `node_modules` (it runs `nx graph`); the worktree has none, so verify the **fallback + Tier-0** logic here and defer the live resolver path to Task 6's main-checkout smoke.

Run:
```bash
node -e '
import("./.claude/skills/backlog-next/detect-deploy-needed.mjs").then(m => {
  // tools-only change → Tier 0 → no deploy
  const a = m.classifyChanges(["tools/affected-projects.mjs"]);
  console.log("tools-only deploy:", a.deploy, "(expect false)");
  // a service src change still deploys
  const b = m.classifyChanges(["services/ledger/ledger-ctrl/src/handlers/x.ts"]);
  console.log("service deploy:", b.deploy, "(expect true)");
});
'
```
Expected: `tools-only deploy: false (expect false)` and `service deploy: true (expect true)`.

- [ ] **Step 5: Document in `deploy-paths.md`**

Read `.claude/skills/backlog-next/deploy-paths.md`, then add (after the shared-lib section) a note:
```markdown
## Service resolution (true-affected resolver)

`services=` is computed by `tools/affected-projects.mjs` (reverse-reachability
over `nx graph`), not by path-extraction. A shared-lib change
(`libs/event-processor`, `cdk-constructs`, `agent-orchestrator`, `event-types`)
therefore resolves to its true dependent **service** closure (apps under
`services/`) instead of an empty list. `tools/**` is Tier 0 (never a deploy
artifact). If `nx graph` is unavailable, detect-deploy falls back to
path-extracted service names.
```

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/backlog-next/detect-deploy-needed.mjs .claude/skills/backlog-next/deploy-paths.md
git commit --no-verify -m "skill(detect-deploy): resolver-computed services= + tools/ Tier 0

Folds detect-deploy-tools-path-no-deploy: tools/ is never a deploy artifact,
and shared-lib changes now resolve to their dependent service closure.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Full verification (unit + golden + live smoke)

**Files:** none (verification only)

- [ ] **Step 1: Run the resolver test suite (worktree — no node_modules needed)**

Run: `node --test tools/affected-projects.test.mjs`
Expected: `tests 15 … pass 15 … fail 0`.

- [ ] **Step 2: Live end-to-end smoke from the main checkout (resolver auto-generates the graph)**

The worktree can't run `nx graph`; run the live CLI from the main repo against the committed resolver to confirm auto-generation + the over-report fix on the real graph:

```bash
WT=/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/nx-affected-true-affected-resolver
(cd /Users/fabiovitali/WebstormProjects/nestfolio && \
  echo "resolver dashboard-bff (expect 1):" && \
  node "$WT/tools/affected-projects.mjs" --graph=<(NX_DAEMON=false pnpm exec nx graph --file=/dev/stdout 2>/dev/null) \
    --files=services/investor/dashboard-bff/src/main.ts | wc -l)
```
Expected: `1`. (If process-substitution of the graph is awkward in the shell, instead: generate `/tmp/g.json` via `nx graph --file`, then `node "$WT/tools/affected-projects.mjs" --graph=/tmp/g.json --files=…` — the point is to confirm dashboard-bff → 1 on the live graph while `nx affected` → 33.)

- [ ] **Step 3: Confirm the over-report contrast is still real (documents the validation_gate)**

```bash
(cd /Users/fabiovitali/WebstormProjects/nestfolio && \
  NX_DAEMON=false pnpm nx show projects --affected --files=services/investor/dashboard-bff/src/main.ts 2>/dev/null | grep -c .)
```
Expected: `33` (nx over-reports) — vs the resolver's `1`. Capture both numbers for the `validation_gate`.

- [ ] **Step 4: No commit (verification only).** Record the evidence (test count, `1` vs `33`) for the backlog `validation_gate:`.

---

## Out of scope (mirrors backlog `out_of_scope:`)

- **Type-only-diff → false `deploy=true`** (build-output/bundle-hash axis) — tracked under `cdk-bundle-staleness-deploy-integrity`. This resolver answers *graph membership*, not *did the runtime artifact change*.
- **Upgrading nx** to fix the over-report — proven not version-fixable.
- **Changing cross-service contract / event design / breaking cycles** — the 2026-06-07 investigation disproved all of these as the cause; the graph is correct.
- **`verify-structure.sh` Check 7** (pre-commit blast-radius warning) — tracked under `precommit-hook-fatal-on-nx-daemon-failure`.
- **`detect-deploy-service-test-path-no-deploy`** (the `services/*/test/**` false-positive) — unrelated axis, stays parked.

## Self-review

- **Spec coverage:** resolver (Task 1-2) ✔; `compute-affected-services.sh` (Task 3) ✔; the 3 affected-using workflows + SKILL 6.2/6.4 (Task 4) ✔; detect-deploy shared-lib `services=` resolution (Task 5) ✔; verification (Task 6) ✔. The backlog said "5 workflows" — corrected to the 3 that actually call `nx affected`.
- **Type consistency:** `affectedProjects(graph, {files, withTarget, type, globals})`, `reverseDependents(graph)→Map`, `mapFilesToProjects(graph, files, globals)→Set`, `loadGraph(path?)→graph`, `changedFiles({base,head,files})→string[]`, `parseArgs(argv)→{base,head,files?,withTarget?,type?,graph?}` — names consistent across tasks and call sites. CLI flag is `--with-target=<t>` (also accepts space form); `parseArgs` normalizes `with-target`→`withTarget`.
- **Placeholder scan:** none — every step shows real code/commands and expected output.
- **Folded item:** `detect-deploy-tools-path-no-deploy` (Task 5) — required to keep this workstream's own deploy decision correct; mark `dropped [SUPERSEDED -> nx-affected-true-affected-resolver]` at ship.
