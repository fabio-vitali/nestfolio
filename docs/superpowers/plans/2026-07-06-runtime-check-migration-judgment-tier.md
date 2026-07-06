# Runtime Judgment Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the runtime's judgment checks actually run — build the live judge binding + a cadence dispatcher, migrate the 4 audit-* skills into judgment checks, and demonstrate a real audit routed through intake.

**Architecture:** Two new ring-2 modules under `runtime/adapters/claude-code/` — `audit-procedures.mjs` populates the `procedures` map (each audit skill → a read-only headless `claude -p` run emitting structured findings, reusing `scripts/benchmark-backlog/{runner,judge}.mjs`), and `run-audit.mjs` is the cadence dispatcher that derives the judge from that map and runs the watch engine. Ring-1 (`runtime/engine/**`) is untouched — the seam already exists (`index.mjs:14` wires `procedures`; `derive-judge.mjs` derives the judge); we only populate it. A GitHub Actions workflow fires the dispatcher on a weekly cadence.

**Tech Stack:** Node ≥24 (native `.ts` type-stripping, zero build), `node:test`, `yaml`, `zod` (schemas), Claude Code CLI (`claude -p`), GitHub Actions.

## Global Constraints

- **Node ≥24 required** — native `.ts` type-stripping; no build step. Tests run via `node --test`.
- **Ring rule (enforced by `runtime/engine/test/import-boundary.test.mjs`):** ring-1 (`runtime/engine/**`) must NOT import an adapter, a skill, or shell `claude`. All new headless-claude code lives in ring-2 (`runtime/adapters/**`). Do NOT add engine-side imports of adapters or scripts.
- **CheckEntry schema is FROZEN** (`runtime/engine/schema/check.schema.ts`) — do not edit it. Judgment ⇒ `flake_contract` required (`:82-88`); run-schemes closed to `['cmd','module','eslint','skill']` (`:16`); FindingKind ∈ `drift | inconsistency | gap | staleness`.
- **Worktree commits:** this runs in worktree `feat/runtime-check-migration-judgment-tier`. Every commit uses `git commit --no-verify` (the worktree pre-commit hook silently rejects code commits) and MUST be verified with `git log --oneline -1` after (never trust an echo).
- **Test conventions:** runtime tests live in `runtime/engine/test/**` (engine) or `runtime/adapters/*/test/**` (adapters), flat, `*.test.mjs`. Run the whole runtime suite with `pnpm nx test runtime`.
- **Model default for audit runs:** `claude-opus-4-8` (overridable via `RUNTIME_AUDIT_MODEL`). Judge/headless model ids per `runtime/GUIDE.md`.

---

### Task 1: Read-only `allowedTools` seam in `buildClaudeArgs` (open item O1)

The audit procedure must run `claude -p` with Write/Edit DENIED so a cadence run can never mutate the tree. `buildClaudeArgs` currently hard-codes the allow-list (`scripts/benchmark-backlog/runner.mjs:44`). Thread an optional `allowedTools` through it — additive, default preserved.

**Files:**
- Modify: `scripts/benchmark-backlog/runner.mjs:39-55` (`buildClaudeArgs`)
- Test: `scripts/benchmark-backlog/test/runner-args.test.mjs`

**Interfaces:**
- Produces: `buildClaudeArgs(scenario, runnerOpts)` now reads `runnerOpts.allowedTools?: string[]` (default `['Bash','Read','Write','Edit','Glob','Grep','Skill']`).

- [ ] **Step 1: Write the failing test** — append to `scripts/benchmark-backlog/test/runner-args.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeArgs } from '../runner.mjs';

test('buildClaudeArgs honors a custom read-only allowedTools list', () => {
  const args = buildClaudeArgs(
    { prompt: 'p' },
    { model: 'claude-opus-4-8', pauseConvention: 'n/a', allowedTools: ['Bash', 'Read', 'Glob', 'Grep', 'Skill'] },
  );
  const i = args.indexOf('--allowedTools');
  assert.ok(i >= 0, '--allowedTools present');
  assert.equal(args[i + 1], 'Bash Read Glob Grep Skill');
  assert.ok(!args[i + 1].includes('Write'), 'Write denied');
  assert.ok(!args[i + 1].includes('Edit'), 'Edit denied');
});

test('buildClaudeArgs default allowedTools is unchanged (back-compat)', () => {
  const args = buildClaudeArgs({ prompt: 'p' }, { model: 'm', pauseConvention: 'n/a' });
  const i = args.indexOf('--allowedTools');
  assert.equal(args[i + 1], 'Bash Read Write Edit Glob Grep Skill');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/benchmark-backlog/test/runner-args.test.mjs`
