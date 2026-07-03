# runtime-make-it-fire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution is INLINE + visible (runtime-realization method + `feedback_no_worker_isolating_subagents`) — do NOT fan out to isolated subagents.

**Goal:** Make the runtime enforce its content-ring commit-trigger checks on every commit — the thinnest live path — by adding a pre-commit gate that runs `run-watch` over the staged set and blocks on findings.

**Architecture:** A new ring-2 git→runtime binding (`runtime/adapters/git/pre-commit-gate.mjs`) whose pure core calls the existing ring-1 `runWatch`; a thin CLI wrapper computes the staged set, loads the registry + `commit` trigger, prints findings, and exits (fail-closed). `scripts/verify-structure.sh` (already installed as `.git/hooks/pre-commit`) invokes it. No capability injection — deterministic checks run their evaluators directly.

**Tech Stack:** Node ≥24 (native `.ts` type-stripping, zero build), `node:test`, `node:child_process` (`git diff --cached`), the ring-1 `run-watch`/`load-registry` helpers. Tier-0 — never deploys.

## Global Constraints

- **Node ≥24, zero-build `.mjs`.** No TypeScript compile step; `.mjs` only in `runtime/adapters/`.
- **House module convention** (match `run-watch.mjs`): comment header, named exports for the pure core, thin `main()` guarded by `if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();`. No default exports.
- **Ring boundary:** the gate lives in ring-2 (`runtime/adapters/git/`) and imports ring-1 (`../../engine/lib/*.mjs`); ring-1 never imports it (the existing `import-boundary.test.mjs` guards this — do not break it).
- **Tier-0 no deploy.** Validation = `node --test` + a manual smoke. No nx build/deploy target.
- **Branch discipline:** all commits land on the `runtime-make-it-fire` branch (NOT `main`). If the installed pre-commit hook blocks a legitimate commit, use `git commit --no-verify` and verify the commit actually landed (`git log --oneline -1`). Finish with `superpowers:finishing-a-development-branch` → single PR.
- **Exit-code contract:** `0` = clean (allow), `1` = findings (block), `2` = crash (block, fail-closed).

## File Structure

- `runtime/adapters/git/pre-commit-gate.mjs` *(new)* — the gate: pure core `runPreCommitGate` + `shouldSkip` + `readStaged` helpers + a `main()` CLI. One responsibility: run the commit-trigger checks over the staged set and map to an exit code.
- `runtime/adapters/git/test/pre-commit-gate.test.mjs` *(new)* — `node --test` over the pure core + helpers (hermetic; injects a fake `watch`).
- `scripts/verify-structure.sh` *(modify)* — invoke the gate before the services-only early-exit.

---

### Task 1: The gate (`pre-commit-gate.mjs`)

**Files:**
- Create: `runtime/adapters/git/pre-commit-gate.mjs`
- Test: `runtime/adapters/git/test/pre-commit-gate.test.mjs`

**Interfaces:**
- Consumes: `runWatch({registry, trigger, changedScope, judge?}) → findings[]` and `loadTriggers(file) → trigger[]` from `runtime/engine/lib/run-watch.mjs`; `loadRegistry({checksDir}) → {checks, byId, errors}` from `runtime/engine/lib/load-registry.mjs`. A `trigger` is `{on, contexts, cost_ceiling}`; a `finding` is `{id, check, kind, scope, detail, evidence?, raised_at}`.
- Produces: `runPreCommitGate({stagedFiles, registry, trigger, watch=runWatch}) → Promise<{exitCode, findings}>`; `shouldSkip(env) → boolean`; `readStaged(exec?) → string[]`.

- [ ] **Step 1: Create the test directory + write the failing test**

```bash
mkdir -p runtime/adapters/git/test
```

Create `runtime/adapters/git/test/pre-commit-gate.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPreCommitGate, shouldSkip, readStaged } from '../pre-commit-gate.mjs';

const trigger = { on: 'commit', contexts: ['invariant', 'gate'], cost_ceiling: 'cheap' };
const registry = { checks: [], byId: new Map(), errors: [] };
// hermetic fake watch: raises a finding iff a "bad" path is in the staged (changed) scope
const fakeWatch = async ({ changedScope }) => changedScope.some((p) => p.includes('bad'))
  ? [{ id: 'no-unsafe-casts#0', check: 'no-unsafe-casts', kind: 'drift', scope: ['bad.ts'], detail: 'as any', raised_at: 't' }]
  : [];

test('a staged violation → exit 1 with the finding surfaced', async () => {
  const r = await runPreCommitGate({ stagedFiles: ['services/x/bad.ts'], registry, trigger, watch: fakeWatch });
  assert.equal(r.exitCode, 1);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].check, 'no-unsafe-casts');
});

test('a clean staged file → exit 0', async () => {
  const r = await runPreCommitGate({ stagedFiles: ['services/x/good.ts'], registry, trigger, watch: fakeWatch });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.findings, []);
});

test('no staged files → exit 0 (nothing runs)', async () => {
  const r = await runPreCommitGate({ stagedFiles: [], registry, trigger, watch: fakeWatch });
  assert.equal(r.exitCode, 0);
});

test('RUNTIME_GATE_SKIP short-circuits the gate', () => {
  assert.equal(shouldSkip({ RUNTIME_GATE_SKIP: '1' }), true);
  assert.equal(shouldSkip({}), false);
});

test('readStaged parses the name list, dropping blank lines', () => {
  const out = readStaged(() => 'a.ts\nservices/x/b.ts\n\n');
  assert.deepEqual(out, ['a.ts', 'services/x/b.ts']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test runtime/adapters/git/test/pre-commit-gate.test.mjs`
