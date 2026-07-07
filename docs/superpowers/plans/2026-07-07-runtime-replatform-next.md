# WS-3 — Re-Platform `backlog-next` onto `runWorker` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-platform the `backlog-next` work-driver onto the runtime `runWorker` behind `RUNTIME_ENGINE`, with the deploy + integration + involved-e2e validation modeled as a sha-conditional expensive pre-ship batch the runtime owns.

**Architecture:** A shared ring-1 `preShipBatch` helper (extracted from `runOrchestrator`) runs an expensive sha-pinned `runWatch` batch; `runWorker` calls it between execute and ship, gated by a deterministic `classifyLane`. The deploy-gate is a deterministic `cmd:` check whose runner spawns `deploy.sh`/nx/e2e (reusing `resolveDeployServices`). A `run-next.mjs` adapter drives the worker behind the flag; git-workflow preconditions stay host scripts. Parity is proved by 6 `rt-next-*` scenarios going `dominant`.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, zod check schema, git-native NDJSON journal, nx (`tools/affected-projects.mjs`), the parity oracle (`scripts/parity-oracle/`).

## Global Constraints

- **Ring discipline:** ring-1 (`runtime/engine/**`) imports NO skill and NO adapter. The `preShipBatch` extraction stays within ring-1 (imports only `../lib/*`). The deploy runner lives in the **adapter** ring and may import from `.claude/skills/**` and `tools/**`. (Import-boundary test: `runtime/engine/test/import-boundary.test.mjs`.)
- **Re-freeze:** the `preShipBatch` extraction + the new `runWorker` step change ring-1 behavior — update the SPEC-1 frozen record note where SPEC 1 documents the spines (`docs/superpowers/specs/*runtime*spec-1*` or the loop headers) and keep all existing engine tests green.
- **Behavior-preserving orchestrator refactor:** `runOrchestrator`'s output and existing tests (`runtime/engine/test/*orchestrator*`, parity `bne-*`) must not change.
- **No flake_contract on the deploy-gate** — it is `evaluator.type: deterministic` (`cmd:`). A judgment check would require one (`check.schema.ts:84`).
- **Deploy-gate check `contexts: [audit]`, `cost_tier: expensive`** — never `[gate]` (else the per-wake ship `runGate` runs it every wake; `runGate` does not cost-filter).
- **Journal freshness key is the literal `'e2e'`** (`e2eIsFresh` hardcodes it, `journal.mjs:147`) — `preShipBatch` records under `'e2e'` for both spines.
- **Flag idiom:** `usesRuntimeEngine(process.env)` from `runtime/engine/lib/path-provenance.mjs` — one branch site, mirroring `.claude/skills/backlog-next/backlog-gate.mjs:12-25`. Legacy body stays byte-for-byte (deletion is P6).
- **Provenance:** every runtime-path drive calls `recordRuntimePath(journal, { runId, workstream, sha: gitHeadSha() })` (`run-item.mjs:22` pattern).
- **Tests live in `runtime/**/test/`** (`node:test`), never `src/__tests__/`. Run via the glob form: `node --test <dir>/*.test.mjs`.
- **Commit cadence:** one commit per task (TDD: test→impl→green→commit). Worktree commits use `git commit --no-verify` and MUST be verified landed (`git log --oneline -1`).

---

## Task 1: `classifyLane` + `laneToTrigger` (content module)

**Files:**
- Create: `runtime/content/lib/classify-lane.mjs`
- Test: `runtime/content/test/classify-lane.test.mjs`

**Interfaces:**
- Produces: `classifyLane(item, diffPaths: string[]) → 'doc-layer'|'simple'|'complex'`; `laneToTrigger(lane) → { contexts:['audit'], cost_ceiling:'expensive', on:'item-pre-ship' } | null`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/content/test/classify-lane.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLane, laneToTrigger } from '../lib/classify-lane.mjs';