Expected: FAIL on the first test (default list ignores the custom `allowedTools`, so `args[i+1]` is the full default `'Bash Read Write Edit Glob Grep Skill'`).

- [ ] **Step 3: Modify `buildClaudeArgs`** — change the destructure + the `--allowedTools` arg in `scripts/benchmark-backlog/runner.mjs`:

```javascript
export function buildClaudeArgs(scenario, runnerOpts) {
  const { model, pauseConvention,
    allowedTools = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill'] } = runnerOpts;
  const args = ['-p', scenario.prompt, '--print', '--verbose', '--output-format', 'stream-json',
    '--setting-sources', 'project', '--strict-mcp-config', '--model', model,
    '--append-system-prompt', pauseConvention,
    '--allowedTools', allowedTools.join(' ')];
  if (scenario.denySubskills?.length) args.push('--disallowedTools', scenario.denySubskills.join(' '));
  return args;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/benchmark-backlog/test/runner-args.test.mjs`
Expected: PASS (both new tests + the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
WT=/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/runtime-check-migration-judgment-tier
git -C "$WT" add scripts/benchmark-backlog/runner.mjs scripts/benchmark-backlog/test/runner-args.test.mjs
git -C "$WT" commit --no-verify -m "feat(benchmark): thread optional allowedTools through buildClaudeArgs"
git -C "$WT" log --oneline -1
```

---

### Task 2: Seam A — the live judge binding (`audit-procedures.mjs`)

Populate the `procedures` map: each audit skill → a read-only headless run emitting structured findings.

**Files:**
- Create: `runtime/adapters/claude-code/audit-procedures.mjs`
- Test: `runtime/adapters/claude-code/test/audit-procedures.test.mjs`

**Interfaces:**
- Consumes: `runScenario` from `scripts/benchmark-backlog/runner.mjs`; `parseJudgeResult` from `scripts/benchmark-backlog/judge.mjs`; each check's `check.scope.paths`.
- Produces:
  - `buildAuditPrompt(skillName: string, scopePaths: string[]): string`
  - `makeAuditProcedures(opts?: { model?, timeoutMs?, cwd?, env?, runScenario? }): Record<string, (args:{check}) => Promise<{taskId, status:'done'|'failed', summary, findings:{detail,evidence?,scope}[]}>>` — keys: `audit-service`, `audit-domain`, `audit-system`, `audit-e2e-test`. `runScenario` is injectable for tests.

- [ ] **Step 1: Write the failing test** — `runtime/adapters/claude-code/test/audit-procedures.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAuditProcedures, buildAuditPrompt } from '../audit-procedures.mjs';

const check = { id: 'audit-service', kind: 'staleness', scope: { paths: ['services/**'] } };

test('procedure returns done + parsed findings from a fenced json result', async () => {
  const fake = async () => ({ result: '```json\n{"findings":[{"detail":"card stale","evidence":"x.ts:1","scope":["services/a/**"]}]}\n```' });
  const procs = makeAuditProcedures({ runScenario: fake });
  const r = await procs['audit-service']({ check });
  assert.equal(r.status, 'done');
  assert.equal(r.taskId, 'audit-service');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].detail, 'card stale');
});

test('empty findings array is a clean done', async () => {
  const fake = async () => ({ result: '```json\n{"findings":[]}\n```' });
  const procs = makeAuditProcedures({ runScenario: fake });
  const r = await procs['audit-service']({ check });
  assert.equal(r.status, 'done');
  assert.deepEqual(r.findings, []);
});

test('unparseable result retries once then fails (not throws)', async () => {
  let calls = 0;
  const fake = async () => { calls++; return { result: 'no json here' }; };
  const procs = makeAuditProcedures({ runScenario: fake });
  const r = await procs['audit-service']({ check });
  assert.equal(calls, 2, 'retried once');
  assert.equal(r.status, 'failed');
});