Expected: FAIL — `Cannot find module '../pre-commit-gate.mjs'`.

- [ ] **Step 3: Write the gate**

Create `runtime/adapters/git/pre-commit-gate.mjs`:

```js
// runtime/adapters/git/pre-commit-gate.mjs — ring-2 git→runtime binding (runtime-make-it-fire).
// Runs the content-ring commit-trigger checks over the STAGED set via ring-1 runWatch and blocks the
// commit on findings. Fail-closed: any crash → exit 2. Escape hatch: RUNTIME_GATE_SKIP.
// Invoked by scripts/verify-structure.sh (== .git/hooks/pre-commit). Ring-2: git awareness stays out of ring-1.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadRegistry } from '../../engine/lib/load-registry.mjs';
import { runWatch, loadTriggers } from '../../engine/lib/run-watch.mjs';

// Pure core: given the staged set + a loaded registry + the commit trigger, run the watch and map to an
// exit code. `watch` is injectable so the unit test stays hermetic (no real check execution).
export async function runPreCommitGate({ stagedFiles, registry, trigger, watch = runWatch }) {
  const findings = await watch({ registry, trigger, changedScope: stagedFiles });
  return { exitCode: findings.length ? 1 : 0, findings };
}

export function shouldSkip(env) { return Boolean(env.RUNTIME_GATE_SKIP); }

export function readStaged(exec = (c) => execSync(c, { encoding: 'utf8' })) {
  return exec('git diff --cached --name-only --diff-filter=ACM').split('\n').filter(Boolean);
}

async function main() {
  try {
    if (shouldSkip(process.env)) { console.error('runtime gate: skipped (RUNTIME_GATE_SKIP)'); process.exit(0); }
    const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
    const registry = loadRegistry({ checksDir: cfg.checksDir });
    const trigger = loadTriggers(cfg.triggersFile).find((t) => t.on === 'commit');
    if (!trigger) { console.error('runtime gate: no "commit" trigger in triggers.yaml'); process.exit(2); }
    const { exitCode, findings } = await runPreCommitGate({ stagedFiles: readStaged(), registry, trigger });
    for (const f of findings) console.error(`  ✖ ${f.check}  ${(f.scope ?? []).join(',')}  ${f.detail}`);
    if (findings.length) console.error(`runtime gate: ${findings.length} finding(s) — commit blocked (set RUNTIME_GATE_SKIP=1 to bypass)`);
    process.exit(exitCode);
  } catch (e) {
    console.error(`runtime gate: crashed, blocking commit (fail-closed): ${e.message}`);
    process.exit(2);
  }
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test runtime/adapters/git/test/pre-commit-gate.test.mjs`
Expected: PASS (5/5).

- [ ] **Step 5: Verify the ring-1 import-boundary guard still passes (the gate is ring-2, so ring-1 stays clean)**

Run: `node --test runtime/engine/test/import-boundary.test.mjs`
Expected: PASS (1/1) — the gate lives in `adapters/`, not `engine/`, so it does not appear in the ring-1 scan.

- [ ] **Step 6: Commit**

```bash
git add runtime/adapters/git/pre-commit-gate.mjs runtime/adapters/git/test/pre-commit-gate.test.mjs
git commit -m "feat(runtime): pre-commit enforcement gate — run-watch over the staged set, fail-closed (make-it-fire T1)"
git --no-pager log --oneline -1
```

---

### Task 2: Wire the gate into the pre-commit hook + smoke it

**Files:**
- Modify: `scripts/verify-structure.sh` (insert the gate step before the services-only early-exit at lines 17–19)

**Interfaces:**
- Consumes: the `pre-commit-gate.mjs` CLI from Task 1 (`node runtime/adapters/git/pre-commit-gate.mjs`, exit 0/1/2).

- [ ] **Step 1: Add the gate step — BEFORE the services-only early-exit**

In `scripts/verify-structure.sh`, insert the following block immediately after the `WARNINGS=0` line (line 13), i.e. **before** `CHANGED_SERVICES=$(...)` and its `if [ -z "$CHANGED_SERVICES" ]; then exit 0; fi`. Placement matters: the legacy checks early-exit `0` when no `services/` files are staged, so a gate placed later would silently never run on non-service commits.