test('CL1 docs-only diff → doc-layer', () => {
  assert.equal(classifyLane({ id: 'x', type: 'refactor' }, ['docs/backlog/x.md', 'MEMORY.md']), 'doc-layer');
});
test('CL2 design item landing only a doc → doc-layer', () => {
  assert.equal(classifyLane({ id: 'x', type: 'design' }, ['docs/superpowers/specs/x.md']), 'doc-layer');
});
test('CL3 single-service src change, no interface → simple', () => {
  assert.equal(classifyLane({ id: 'x', type: 'bug' }, ['services/investor/investor-ctrl/src/handler.ts']), 'simple');
});
test('CL4 requires_deploy → complex', () => {
  assert.equal(classifyLane({ id: 'x', requires_deploy: true }, ['services/investor/investor-ctrl/src/h.ts']), 'complex');
});
test('CL5 public-interface (event-types) → complex', () => {
  assert.equal(classifyLane({ id: 'x' }, ['libs/event-types/src/foo.ts']), 'complex');
});
test('CL6 >1 service touched → complex', () => {
  assert.equal(classifyLane({ id: 'x' }, ['services/a/a-ctrl/src/h.ts', 'services/b/b-ctrl/src/h.ts']), 'complex');
});
test('CL7 infrastructure change → complex', () => {
  assert.equal(classifyLane({ id: 'x' }, ['infrastructure/config/retention-days.txt']), 'complex');
});
test('CL8 laneToTrigger: doc-layer skips the batch', () => {
  assert.equal(laneToTrigger('doc-layer'), null);
});
test('CL9 laneToTrigger: complex → expensive audit item-pre-ship', () => {
  assert.deepEqual(laneToTrigger('complex'), { contexts: ['audit'], cost_ceiling: 'expensive', on: 'item-pre-ship' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/content/test/classify-lane.test.mjs`
Expected: FAIL — `Cannot find module '../lib/classify-lane.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/content/lib/classify-lane.mjs — deterministic lane classifier (doc-layer|simple|complex),
// the runtime analogue of backlog-next SKILL.md §3. Pure: (item, diffPaths) → lane. Graded by the
// next-lane-* parity twins; laneToTrigger feeds the worker's pre-ship batch (null = skip, doc-layer).
const DOC_ONLY = [/^docs\//, /^MEMORY\.md$/, /^[^/]+\.md$/, /^BACKLOG\.md$/];
const PUBLIC_INTERFACE = [/^libs\/event-types\//, /^libs\/cdk-constructs\//, /\/domain\//, /\.flow\.ya?ml$/];
const DEPLOYED_LIB = [/^libs\/(event-processor|cdk-constructs|agent-orchestrator|event-types)\//];
const CODE_OR_INFRA = [/^services\//, /^libs\//, /^apps\//, /^infrastructure\//];

const serviceOf = (p) => (p.match(/^services\/[^/]+\/([^/]+)\//) || [])[1] ?? null;

export function classifyLane(item, diffPaths) {
  const paths = diffPaths ?? [];
  if (paths.length > 0 && paths.every((p) => DOC_ONLY.some((re) => re.test(p)))) return 'doc-layer';
  const services = new Set(paths.map(serviceOf).filter(Boolean));
  const complex =
    item?.requires_deploy === true ||
    paths.some((p) => PUBLIC_INTERFACE.some((re) => re.test(p))) ||
    paths.some((p) => DEPLOYED_LIB.some((re) => re.test(p))) ||
    paths.some((p) => /^infrastructure\//.test(p)) ||
    services.size > 1;
  if (complex) return 'complex';
  if (paths.some((p) => CODE_OR_INFRA.some((re) => re.test(p)))) return 'simple';
  return 'doc-layer';   // nothing recognizable to deploy
}

export function laneToTrigger(lane) {
  if (lane === 'doc-layer') return null;
  return { contexts: ['audit'], cost_ceiling: 'expensive', on: 'item-pre-ship' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/content/test/classify-lane.test.mjs`
Expected: PASS (9/9).

- [ ] **Step 5: Commit**

```bash
git add runtime/content/lib/classify-lane.mjs runtime/content/test/classify-lane.test.mjs
git commit --no-verify -m "feat(runtime): classifyLane + laneToTrigger content module (WS-3)"
git log --oneline -1   # verify landed
```

---

## Task 2: `autoResolvePolicy` (content module)

**Files:**
- Create: `runtime/content/lib/auto-resolve-policy.mjs`
- Test: `runtime/content/test/auto-resolve-policy.test.mjs`

**Interfaces:**
- Produces: `autoResolvePolicy(fork) → 'pause'|'auto-resolve'|'hard-floor'`. `fork = { kind: 'design-approval'|'architectural'|string, blastRadius?: 'local'|'shared', irreversible?: bool, outwardFacing?: bool }`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/content/test/auto-resolve-policy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoResolvePolicy } from '../lib/auto-resolve-policy.mjs';

test('ARP1 design approval → always pause', () => {
  assert.equal(autoResolvePolicy({ kind: 'design-approval' }), 'pause');
});
test('ARP2 irreversible/outward → hard-floor', () => {
  assert.equal(autoResolvePolicy({ kind: 'architectural', irreversible: true }), 'hard-floor');
  assert.equal(autoResolvePolicy({ kind: 'architectural', outwardFacing: true }), 'hard-floor');
});
test('ARP3 shared blast radius → hard-floor', () => {
  assert.equal(autoResolvePolicy({ kind: 'architectural', blastRadius: 'shared' }), 'hard-floor');
});
test('ARP4 local architectural fork → auto-resolve', () => {
  assert.equal(autoResolvePolicy({ kind: 'architectural', blastRadius: 'local' }), 'auto-resolve');
});
test('ARP5 unknown fork → conservative pause', () => {
  assert.equal(autoResolvePolicy({ kind: 'mystery' }), 'pause');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/content/test/auto-resolve-policy.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/content/lib/auto-resolve-policy.mjs — deterministic --auto per-source policy (backlog-next
// §"Standalone --auto mode"). Pure: (fork) → decision. Graded by the next-auto-* parity twins.
export function autoResolvePolicy(fork) {
  if (fork?.kind === 'design-approval') return 'pause';                                   // never self-approve a design
  if (fork?.irreversible || fork?.outwardFacing || fork?.blastRadius === 'shared') return 'hard-floor';
  if (fork?.kind === 'architectural' && fork?.blastRadius === 'local') return 'auto-resolve';
  return 'pause';                                                                          // unknown territory → pause
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/content/test/auto-resolve-policy.test.mjs`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add runtime/content/lib/auto-resolve-policy.mjs runtime/content/test/auto-resolve-policy.test.mjs
git commit --no-verify -m "feat(runtime): autoResolvePolicy content module (WS-3)"
git log --oneline -1
```

---

## Task 3: `preShipBatch` ring-1 helper + orchestrator refactor

**Files:**
- Create: `runtime/engine/loop/pre-ship-batch.mjs`
- Modify: `runtime/engine/loop/orchestrator.mjs:5-7,27-37` (replace inline block + imports)
- Test: `runtime/engine/test/pre-ship-batch.test.mjs`

**Interfaces:**
- Consumes: `runWatch` (`../lib/run-watch.mjs`), `e2eIsFresh`, `gitHeadSha` (`../lib/journal.mjs`).
- Produces: `preShipBatch({ journal, runId, registry, changedScope, judge, headSha, contexts, cost_ceiling, on }) → findings[]`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/engine/test/pre-ship-batch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inMemoryJournal } from '../lib/journal.mjs';
import { preShipBatch } from '../loop/pre-ship-batch.mjs';

// a registry with one expensive audit cmd check scoped to '**/*'
const registry = (run) => ({
  checks: [{ id: 'deploy-gate', property: 'p', kind: 'gap', cost_tier: 'expensive', contexts: ['audit'],
    status: 'active', scope: { paths: ['**/*'] }, evaluator: { type: 'deterministic', run }, provenance: { minted_by: 'x' } }],
  byId: new Map(), errors: [],
});

test('PSB1 fresh (matching sha) short-circuits — no re-run', async () => {
  const j = inMemoryJournal(); const runId = 'item-x';
  j.begin(runId, { runId });
  j.record(runId, 'e2e', { sha: 'SHA1', green: true, findings: [] });
  const f = await preShipBatch({ journal: j, runId, registry: registry('cmd:false'), changedScope: ['**/*'],
    headSha: 'SHA1', contexts: ['audit'], cost_ceiling: 'expensive', on: 'item-pre-ship' });
  assert.deepEqual(f, []);   // returned the cached findings; the cmd:false check was NOT run
});

test('PSB2 stale sha re-runs and records; green cmd → no findings', async () => {
  const j = inMemoryJournal(); const runId = 'item-y';
  j.begin(runId, { runId });
  const f = await preShipBatch({ journal: j, runId, registry: registry('cmd:true'), changedScope: ['**/*'],
    headSha: 'SHA2', contexts: ['audit'], cost_ceiling: 'expensive', on: 'item-pre-ship' });
  assert.deepEqual(f, []);
  assert.equal(j.read(runId).steps.get('e2e').value.sha, 'SHA2');
  assert.equal(j.read(runId).steps.get('e2e').value.green, true);
});

test('PSB3 failing cmd → a finding, recorded green:false', async () => {
  const j = inMemoryJournal(); const runId = 'item-z';
  j.begin(runId, { runId });
  const f = await preShipBatch({ journal: j, runId, registry: registry('cmd:false'), changedScope: ['**/*'],
    headSha: 'SHA3', contexts: ['audit'], cost_ceiling: 'expensive', on: 'item-pre-ship' });
  assert.equal(f.length, 1);
  assert.equal(j.read(runId).steps.get('e2e').value.green, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/pre-ship-batch.test.mjs`
Expected: FAIL — `Cannot find module '../loop/pre-ship-batch.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// runtime/engine/loop/pre-ship-batch.mjs — the sha-conditional expensive pre-ship batch, shared by
// runOrchestrator (epic-pre-done) and runWorker (item-pre-ship). Extracted from orchestrator.mjs's inline
// block (F-14): journal.step is sha-AGNOSTIC, so freshness is a SEPARATE mechanism — record the result
// via journal.record('e2e',{sha,...}) and gate re-runs with e2eIsFresh(ledger, HEAD). A moved HEAD ⇒
// stale ⇒ re-run; a pure resume ⇒ short-circuit (never re-deploy). Ring-1: imports only ../lib/*.
import { runWatch } from '../lib/run-watch.mjs';
import { e2eIsFresh, gitHeadSha } from '../lib/journal.mjs';

export async function preShipBatch({ journal, runId, registry, changedScope, judge, headSha, contexts, cost_ceiling, on }) {
  const sha = headSha ?? gitHeadSha();
  const ledger = journal.read(runId);
  if (e2eIsFresh(ledger, sha)) return ledger.steps.get('e2e').value.findings;   // resume: no re-deploy
  const findings = await runWatch({ registry, trigger: { on, contexts, cost_ceiling }, changedScope, judge });
  journal.record(runId, 'e2e', { sha, green: findings.length === 0, findings });
  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/pre-ship-batch.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Refactor `runOrchestrator` to use the helper (behavior-preserving)**

In `runtime/engine/loop/orchestrator.mjs`, replace the imports (lines 5-7) so `runWatch`/`e2eIsFresh`/`gitHeadSha` give way to `preShipBatch` (keep `askStep`, `fulfilledChoices`, `deriveJudge`):

```js
import { preShipBatch } from './pre-ship-batch.mjs';
import { askStep, fulfilledChoices } from '../lib/journal.mjs';
import { deriveJudge } from '../lib/derive-judge.mjs';
```

Replace the inline batch (lines 27-37) with:

```js
  // epic-pre-done batch — SHA-CONDITIONAL, delegated to the shared helper (WS-3).
  const findings = await preShipBatch({ journal, runId, registry, changedScope: ['**/*'], judge, headSha,
    contexts: ['audit', 'gate'], cost_ceiling: 'expensive', on: 'epic-pre-done' });
  if (findings.length) return { taskId: epic.id, status: 'failed', summary: `epic-pre-done raised ${findings.length} findings`, findings };
```

- [ ] **Step 6: Run the full engine loop suite to confirm the orchestrator refactor is behavior-preserving**

Run: `node --test runtime/engine/test/*.test.mjs`
Expected: PASS — all existing orchestrator/worker/watch/gate tests green, plus the new `pre-ship-batch` tests.

- [ ] **Step 7: Commit**

```bash
git add runtime/engine/loop/pre-ship-batch.mjs runtime/engine/loop/orchestrator.mjs runtime/engine/test/pre-ship-batch.test.mjs
git commit --no-verify -m "refactor(runtime): extract preShipBatch; runOrchestrator delegates (WS-3)"
git log --oneline -1
```

---

## Task 4: `runWorker` pre-ship batch step (lane-gated)

**Files:**
- Modify: `runtime/engine/loop/worker.mjs:5-7,27-30` (add batch step between execute and ship-gate)
- Test: `runtime/engine/test/worker-pre-ship.test.mjs`

**Interfaces:**
- Consumes: `preShipBatch` (`./pre-ship-batch.mjs`), `classifyLane`, `laneToTrigger` (`../../content/lib/classify-lane.mjs`), `gitHeadSha`, `diffPaths` helper.
- Produces: worker returns `status:'failed'` with the batch findings when the deploy-gate is red; unchanged otherwise. Worker signature adds optional `headSha`, `diffPaths` (defaulted from git) for testability.

- [ ] **Step 1: Write the failing test**

```js
// runtime/engine/test/worker-pre-ship.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inMemoryJournal } from '../lib/journal.mjs';
import { runWorker } from '../loop/worker.mjs';

// capabilities whose execute completes immediately (no park), ask ships.
const caps = (journal) => ({
  journal,
  execute: async () => ({ taskId: 'i', status: 'done', summary: 'worked' }),
  ask: async () => ({ decisionId: 'ship-i', value: 'ship' }),
  runProcedure: async () => ({ status: 'done', findings: [] }),
});
const deployGateReg = (run) => ({
  checks: [{ id: 'deploy-gate', property: 'p', kind: 'gap', cost_tier: 'expensive', contexts: ['audit'],
    status: 'active', scope: { paths: ['**/*'] }, evaluator: { type: 'deterministic', run }, provenance: { minted_by: 'x' } }],
  byId: new Map(), errors: [],
});

test('WPS1 complex item → runs the deploy-gate batch; red gate blocks ship', async () => {
  const j = inMemoryJournal();
  const item = { id: 'i', scope: 'services/**', requires_deploy: true };
  const r = await runWorker({ item, capabilities: caps(j), registry: deployGateReg('cmd:false'),
    headSha: 'S1', diffPaths: ['services/a/a-ctrl/src/h.ts'] });
  assert.equal(r.status, 'failed');
  assert.match(r.summary, /pre-ship/);
  assert.equal(j.read('item-i').steps.get('e2e').value.green, false);
});

test('WPS2 doc-layer item → batch skipped (no e2e record); ships', async () => {
  const j = inMemoryJournal();
  const item = { id: 'i', scope: 'docs/**', type: 'refactor' };
  const r = await runWorker({ item, capabilities: caps(j), registry: deployGateReg('cmd:false'),
    headSha: 'S1', diffPaths: ['docs/backlog/i.md'] });
  assert.equal(r.status, 'done');                       // doc-layer never reaches the (red) batch
  assert.equal(j.read('item-i').steps.get('e2e'), undefined);
});

test('WPS3 complex item, green gate → ships', async () => {
  const j = inMemoryJournal();
  const item = { id: 'i', scope: 'services/**', requires_deploy: true };
  const r = await runWorker({ item, capabilities: caps(j), registry: deployGateReg('cmd:true'),
    headSha: 'S1', diffPaths: ['services/a/a-ctrl/src/h.ts'] });
  assert.equal(r.status, 'done');
  assert.equal(j.read('item-i').steps.get('e2e').value.green, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/worker-pre-ship.test.mjs`
Expected: FAIL — the batch step does not exist; WPS1 gets `status:'done'`.

- [ ] **Step 3: Write minimal implementation**

In `runtime/engine/loop/worker.mjs` add imports (after line 7):

```js
import { preShipBatch } from './pre-ship-batch.mjs';
import { classifyLane, laneToTrigger } from '../../content/lib/classify-lane.mjs';
import { gitHeadSha } from '../lib/journal.mjs';
```

Change the signature (line 11) to accept the testability params:

```js
export async function runWorker({ item, capabilities, registry, locus = {}, auto = false, headSha, diffPaths }) {
```

Insert the batch **between** the execute block (after line 26) and the ship gate (before line 28):

```js
  // pre-ship deploy-gate batch (WS-3) — SHA-CONDITIONAL, lane-gated. doc-layer skips it entirely.
  const lane = classifyLane(item, diffPaths ?? []);
  const trigger = laneToTrigger(lane);
  if (trigger) {
    const findings = await preShipBatch({ journal, runId, registry, changedScope: item.scope ? toGlobs(item.scope) : ['**/*'],
      judge, headSha: headSha ?? gitHeadSha(), contexts: trigger.contexts, cost_ceiling: trigger.cost_ceiling, on: trigger.on });
    if (findings.length) return { taskId: item.id, status: 'failed', summary: `pre-ship deploy-gate: ${findings.length} findings`, findings };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/engine/test/worker-pre-ship.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Run the full engine suite (no regressions)**

Run: `node --test runtime/engine/test/*.test.mjs`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add runtime/engine/loop/worker.mjs runtime/engine/test/worker-pre-ship.test.mjs
git commit --no-verify -m "feat(runtime): runWorker lane-gated pre-ship deploy-gate batch (WS-3)"
git log --oneline -1
```

---

## Task 5: `deploy-gate-runner` (adapter, sandbox-robust)

**Files:**
- Create: `runtime/adapters/claude-code/deploy-gate-runner.mjs`
- Test: `runtime/adapters/claude-code/test/deploy-gate-runner.test.mjs`

**Interfaces:**
- Consumes (lazy, optional): `classifyChanges`, `resolveDeployServices` (`.claude/skills/backlog-next/detect-deploy-needed.mjs`), `loadGraph` (`tools/affected-projects.mjs`).
- Produces: `runDeployGate({ base, sh }) → { ok: boolean, ran: string[], stage?, code? }`; CLI exit 0 (ok) / 1 (fail). `sh` is an injectable spawn for tests.

- [ ] **Step 1: Write the failing test**

```js
// runtime/adapters/claude-code/test/deploy-gate-runner.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDeployGate } from '../deploy-gate-runner.mjs';

// fake sh: records commands, returns status per a script map
const fakeSh = (statusFor) => { const ran = []; return { ran, run: (cmd) => { ran.push(cmd); return { status: statusFor(cmd) }; } }; };

test('DGR1 no diff → ok, nothing run', async () => {
  const sh = fakeSh(() => 0);
  const r = await runDeployGate({ base: 'origin/main', sh: sh.run, diffOf: () => [] });
  assert.equal(r.ok, true);
  assert.deepEqual(sh.ran, []);
});

test('DGR2 code diff, all green → deploy + integration run, ok', async () => {
  const sh = fakeSh(() => 0);
  const r = await runDeployGate({ base: 'origin/main', sh: sh.run,
    diffOf: () => ['services/a/a-ctrl/src/h.ts'] });
  assert.equal(r.ok, true);
  assert.ok(sh.ran.some((c) => c.includes('deploy.sh')));
});

test('DGR3 deploy fails → not ok, stage deploy', async () => {
  const sh = fakeSh((c) => (c.includes('deploy.sh') ? 2 : 0));
  const r = await runDeployGate({ base: 'origin/main', sh: sh.run,
    diffOf: () => ['services/a/a-ctrl/src/h.ts'] });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'deploy');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/adapters/claude-code/test/deploy-gate-runner.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
#!/usr/bin/env node
// runtime/adapters/claude-code/deploy-gate-runner.mjs — the host runner behind the deploy-gate check's
// cmd: seam (D2). Sequences: diff → resolveDeployServices → deploy.sh → nx test-integration. exit 0 = all
// green (the cmd evaluator returns []), non-zero = a finding. Sandbox-robust: if the skill resolver / nx
// graph is unavailable (parity sandbox seeds only runtime/), falls back to a bare deploy.sh (stub-hit).
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const realSh = (cmd) => spawnSync(cmd, { shell: true, encoding: 'utf8', stdio: 'inherit' });
const realDiff = (base) => { try { return execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } };

export async function runDeployGate({ base = 'origin/main', sh = realSh, diffOf = realDiff } = {}) {
  const changed = diffOf(base);
  if (!changed.length) return { ok: true, ran: [] };

  let deployNeeded = true, services = [];
  try {
    const dd = await import('../../../.claude/skills/backlog-next/detect-deploy-needed.mjs');
    const { loadGraph } = await import('../../../tools/affected-projects.mjs');
    const cls = dd.classifyChanges(changed);
    deployNeeded = cls.deploy;
    if (deployNeeded) { try { services = dd.resolveDeployServices(loadGraph(), cls.seedFiles); } catch { services = cls.services; } }
  } catch { /* sandbox: resolver absent → bare deploy fallback (deployNeeded stays true) */ }

  const ran = [];
  if (deployNeeded) {
    const svc = services.length ? ` --services=${services.join(',')}` : '';
    ran.push('deploy.sh');
    const d = sh(`bash infrastructure/scripts/deploy.sh sandbox --prefix=dev${svc}`);
    if (d.status !== 0) return { ok: false, ran, stage: 'deploy', code: d.status };
    ran.push('nx test-integration');
    const t = sh(`node tools/affected-projects.mjs --base=${base} --with-target=test-integration | paste -sd, - | xargs -r -I{} pnpm nx run-many -t test-integration -p {}`);
    if (t.status !== 0) return { ok: false, ran, stage: 'integration', code: t.status };
  }
  return { ok: true, ran };
}

function main() {
  const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=origin/main').slice(7);
  runDeployGate({ base }).then((r) => { if (!r.ok) console.error(`[deploy-gate] ${r.stage} failed (code ${r.code})`); process.exit(r.ok ? 0 : 1); });
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/adapters/claude-code/test/deploy-gate-runner.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add runtime/adapters/claude-code/deploy-gate-runner.mjs runtime/adapters/claude-code/test/deploy-gate-runner.test.mjs
git commit --no-verify -m "feat(runtime): deploy-gate-runner adapter, sandbox-robust (WS-3)"
git log --oneline -1
```

---

## Task 6: `deploy-gate` CheckEntry (content check + starter-pack copy)

**Files:**
- Create: `runtime/content/checks/deploy-gate.yaml`
- Create: `runtime/starter/checks/deploy-gate.yaml` (for parity-sandbox visibility)
- Test: `runtime/content/test/deploy-gate-check.test.mjs`

**Interfaces:**
- Consumes: `validateCheck` (`runtime/engine/schema/check.schema.ts`), `loadRegistry` (`runtime/engine/lib/load-registry.mjs`).
- Produces: a registry-loadable, schema-valid `deploy-gate` check selectable at `contexts:['audit'], cost_tier:'expensive'`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/content/test/deploy-gate-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'yaml';
import { validateCheck } from '../../engine/schema/check.schema.ts';
import { selectChecks } from '../../engine/lib/run-watch.mjs';

const load = (p) => validateCheck(yaml.parse(readFileSync(p, 'utf8')));

test('DGC1 deploy-gate.yaml is schema-valid, deterministic, audit/expensive', () => {
  const r = load('runtime/content/checks/deploy-gate.yaml');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.value.evaluator.type, 'deterministic');
  assert.deepEqual(r.value.contexts, ['audit']);
  assert.equal(r.value.cost_tier, 'expensive');
});

test('DGC2 selected by an item-pre-ship expensive audit trigger, NOT by a gate trigger', () => {
  const check = load('runtime/content/checks/deploy-gate.yaml').value;
  const registry = { checks: [check], byId: new Map([[check.id, check]]), errors: [] };
  const picked = selectChecks({ registry, trigger: { on: 'item-pre-ship', contexts: ['audit'], cost_ceiling: 'expensive' }, changedScope: ['services/x/y/src/a.ts'] });
  assert.deepEqual(picked.map((c) => c.id), ['deploy-gate']);
  const notPicked = selectChecks({ registry, trigger: { on: 'ship', contexts: ['gate'], cost_ceiling: 'cheap' }, changedScope: ['services/x/y/src/a.ts'] });
  assert.deepEqual(notPicked.map((c) => c.id), []);   // gate-context run never selects it
});

test('DGC3 starter-pack copy is identical (sandbox visibility)', () => {
  const a = readFileSync('runtime/content/checks/deploy-gate.yaml', 'utf8');
  const b = readFileSync('runtime/starter/checks/deploy-gate.yaml', 'utf8');
  assert.equal(a, b);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/content/test/deploy-gate-check.test.mjs`
Expected: FAIL — yaml files absent.

- [ ] **Step 3: Write the check YAML (both locations, identical)**

```yaml
# runtime/content/checks/deploy-gate.yaml  (ALSO copy verbatim to runtime/starter/checks/deploy-gate.yaml)
id: deploy-gate
property: >
  A code/infra-touching item's branch delta deploys cleanly to the dev sandbox and its affected
  integration + involved e2e tests pass, before the runtime worker offers the ship floor decision.
kind: gap
evaluator:
  type: deterministic
  run: "cmd:node runtime/adapters/claude-code/deploy-gate-runner.mjs"
cost_tier: expensive
contexts: [audit]
scope:
  paths:
    - "services/**"
    - "libs/**"
    - "apps/**"
    - "infrastructure/**"
status: active
provenance:
  minted_by: "runtime-replatform-next"
  ratified: "2026-07-07"
```

Create both files with this exact content.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/content/test/deploy-gate-check.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Confirm the full registry still loads clean (registry-integrity)**

Run: `node runtime/engine/lib/meta-check.mjs`
Expected: exit 0, no output (the new check resolves + is internally consistent).

- [ ] **Step 6: Commit**

```bash
git add runtime/content/checks/deploy-gate.yaml runtime/starter/checks/deploy-gate.yaml runtime/content/test/deploy-gate-check.test.mjs
git commit --no-verify -m "feat(runtime): deploy-gate CheckEntry (content + starter pack) (WS-3)"
git log --oneline -1
```

---

## Task 7: `run-next.mjs` adapter driver (flag branch + provenance + side-cars)

**Files:**
- Create: `runtime/adapters/claude-code/run-next.mjs`
- Create: `runtime/adapters/claude-code/deploy-procedures.mjs` (injects the deploy runner as a `runner` on execute for the batch's judge is not needed — deterministic cmd; but the run-next driver wires capabilities with the deploy-gate registry)
- Test: `runtime/adapters/claude-code/test/run-next.test.mjs`

**Interfaces:**
- Consumes: `runWorker` (`../../engine/loop/worker.mjs`), `loadRegistry`, `readItems`, `recordRuntimePath`, `usesRuntimeEngine`, `gitHeadSha`, `pendingDecisions`.
- Produces: `driveNext({ itemId, backlogDir, checksDir, fulfil, capabilities, diffPaths, headSha }) → { exit, out }` mirroring `run-item.mjs`'s exit contract (0/3/1/2); CLI `main()` branches on `usesRuntimeEngine(process.env)`.

- [ ] **Step 1: Write the failing test**

```js
// runtime/adapters/claude-code/test/run-next.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { driveNext } from '../run-next.mjs';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'nf-rn-'));
  const bd = join(root, 'docs', 'backlog'); mkdirSync(bd, { recursive: true });
  writeFileSync(join(bd, 'i.md'), `---\nid: i\nstatus: active\ntype: refactor\nscope: docs/**\nout_of_scope: [x]\n---\nbody\n`, 'utf8');
  const cd = join(root, 'checks'); mkdirSync(cd, { recursive: true });
  return { root, bd, cd };
}

test('RN1 doc-layer item drives to ship floor park (exit 3), records path:runtime', async () => {
  const { root, bd, cd } = sandbox();
  try {
    const j = inMemoryJournal();
    const capabilities = { journal: j,
      execute: async () => ({ taskId: 'i', status: 'done', summary: 'done' }),
      ask: async () => ({ value: '<<HARNESS-PAUSE>>' }),   // park at ship floor
      runProcedure: async () => ({ status: 'done', findings: [] }) };
    const { exit, out } = await driveNext({ itemId: 'i', backlogDir: bd, checksDir: cd,
      capabilities, diffPaths: ['docs/backlog/i.md'], headSha: 'S1' });
    assert.equal(exit, 3);                                  // parked at ship floor
    assert.equal(out.result.status, 'paused');
    const prov = j.read('item-i').steps.get('path:runtime');
    assert.equal(prov.value.path, 'runtime');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('RN2 unknown item → exit 2', async () => {
  const { root, bd, cd } = sandbox();
  try {
    const { exit } = await driveNext({ itemId: 'nope', backlogDir: bd, checksDir: cd,
      capabilities: { journal: inMemoryJournal() }, diffPaths: [], headSha: 'S1' });
    assert.equal(exit, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/adapters/claude-code/test/run-next.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
#!/usr/bin/env node
// runtime/adapters/claude-code/run-next.mjs — the worker-drive adapter for backlog-next (WS-3). Mirrors
// run-item.mjs but injects the deploy-gate registry and threads lane diffPaths. Behind RUNTIME_ENGINE the
// backlog-next SKILL entry/closing step calls this; flag off → the legacy skill body (byte-for-byte).
// Exit: 0 done / 3 paused / 1 failed / 2 usage. Git-workflow preconditions stay host preflight/postflight.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { runWorker } from '../../engine/loop/worker.mjs';
import { loadRegistry } from '../../engine/lib/load-registry.mjs';
import { readItems } from '../../engine/lib/scope-gate.mjs';
import { pendingDecisions, gitHeadSha } from '../../engine/lib/journal.mjs';
import { recordRuntimePath } from '../../engine/lib/path-provenance.mjs';
import { makeClaudeCodeCapabilities } from './index.mjs';

const diffOf = (base) => { try { return execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } };

export async function driveNext({ itemId, backlogDir, checksDir, fulfil, capabilities, diffPaths, headSha }) {
  const item = readItems(backlogDir).find((i) => i.id === itemId);
  if (!item) return { exit: 2, out: { error: `unknown item: ${itemId}` } };
  const runId = `item-${itemId}`;
  if (fulfil) capabilities.journal.fulfil(runId, fulfil.key, fulfil.value);
  const registry = loadRegistry({ checksDir });
  const result = await runWorker({ item, capabilities, registry, headSha, diffPaths });
  recordRuntimePath(capabilities.journal, { runId, workstream: itemId, sha: headSha ?? gitHeadSha() });
  const pending = pendingDecisions(capabilities.journal.read(runId));
  const exit = result.status === 'done' ? 0 : result.status === 'paused' ? 3 : 1;
  return { exit, out: { result, pending } };
}

async function main() {
  const [itemId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const fi = process.argv.indexOf('--fulfil'); const vi = process.argv.indexOf('--value');
  const fv = fi >= 0 ? process.argv[fi + 1] : undefined; const vv = vi >= 0 ? process.argv[vi + 1] : undefined;
  if (!itemId || (fi >= 0) !== (vi >= 0)) { console.error('usage: run-next.mjs <item-id> [--fulfil <key> --value <json>]'); process.exit(2); }
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const capabilities = makeClaudeCodeCapabilities({});
  const { exit, out } = await driveNext({ itemId, backlogDir: cfg.backlogDir ?? 'docs/backlog', checksDir: cfg.checksDir,
    fulfil: fi >= 0 ? { key: fv, value: JSON.parse(vv) } : undefined, capabilities, diffPaths: diffOf('origin/main') });
  console.log(JSON.stringify(out, null, 2));
  process.exit(exit);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

(No separate `deploy-procedures.mjs` needed — the deploy-gate is a deterministic `cmd:` check, so the default `makeClaudeCodeCapabilities({})` suffices; the registry supplies the check. Remove that file from the Files list.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/adapters/claude-code/test/run-next.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add runtime/adapters/claude-code/run-next.mjs runtime/adapters/claude-code/test/run-next.test.mjs
git commit --no-verify -m "feat(runtime): run-next worker-drive adapter (WS-3)"
git log --oneline -1
```

---

## Task 8: Flag wiring in `backlog-next` SKILL.md

**Files:**
- Modify: `.claude/skills/backlog-next/SKILL.md` (Step 5 routing + closing phase — add the `RUNTIME_ENGINE` branch that calls `run-next.mjs`)
- Create: `.claude/skills/backlog-next/next-driver.mjs` (the one-line flag branch, mirroring `backlog-gate.mjs`)
- Test: `.claude/skills/backlog-next/test/next-driver.test.mjs`

**Interfaces:**
- Consumes: `usesRuntimeEngine` (`runtime/engine/lib/path-provenance.mjs`).
- Produces: `nextDriver(env) → { cmd, mode }` — flag on → `{ cmd: 'node runtime/adapters/claude-code/run-next.mjs', mode: 'runtime' }`; off → `{ cmd: null, mode: 'legacy' }`.

- [ ] **Step 1: Write the failing test**

```js
// .claude/skills/backlog-next/test/next-driver.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDriver } from '../next-driver.mjs';

test('ND1 flag on → runtime driver', () => {
  assert.deepEqual(nextDriver({ RUNTIME_ENGINE: '1' }), { cmd: 'node runtime/adapters/claude-code/run-next.mjs', mode: 'runtime' });
});
test('ND2 flag off → legacy', () => {
  assert.deepEqual(nextDriver({}), { cmd: null, mode: 'legacy' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/backlog-next/test/next-driver.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// .claude/skills/backlog-next/next-driver.mjs — the WS-3 strangler branch (mirrors backlog-gate.mjs).
// Flag on → the SKILL Step-5 drive routes to the runtime worker; off → the legacy SKILL.md body runs.
// Single decision site so the flag lives in exactly one place.
import { usesRuntimeEngine } from '../../../runtime/engine/lib/path-provenance.mjs';
export function nextDriver(env) {
  return usesRuntimeEngine(env)
    ? { cmd: 'node runtime/adapters/claude-code/run-next.mjs', mode: 'runtime' }
    : { cmd: null, mode: 'legacy' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/skills/backlog-next/test/next-driver.test.mjs`
Expected: PASS (2/2).

- [ ] **Step 5: Document the branch in SKILL.md**

Add a short subsection under `### 5. Route to the downstream skill` in `.claude/skills/backlog-next/SKILL.md` stating: when `RUNTIME_ENGINE` is set, the execute/closing drive is performed by `node runtime/adapters/claude-code/run-next.mjs <id>` (the runtime worker owns the deploy-gate at pre-ship); when unset, the legacy body below runs unchanged. Reference `next-driver.mjs`. Keep the legacy prose byte-for-byte (do NOT delete it — P6).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/backlog-next/next-driver.mjs .claude/skills/backlog-next/test/next-driver.test.mjs .claude/skills/backlog-next/SKILL.md
git commit --no-verify -m "feat(runtime): RUNTIME_ENGINE next-driver flag branch in backlog-next (WS-3)"
git log --oneline -1
```

---

## Task 9: Upgrade `rt-next-lane-complex-ship` to assert the runtime-owned batch

**Files:**
- Modify: `scripts/parity-oracle/scenarios/rt-next-lane-complex-ship.scenario.mjs`

**Context:** The scenario currently models deploy *during execute* (operator runs it). WS-3 moves deploy into the runtime batch: the operator does the code work + commit at the execute park; the pre-ship batch fires `deploy.sh` (via the starter-pack `deploy-gate` check + sandbox-robust runner). The journal now carries the sha-pinned `e2e` record.

- [ ] **Step 1: Update the operator prompt** so the operator performs ONLY the code work + commit at the execute park (it must NOT run the deploy — the runtime batch does). Keep `driver: 'item'`, `terminal: 'pause'`, `state.fileContains`.

- [ ] **Step 2: Add the batch's journal assertion** — insert `{ runId: 'item-infra-retention-bump', has: 'e2e' }` into the `journal[]` array (after `execute:` and before `gate.ship`). Keep `callLog: { called: ['deploy.sh'], neverCalled: ['gh pr merge'] }` — deploy.sh is now called by the batch.

- [ ] **Step 3: Run the runtime scenario in isolation against the sandbox**

Run: `node scripts/parity-oracle/run.mjs --scenario=rt-next-lane-complex-ship --mode=parity` (or the repo's documented single-scenario oracle invocation — check `scripts/parity-oracle/run.mjs --help`).
Expected: the runtime side drives the worker, the batch fires `deploy.sh` (stub), the `e2e` record is journaled, and the pair stays `dominant`.
If the sandbox cannot see the `deploy-gate` check or the runner import fails: confirm `runtime/starter/checks/deploy-gate.yaml` exists (Task 6) and the runner's sandbox fallback (Task 5) fires a bare `deploy.sh`. If it still cannot fire in-sandbox, invoke the design's escape hatch: revert this scenario to its `deploy-during-execute` form and file the sandbox upgrade forward (note it in the workstream Decision log).

- [ ] **Step 4: Commit**

```bash
git add scripts/parity-oracle/scenarios/rt-next-lane-complex-ship.scenario.mjs
git commit --no-verify -m "test(parity): rt-next-lane-complex-ship asserts the runtime-owned deploy-gate (WS-3)"
git log --oneline -1
```

---

## Task 10: Author the 6 `rt-next-*` twins + flip `MAPPING`

**Files:**
- Create: `scripts/parity-oracle/scenarios/rt-next-lane-doc-layer.scenario.mjs`, `rt-next-lane-simple.scenario.mjs`, `rt-next-lane-design-doc.scenario.mjs`, `rt-next-lane-complex.scenario.mjs`, `rt-next-auto-design-pause.scenario.mjs`, `rt-next-auto-fork-resolve.scenario.mjs`
- Modify: `scripts/parity-oracle/mapping.mjs:37-42` (flip the 6 `P5(...)` rows to `RT('rt-<id>.scenario.mjs')`)

**Template** (spread the legacy scenario, set `driver:'item'`, `OPERATOR_PROMPT`, `path:'runtime'` journal assertion). Per-scenario the runtime worker **parks at the ship floor** (`terminal:'pause'`), so assert the lane-appropriate runtime effect, not the legacy terminal:

| Twin | Runtime-observable assertion |
|---|---|
| `rt-next-lane-doc-layer` | doc-only item → `journal` has **no** `e2e` record + `awaiting: ship-<id>` + `path:runtime`. (`classifyLane`→doc-layer skips the batch.) |
| `rt-next-lane-simple` | single-service no-deploy item → batch runs but `callLog.neverCalled:['deploy.sh']` (detect-deploy → skip) or `e2e.green:true` + `awaiting: ship`. |
| `rt-next-lane-design-doc` | `type:design` doc-only → same as doc-layer (no `e2e` record). |
| `rt-next-lane-complex` | public-interface item → `journal` has the `e2e` record (batch fired) + `awaiting: ship`. |
| `rt-next-auto-design-pause` | `--auto` design item → `terminal:'pause'` at the design approval floor; `callLog.neverCalled:['deploy.sh','gh pr create']`. (`autoResolvePolicy`→pause.) |
| `rt-next-auto-fork-resolve` | `--auto` local fork → resolves, `fileContains: '## Decision log'`, completes/parks without a shared-surface pause. (`autoResolvePolicy`→auto-resolve.) |

- [ ] **Step 1** (per twin): create `rt-<id>.scenario.mjs` spreading `../../benchmark-backlog/scenarios/<id>.scenario.mjs`, setting `driver:'item'`, `prompt: OPERATOR_PROMPT(...)` (driver command `node runtime/adapters/claude-code/run-next.mjs <item-id>`), the `journal`/`callLog`/`state` assertions from the table, and a `rubric` mirroring the legacy one.

- [ ] **Step 2**: flip each `MAPPING` row from `P5(...)` to `RT('rt-<id>.scenario.mjs')` in `scripts/parity-oracle/mapping.mjs`.

- [ ] **Step 3**: run the oracle over the mapped set and iterate to `dominant`:

Run: `node scripts/parity-oracle/run.mjs --mode=parity` (writes a report to the gitignored `benchmarks/` path — capture it).
Expected: all 6 new pairs `dominant`; `overallParity` green; `unmappedIds()` no longer lists the 6 `next-*` rows (only `bne-*`, `themes-*`, and the 2 WS-1 `add-*` remain). Treat a fails-then-passes as a real signal — pull the sandbox journal, re-run a confirmation pass (flake = broken).

- [ ] **Step 4: Commit**

```bash
git add scripts/parity-oracle/scenarios/rt-next-*.scenario.mjs scripts/parity-oracle/mapping.mjs
git commit --no-verify -m "test(parity): 6 rt-next-* twins mapped dominant; flip P5→RT (WS-3)"
git log --oneline -1
```

---

## Closing phase (run by the `backlog-next` skill, not a plan task)

After Task 10, control returns to the `backlog-next` closing phase (SKILL.md §6). The relevant WS-3 specifics:

- **6.2** true-affected `test,lint` over `AFFECTED` — must be green.
- **6.3/6.4** `detect-deploy-needed.mjs` will say **deploy** (this workstream touches `runtime/**`… note: `runtime/**` is TIER0 — *no deploy*). **Confirm:** WS-3 changes are `runtime/`, `.claude/`, `scripts/`, `docs/` — all TIER0. So `detect-deploy-needed` exits 10 (no deploy) and the real deploy-gate dogfood does **not** fire here. The deploy-gate's live proof is therefore deferred to the first *service-touching* workstream driven by `run-next` (record this in the workstream's Decision log and `validation_gate:`), OR run one synthetic `run-next` drive of a throwaway infra item to fire it once. Decide at closing time.
- **6.4b** backward-edge ritual (`ship-recheck` + mint consideration) — WS-3 likely mints a lesson (the deploy-gate-as-check pattern; the runtime-parks-at-ship parity fact).
- **6.5–6.8** ship the backlog file, regen index, `finishing-a-development-branch` (PR), worktree cleanup.

---

## Self-Review

**Spec coverage:**
- D1 preShipBatch shared helper → Task 3. ✓
- D2 deterministic cmd deploy-gate runner → Tasks 5, 6. ✓
- D3 classifyLane + laneToTrigger → Task 1; used in Task 4. ✓
- D4 principled split (git-workflow preconditions stay host) → Task 7 keeps preflight/postflight as host scripts; only content + deploy-gate are checks. ✓
- D5 autoResolvePolicy + decision-log side-car → Task 2 (policy); decision-log side-car is invoked by the run-next driver / closing phase (existing `decision-log.mjs`). ✓
- D6 flag branch + recordRuntimePath → Tasks 7, 8. ✓
- Worker pre-ship step → Task 4. ✓
- Parity acceptance (6 next-* dominant + upgraded complex-ship) → Tasks 9, 10. ✓
- Flag flip for the backlog-next slice → Task 8. ✓

**Placeholder scan:** the parity twins (Task 10) give per-scenario assertions in a table rather than full literal files, because the exact `journal`/`callLog` shape is tuned empirically against the sandbox (the legacy scenarios' own comments document repeated corrections). The template + per-twin assertion + the "iterate to dominant" loop is the honest specification; do not fabricate a final scenario body that the oracle hasn't confirmed.

**Type consistency:** `classifyLane(item, diffPaths)` and `laneToTrigger(lane)` used identically in Task 4; `preShipBatch({...contexts, cost_ceiling, on})` signature matches its call in both the orchestrator refactor (Task 3) and the worker (Task 4); `runDeployGate({ base, sh, diffOf })` test-injectable seams match the CLI `main`. `driveNext` mirrors `driveItem`'s return shape.

**Open risk carried into execution:** the parity-sandbox visibility of the deploy-gate (Task 9 Step 3) is the one empirically-unproven seam (spec §14) — the escape hatch (dogfood-only, don't rework the green scenario) is documented inline.