test('runs read-only: passes an allowedTools without Write/Edit', async () => {
  let seen;
  const fake = async (_scn, _ref, opts) => { seen = opts; return { result: '```json\n{"findings":[]}\n```' }; };
  const procs = makeAuditProcedures({ runScenario: fake });
  await procs['audit-service']({ check });
  assert.ok(Array.isArray(seen.allowedTools));
  assert.ok(!seen.allowedTools.includes('Write') && !seen.allowedTools.includes('Edit'));
});

test('buildAuditPrompt names the skill, the scope, and demands read-only json', () => {
  const p = buildAuditPrompt('audit-domain', ['services/**', 'libs/**']);
  assert.match(p, /audit-domain/);
  assert.match(p, /services\/\*\*/);
  assert.match(p, /READ-ONLY/i);
  assert.match(p, /```json/);
});

test('all four audit skills are present', () => {
  const procs = makeAuditProcedures({ runScenario: async () => ({ result: '{"findings":[]}' }) });
  assert.deepEqual(Object.keys(procs).sort(),
    ['audit-domain', 'audit-e2e-test', 'audit-service', 'audit-system']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/adapters/claude-code/test/audit-procedures.test.mjs`
Expected: FAIL with "Cannot find module '../audit-procedures.mjs'".

- [ ] **Step 3: Create `runtime/adapters/claude-code/audit-procedures.mjs`:**

```javascript
// runtime/adapters/claude-code/audit-procedures.mjs — Seam A (ring-2). Populates the runProcedure
// `procedures` map for the 4 audit-* skills, so deriveJudge yields a working judge. Each procedure
// runs its audit skill READ-ONLY headless (reusing benchmark-backlog's spawn) and returns structured
// findings. GUIDE §6: the runtime harness builds on benchmark-backlog's reusable seam.
import { runScenario as defaultRunScenario } from '../../../scripts/benchmark-backlog/runner.mjs';
import { parseJudgeResult } from '../../../scripts/benchmark-backlog/judge.mjs';

export const AUDIT_SKILLS = ['audit-service', 'audit-domain', 'audit-system', 'audit-e2e-test'];
const READ_ONLY_TOOLS = ['Bash', 'Read', 'Glob', 'Grep', 'Skill'];   // no Write/Edit — a cadence audit never mutates

export function buildAuditPrompt(skillName, scopePaths) {
  return [
    `Run the \`${skillName}\` skill to audit this surface for consistency drift:`,
    scopePaths.map((p) => `  - ${p}`).join('\n'),
    'This is a READ-ONLY audit: do NOT modify, create, commit, or delete any files.',
    'When finished, emit ONLY the consistency violations you found as exactly one fenced json block',
    'and nothing else — no preamble, no prose before or after:',
    '```json',
    '{"findings":[{"detail":"<what is inconsistent>","evidence":"<file:line or command output>","scope":["<glob>"]}]}',
    '```',
    'An empty findings array means the property holds.',
  ].join('\n');
}

export function makeAuditProcedures({
  model = 'claude-opus-4-8', timeoutMs = 600000,
  cwd = process.cwd(), env = process.env, runScenario = defaultRunScenario,
} = {}) {
  const procedures = {};
  for (const skill of AUDIT_SKILLS) {
    procedures[skill] = async ({ check }) => {
      const prompt = buildAuditPrompt(skill, check.scope.paths);
      let lastErr;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await runScenario({ prompt, denySubskills: [] }, 'HEAD',
          { model, cwd, env, pauseConvention: 'n/a', timeoutMs, allowedTools: READ_ONLY_TOOLS });
        try {
          const parsed = parseJudgeResult(res.result ?? '');
          const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
          return { taskId: skill, status: 'done', summary: `${skill}: ${findings.length} finding(s)`, findings };
        } catch (e) { lastErr = e; }
      }
      return { taskId: skill, status: 'failed', summary: `${skill}: unparseable findings — ${lastErr?.message ?? lastErr}`, findings: [] };
    };
  }
  return procedures;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/adapters/claude-code/test/audit-procedures.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
WT=/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/runtime-check-migration-judgment-tier
git -C "$WT" add runtime/adapters/claude-code/audit-procedures.mjs runtime/adapters/claude-code/test/audit-procedures.test.mjs
git -C "$WT" commit --no-verify -m "feat(runtime): audit-procedures — live judge binding for the 4 audit-* skills"
git -C "$WT" log --oneline -1
```

---

### Task 3: Seam B — the cadence dispatcher (`run-audit.mjs`)

Derive the judge from the audit procedures, run the watch engine for an `[audit]/expensive` trigger, emit findings to stdout + a gitignored artifact. Support `--only=<check-id>` for a cheap single-skill demo.

**Files:**
- Create: `runtime/adapters/claude-code/run-audit.mjs`
- Test: `runtime/adapters/claude-code/test/run-audit.test.mjs`
- Modify: `.gitignore` (add `runtime/.audit-findings/`)

**Interfaces:**
- Consumes: `loadRegistry`, `registryErrorLines` (`engine/lib/load-registry.mjs`); `loadTriggers`, `runWatch` (`engine/lib/run-watch.mjs`); `deriveJudge` (`engine/lib/derive-judge.mjs`); `makeClaudeCodeCapabilities` (`./index.mjs`); `makeAuditProcedures` (`./audit-procedures.mjs`).
- Produces: `runAudit({ registry, trigger, judge, changedScope?, only? }): Promise<Finding[]>` — filters `registry.checks` to `only` when set, then `runWatch`.

- [ ] **Step 1: Write the failing test** — `runtime/adapters/claude-code/test/run-audit.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAudit } from '../run-audit.mjs';