```sh

# Runtime enforcement gate (runtime-make-it-fire) — content-ring commit-trigger checks over the staged
# set, via the ring-1 watch engine. Runs on EVERY commit, so it MUST precede the services-only early-exit
# below. Fail-closed: a non-zero exit (findings=1 or crash=2) blocks the commit.
if ! node runtime/adapters/git/pre-commit-gate.mjs; then
  exit 1
fi
```

- [ ] **Step 2: Reinstall the hook from the edited script**

`package.json`'s `prepare` copies `scripts/verify-structure.sh` → `.git/hooks/pre-commit`. Refresh it:

Run: `pnpm run prepare`
Then confirm the installed hook contains the gate:
Run: `grep -c pre-commit-gate .git/hooks/pre-commit`
Expected: `1`.

- [ ] **Step 3: Smoke — a real violation is BLOCKED by the runtime path**

Create a staged file that trips `no-unsafe-casts` (scope `libs/**/*.ts`), run the gate directly, and confirm exit 1 + the finding, then clean up:

```bash
mkdir -p libs/_smoke && printf 'export const x = (0 as any);\n' > libs/_smoke/bad.ts
git add libs/_smoke/bad.ts
node runtime/adapters/git/pre-commit-gate.mjs; echo "exit=$?"   # expect a "✖ no-unsafe-casts …" line + exit=1
git restore --staged libs/_smoke/bad.ts && rm -rf libs/_smoke
```
Expected: a `✖ no-unsafe-casts …` line printed to stderr and `exit=1`. (If `exit=0`, the check did not activate — stop and diagnose scope/trigger before proceeding.)

- [ ] **Step 4: Smoke — a clean staged set PASSES**

```bash
printf 'export const y = 1;\n' > libs/_smoke_ok.ts 2>/dev/null || true
git add libs/_smoke_ok.ts 2>/dev/null || true
node runtime/adapters/git/pre-commit-gate.mjs; echo "exit=$?"   # expect no ✖ lines + exit=0
git restore --staged libs/_smoke_ok.ts 2>/dev/null || true; rm -f libs/_smoke_ok.ts
```
Expected: no `✖` lines and `exit=0`.

- [ ] **Step 5: Full runtime suite stays green**

Run: `pnpm nx test runtime`
Expected: PASS — every `node:test` suite including the new `runtime/adapters/git/test/pre-commit-gate.test.mjs`.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-structure.sh
git commit -m "feat(runtime): fire the pre-commit gate from verify-structure.sh, before the services early-exit (make-it-fire T2)"
git --no-pager log --oneline -1
```

> Note: this commit runs under the now-reinstalled hook. Its staged file (`scripts/verify-structure.sh`) is outside every content-ring check's scope (`services/**`, `libs/**`, `docs/backlog/**`, …), so the gate passes with 0 findings. If it ever blocks spuriously, `RUNTIME_GATE_SKIP=1 git commit …` (and note why).

---

## Self-Review

**1. Spec coverage** — every design section maps to a task:

| Design § | Requirement | Task |
|---|---|---|
| Component 1 | `pre-commit-gate.mjs` (pure core + CLI, fail-closed, skip hatch) | T1 |
| Component 2 | edit `verify-structure.sh` | T2 |
| Component 3 | `pre-commit-gate.test.mjs` | T1 |
| Data flow | commit → hook → gate → runWatch → exit | T2 (wiring) + T1 (gate) |
| Error handling (fail-closed) | exit 0/1/2 + `RUNTIME_GATE_SKIP` | T1 (try/catch, `shouldSkip`) |
| Testing | node --test + manual smoke | T1 (unit) + T2 (smoke) |
| Rollout | `prepare` reinstall | T2 Step 2 |
| Non-goal: no capability injection | gate never touches `execute`/`ask` | honored (only `runWatch`) |

No uncovered requirement.

**2. Placeholder scan** — no `TBD`/`TODO`/"handle errors"/"add validation". Every code step carries complete code; every command has an expected result. None found.

**3. Type consistency** — `runPreCommitGate({stagedFiles, registry, trigger, watch})→{exitCode, findings}`, `shouldSkip(env)`, `readStaged(exec)` are defined identically in the test (T1 Step 1) and the implementation (T1 Step 3). `runWatch`/`loadTriggers`/`loadRegistry` signatures match `run-watch.mjs`/`load-registry.mjs` verbatim. The `commit` trigger shape `{on, contexts, cost_ceiling}` matches `triggers.yaml`. No drift.

---

## Execution Handoff

Plan complete. Execution is **inline** (runtime method + `feedback_no_worker_isolating_subagents`): use `superpowers:executing-plans`, batching by task with a green-test checkpoint after each. Two tasks, then `superpowers:finishing-a-development-branch` → single PR against `main`.