const auditCheck = (id) => ({
  id, property: 'p', kind: 'gap',
  evaluator: { type: 'judgment', run: `skill:${id}` },
  cost_tier: 'expensive', contexts: ['audit'], scope: { paths: ['services/**'] },
  status: 'active',
  flake_contract: { eval_scenario: 'x.mjs', allowed_flake_rate: 0.05, calibration: 'c' },
});
const trigger = { on: 'schedule', contexts: ['audit'], cost_ceiling: 'expensive' };

test('runAudit runs the judge over selected audit checks and returns completed findings', async () => {
  const registry = { checks: [auditCheck('audit-service')], byId: new Map(), errors: [] };
  const judge = async (check) => [{ detail: `${check.id} drift`, scope: ['services/a/**'] }];
  const findings = await runAudit({ registry, trigger, judge, changedScope: ['**/*'] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'audit-service');
  assert.equal(findings[0].detail, 'audit-service drift');
  assert.ok(findings[0].raised_at, 'watch completes raised_at');
});

test('--only filters the registry to a single check', async () => {
  const registry = { checks: [auditCheck('audit-service'), auditCheck('audit-domain')], byId: new Map(), errors: [] };
  const judge = async (check) => [{ detail: `${check.id} drift`, scope: ['services/a/**'] }];
  const findings = await runAudit({ registry, trigger, judge, changedScope: ['**/*'], only: 'audit-service' });
  assert.deepEqual(findings.map((f) => f.check), ['audit-service']);
});

test('clean audit yields zero findings', async () => {
  const registry = { checks: [auditCheck('audit-service')], byId: new Map(), errors: [] };
  const judge = async () => [];
  const findings = await runAudit({ registry, trigger, judge, changedScope: ['**/*'] });
  assert.deepEqual(findings, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/adapters/claude-code/test/run-audit.test.mjs`
Expected: FAIL with "Cannot find module '../run-audit.mjs'".

- [ ] **Step 3: Create `runtime/adapters/claude-code/run-audit.mjs`:**

```javascript
#!/usr/bin/env node
// runtime/adapters/claude-code/run-audit.mjs — Seam B (ring-2). The expensive-check cadence dispatcher:
// derive the judge from the audit procedures, run the watch engine for an [audit]/expensive trigger,
// emit findings (stdout + a gitignored artifact for CI upload / later intake). exit 0 clean / 1 findings / 2 usage.
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry, registryErrorLines } from '../../engine/lib/load-registry.mjs';
import { loadTriggers, runWatch } from '../../engine/lib/run-watch.mjs';
import { deriveJudge } from '../../engine/lib/derive-judge.mjs';
import { makeClaudeCodeCapabilities } from './index.mjs';
import { makeAuditProcedures } from './audit-procedures.mjs';

export async function runAudit({ registry, trigger, judge, changedScope = ['**/*'], only }) {
  const scoped = only ? { ...registry, checks: registry.checks.filter((c) => c.id === only) } : registry;
  return await runWatch({ registry: scoped, trigger, changedScope, judge });
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const on = args.on ?? 'schedule';
  const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
  const registry = loadRegistry({ checksDir: cfg.checksDir });
  const errLines = registryErrorLines(registry);
  if (errLines) { console.error('run-audit: registry corrupt (fail-closed):'); for (const l of errLines) console.error(l); process.exit(2); }
  const trigger = loadTriggers(cfg.triggersFile).find((t) => t.on === on);
  if (!trigger) { console.error(`unknown trigger: ${on}`); process.exit(2); }
  const procedures = makeAuditProcedures({ model: process.env.RUNTIME_AUDIT_MODEL });
  const capabilities = makeClaudeCodeCapabilities({ procedures });
  const judge = deriveJudge(capabilities.runProcedure);
  const findings = await runAudit({ registry, trigger, judge, only: args.only });
  const runId = `audit-${on}-${process.env.GITHUB_RUN_ID ?? 'local'}`;
  const dir = 'runtime/.audit-findings';
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${runId}.json`);
  writeFileSync(path, JSON.stringify({ runId, trigger: on, findings }, null, 2));
  console.log(JSON.stringify({ runId, count: findings.length, path, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/adapters/claude-code/test/run-audit.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the artifact dir to `.gitignore`** — append:

```
# runtime audit findings (produced by run-audit.mjs on a cadence; uploaded as a CI artifact)
runtime/.audit-findings/
```

- [ ] **Step 6: Commit**

```bash
WT=/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/runtime-check-migration-judgment-tier
git -C "$WT" add runtime/adapters/claude-code/run-audit.mjs runtime/adapters/claude-code/test/run-audit.test.mjs .gitignore
git -C "$WT" commit --no-verify -m "feat(runtime): run-audit — expensive-check cadence dispatcher"
git -C "$WT" log --oneline -1
```

---

### Task 4: Content — 4 audit judgment checks + stub eval scenarios + `triggers.yaml` fix

Migrate the 4 audit-* skills into judgment `CheckEntry`s, add existence-stub eval scenarios (mirroring the template), and fix the `schedule` trigger's cost ceiling so audit checks can actually fire on it.

**Files:**
- Create: `runtime/content/checks/audit-{service,domain,system,e2e-test}.yaml`
- Create: `runtime/eval/scenarios/audit-{service,domain,system,e2e-test}.scenario.mjs`
- Modify: `runtime/content/triggers.yaml:10-13` (`schedule` trigger)
- Test: `runtime/engine/test/audit-checks.test.mjs`

**Interfaces:**
- Produces: 4 registry entries `audit-service|audit-domain|audit-system|audit-e2e-test`, each `evaluator.type: judgment`, `run: "skill:audit-*"`, `cost_tier: expensive`, `contexts: [audit]`, with a `flake_contract`.

- [ ] **Step 1: Write the failing test** — `runtime/engine/test/audit-checks.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from '../lib/load-registry.mjs';
import { loadTriggers } from '../lib/run-watch.mjs';

const AUDITS = ['audit-service', 'audit-domain', 'audit-system', 'audit-e2e-test'];

test('the 4 audit-* judgment checks load, are valid, judgment, audit-context, expensive, with a flake_contract', () => {
  const reg = loadRegistry({ checksDir: 'runtime/content/checks' });
  assert.deepEqual(reg.errors, [], 'registry has no load/validation errors');
  for (const id of AUDITS) {
    const c = reg.byId.get(id);
    assert.ok(c, `${id} present`);
    assert.equal(c.evaluator.type, 'judgment');
    assert.equal(c.evaluator.run, `skill:${id}`);
    assert.equal(c.cost_tier, 'expensive');
    assert.deepEqual(c.contexts, ['audit']);
    assert.ok(c.flake_contract, `${id} carries a flake_contract`);
  }
});

test('the schedule trigger can afford expensive audit checks', () => {
  const t = loadTriggers('runtime/content/triggers.yaml').find((x) => x.on === 'schedule');
  assert.ok(t.contexts.includes('audit'));
  assert.equal(t.cost_ceiling, 'expensive');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/engine/test/audit-checks.test.mjs`
Expected: FAIL (checks not found; schedule ceiling still `moderate`).

- [ ] **Step 3a: Create the 4 check YAMLs.** `runtime/content/checks/audit-service.yaml`:

```yaml
id: audit-service
property: >
  Every service's CLAUDE.md card matches its code — event subscriptions, handlers, CDK constructs,
  and stated responsibilities are accurate and not stale.
kind: staleness
evaluator:
  type: judgment
  run: "skill:audit-service"
cost_tier: expensive
contexts: [audit]
scope:
  paths: ["services/**"]
status: active
flake_contract:
  eval_scenario: "runtime/eval/scenarios/audit-service.scenario.mjs"
  allowed_flake_rate: 0.05
  calibration: "n=20 runs on a known-fresh + known-stale service-card pair; gatePassRate >= 0.95 (real mechanics deferred to SPEC 2 §eval)"
  min_confidence: 0.7
provenance:
  minted_by: "runtime-check-migration-judgment-tier"
  lesson: "MEMORY/feedback_verify_before_documenting.md"
  ratified: "2026-07-06"
```

`runtime/content/checks/audit-domain.yaml`:

```yaml
id: audit-domain
property: >
  Each domain is internally consistent — service completeness, adapter forwarding, event contracts,
  and flow specs all validate against the code.
kind: inconsistency
evaluator:
  type: judgment
  run: "skill:audit-domain"
cost_tier: expensive
contexts: [audit]
scope:
  paths: ["services/**", "libs/**"]
status: active
flake_contract:
  eval_scenario: "runtime/eval/scenarios/audit-domain.scenario.mjs"
  allowed_flake_rate: 0.05
  calibration: "n=20 runs on a known-consistent + known-broken domain pair; gatePassRate >= 0.95 (real mechanics deferred to SPEC 2 §eval)"
  min_confidence: 0.7
provenance:
  minted_by: "runtime-check-migration-judgment-tier"
  ratified: "2026-07-06"
```

`runtime/content/checks/audit-system.yaml`:

```yaml
id: audit-system
property: >
  The system is globally consistent — no orphaned services/events, flow coverage is complete, and
  architecture docs (SERVICE-INVENTORY count, BACKLOG design refs, orientation skills) are fresh.
kind: inconsistency
evaluator:
  type: judgment
  run: "skill:audit-system"
cost_tier: expensive
contexts: [audit]
scope:
  paths: ["services/**", "libs/**", "docs/**", ".claude/skills/**"]
status: active
flake_contract:
  eval_scenario: "runtime/eval/scenarios/audit-system.scenario.mjs"
  allowed_flake_rate: 0.05
  calibration: "n=20 runs on a known-consistent + known-drifted system snapshot; gatePassRate >= 0.95 (real mechanics deferred to SPEC 2 §eval)"
  min_confidence: 0.7
provenance:
  minted_by: "runtime-check-migration-judgment-tier"
  ratified: "2026-07-06"
```

`runtime/content/checks/audit-e2e-test.yaml`:

```yaml
id: audit-e2e-test
property: >
  The E2E feature test suite is complete and convention-compliant — coverage gaps, anti-patterns,
  and configuration issues in apps/e2e-feature-tests are absent.
kind: gap
evaluator:
  type: judgment
  run: "skill:audit-e2e-test"
cost_tier: expensive
contexts: [audit]
scope:
  paths: ["apps/e2e-feature-tests/**"]
status: active
flake_contract:
  eval_scenario: "runtime/eval/scenarios/audit-e2e-test.scenario.mjs"
  allowed_flake_rate: 0.05
  calibration: "n=20 runs on a known-complete + known-gappy e2e suite pair; gatePassRate >= 0.95 (real mechanics deferred to SPEC 2 §eval)"
  min_confidence: 0.7
provenance:
  minted_by: "runtime-check-migration-judgment-tier"
  ratified: "2026-07-06"
```

- [ ] **Step 3b: Create the 4 stub eval scenarios.** Each of `runtime/eval/scenarios/audit-{service,domain,system,e2e-test}.scenario.mjs` gets identical stub content (mirrors `integration-test-completeness.scenario.mjs`):

```javascript
// STUB — existence-only, so meta-check assertion 3 passes for this judgment content-ring entry.
// Real calibration / flake regression is deferred to SPEC 2 §eval (out of scope for
// runtime-check-migration-judgment-tier). Do not build judgment eval mechanics here.
export const scenario = { note: 'stub: SPEC 2 owns judgment eval scenarios' };
```

- [ ] **Step 3c: Fix `runtime/content/triggers.yaml`** — the `schedule` trigger (lines 10-13) becomes:

```yaml
  - on: schedule
    cron: "0 6 * * 1"          # weekly (Mon 06:00 UTC) — matches .github/workflows/runtime-audit.yml
    contexts: [audit]
    cost_ceiling: expensive     # was moderate — audit judgment checks are expensive, so moderate ran zero
```

- [ ] **Step 4: Run the test + the registry/meta validators**

Run: `node --test runtime/engine/test/audit-checks.test.mjs`
Expected: PASS (2 tests).

Run: `node runtime/engine/lib/load-registry.mjs --checks-dir runtime/content/checks`
Expected: `loaded 34 check(s), 0 error(s)` (30 existing + 4 new).

Run: `node --test runtime/engine/test/meta-check.test.mjs runtime/engine/test/content-ring.test.mjs`
Expected: PASS (the 4 new judgment entries each have an existing `eval_scenario` file; `triggers.yaml` stays valid).

- [ ] **Step 5: Commit**

```bash
WT=/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/runtime-check-migration-judgment-tier
git -C "$WT" add runtime/content/checks/audit-*.yaml runtime/eval/scenarios/audit-*.scenario.mjs runtime/content/triggers.yaml runtime/engine/test/audit-checks.test.mjs
git -C "$WT" commit --no-verify -m "feat(runtime): 4 audit-* judgment checks + schedule cost_ceiling fix"
git -C "$WT" log --oneline -1
```

---

### Task 5: CI cadence — GitHub Actions workflow

Fire the dispatcher weekly (+ manual) in CI, upload findings as an artifact.

**Files:**
- Create: `.github/workflows/runtime-audit.yml`
- Test: `runtime/adapters/claude-code/test/workflow-valid.test.mjs` (YAML validity + the fields the cadence relies on)

**Interfaces:** none (declarative workflow).

- [ ] **Step 1: Write the failing test** — `runtime/adapters/claude-code/test/workflow-valid.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

test('runtime-audit workflow is valid and wired to the dispatcher + weekly cadence', () => {
  const wf = parse(readFileSync('.github/workflows/runtime-audit.yml', 'utf8'));
  // NOTE: YAML parses the `on:` key as boolean true — assert on the parsed key.
  const triggers = wf[true] ?? wf.on;
  assert.ok('workflow_dispatch' in triggers, 'manual dispatch');
  assert.ok(Array.isArray(triggers.schedule) && triggers.schedule[0].cron, 'weekly schedule cron');
  const steps = wf.jobs.audit.steps;
  const runsDispatcher = steps.some((s) => (s.run ?? '').includes('run-audit.mjs'));
  assert.ok(runsDispatcher, 'a step runs run-audit.mjs');
  const usesToken = steps.some((s) => JSON.stringify(s.env ?? {}).includes('CLAUDE_CODE_OAUTH_TOKEN'));
  assert.ok(usesToken, 'the dispatcher step passes CLAUDE_CODE_OAUTH_TOKEN');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test runtime/adapters/claude-code/test/workflow-valid.test.mjs`
Expected: FAIL (workflow file missing).

- [ ] **Step 3: Create `.github/workflows/runtime-audit.yml`:**

```yaml
name: runtime-audit
on:
  workflow_dispatch: {}
  schedule:
    - cron: "0 6 * * 1"   # weekly, Monday 06:00 UTC — matches runtime/content/triggers.yaml schedule
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Install Claude Code CLI
        run: npm install -g @anthropic-ai/claude-code
      - name: Run runtime audit (produces findings artifact)
        env:
          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          RUNTIME_AUDIT_MODEL: claude-opus-4-8
        run: node runtime/adapters/claude-code/run-audit.mjs --on=schedule
        continue-on-error: true   # exit 1 = findings surfaced (not a build failure); artifact carries them
      - name: Upload findings
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: audit-findings
          path: runtime/.audit-findings/
          if-no-files-found: ignore
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test runtime/adapters/claude-code/test/workflow-valid.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
WT=/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/runtime-check-migration-judgment-tier
git -C "$WT" add .github/workflows/runtime-audit.yml runtime/adapters/claude-code/test/workflow-valid.test.mjs
git -C "$WT" commit --no-verify -m "ci(runtime): weekly runtime-audit workflow fires the cadence dispatcher"
git -C "$WT" log --oneline -1
```

> **Manual setup (record in the ship's validation_gate, not a code step):** add a repo secret
> `CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token`. Ask the user to run this (interactive) — the
> workflow's automatic runs are inert until the secret exists. `workflow_dispatch` lets the user trigger
> a first run manually to confirm CI auth.

---

### Task 6: Acceptance — live audit run routed through intake (COST-GATED)

The binding's acceptance bar: **≥1 real audit-context execution with findings routed through intake** (demonstrated, not asserted). Run during `executing-plans`, not a unit test. Uses a real `claude -p` → spends Max quota → **gate via AskUserQuestion before running** ([[feedback-e2e-cost-conscious]], [[feedback-costs-in-tokens-not-dollars]]).

**Files:**
- Produces (committed): `docs/backlog/from-audit-service.md` (an intake item with `provenance.from_finding`)

- [ ] **Step 1: Full runtime suite green first**

Run: `pnpm nx test runtime`
Expected: all `node:test` cases pass (existing 172 + the new audit-procedures / run-audit / audit-checks / workflow-valid suites).

- [ ] **Step 2: Cost gate** — AskUserQuestion: confirm spending Max quota on a live `audit-service` run (the cheapest single-skill demo, scoped to one service to bound cost). Surface the repeat count. Do NOT run the full 4-skill sweep for the demo.

- [ ] **Step 3: Run one real audit (single skill, `--only`)**

Run: `node runtime/adapters/claude-code/run-audit.mjs --on=manual --only=audit-service`
Expected: JSON to stdout with `count >= 0` and a `runtime/.audit-findings/audit-manual-local.json` artifact. If `count == 0` (no drift found), pick a service known to have card drift, or use `audit-e2e-test`, to obtain ≥1 finding for the intake demonstration. Capture one finding object into a temp file `f.json` (e.g. `runtime/.audit-findings/f.json`).

> `--on=manual` (contexts `[gate,audit,invariant]`, `cost_ceiling: expensive`) + `--only=audit-service`
> runs exactly the one audit check — the cheapest path to a real finding.

- [ ] **Step 4: Route the finding through intake (park → fulfil)**

Run: `node runtime/adapters/claude-code/run-intake.mjs --finding runtime/.audit-findings/f.json`
Expected: exit 3, prints a parked route-classification decision + its `key`.

Then answer it (choose the route per the backlog-add epic-aware router — likely `orphan` or `join-theme`):

Run: `node runtime/adapters/claude-code/run-intake.mjs --finding runtime/.audit-findings/f.json --fulfil <key> --value '{"route":"orphan","rationale":"<why>"}'`
Expected: exit 0, `written: ["docs/backlog/from-audit-service.md"]`.

- [ ] **Step 5: Verify the intake item carries the forward-edge trace**

Run: `grep -A2 provenance docs/backlog/from-audit-service.md`
Expected: `from_finding` + `from_check: audit-service` present.

- [ ] **Step 6: Commit the demonstration**

```bash
WT=/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/runtime-check-migration-judgment-tier
git -C "$WT" add docs/backlog/from-audit-service.md
git -C "$WT" commit --no-verify -m "feat(runtime): demonstrate live audit → findings → intake (acceptance)"
git -C "$WT" log --oneline -1
```

> The committed `docs/backlog/from-audit-service.md` + the stdout `count` + the artifact path are the
> concrete `validation_gate` evidence for the ship (Step 6.5 of backlog-next).

---

## Self-Review

**1. Spec coverage:**
- Live judge binding (Seam A) → Task 2. ✓
- Cadence dispatcher (Seam B) → Task 3. ✓
- Intake routing (Seam C) → Task 6. ✓
- `triggers.yaml` cost-ceiling fix → Task 4. ✓
- 4 audit judgment checks + stub scenarios → Task 4. ✓
- CI workflow → Task 5. ✓
- O1 (read-only allowedTools) → Task 1. ✓
- O2 (module boundary) → resolved in planning (sanctioned by `import-boundary.test.mjs` scope + GUIDE §6); no task needed. ✓
- ≥1 real execution through intake (acceptance) → Task 6. ✓
- Deferred (3 governance gaps, real calibration, auto-intake-in-CI) → filed at ship via `backlog-add`, not implemented here. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". The `<what is inconsistent>` tokens live only inside the audit *prompt string* (runtime instructions to the LLM) and the demo's `<key>`/`<why>` are runtime-resolved values, not plan gaps. ✓

**3. Type consistency:** `makeAuditProcedures` / `buildAuditPrompt` / `runAudit` signatures match between the interface blocks, the implementations, and the tests. Finding shape `{detail, evidence?, scope}` is consistent across Seam A output, `toFindings`, and the intake input. `runScenario(scenario, ref, opts)` call shape matches `benchmark-backlog/runner.mjs`. ✓
