# Runtime Check Migration — Deterministic Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the remaining §12 *deterministic* enforcement surfaces into `runtime/content/checks/` CheckEntry YAML so each runs on the live commit gate.

**Architecture:** Three proven patterns — `cmd:` checks (mirror `no-ddb-scan.yaml`), a gate-free extracted `service-structure` script, and backlog-lint rules as zero-arg `module:` core-wrappers that *delegate to* `rules.mjs`. Every check is `deterministic`, `cheap`, and rides the existing `commit` trigger; no new engine/judge/dispatcher code.

**Tech Stack:** Node 24 ESM (`.mjs`), `node --test`, bash, zod-validated CheckEntry YAML, the runtime forward-edge engine (`runtime/engine/**`, frozen).

## Global Constraints

- **Delegate, never fork.** Backlog rule logic is imported from `.claude/skills/backlog-lint/lib/rules.mjs` (+ `index-render.mjs` for rule 7) and `frontmatter.mjs` — never re-implemented. A second copy reintroduces the divergence bug `lint-library-total-and-located` fixed.
- **Do not touch the frozen engine/schema.** No edits under `runtime/engine/**`. CheckEntries must conform to `runtime/engine/schema/check.schema.ts` (`.strict()`).
- **`FindingKind ∈ {drift, inconsistency, gap, staleness}`** (`runtime/engine/schema/finding.schema.ts:5`).
- **`RUN_SCHEMES = {cmd, module, eslint, skill}`**; `run: "<scheme>:<target>"`; `module:` target = `<specifier>#<export>`, called **zero-arg**.
- **Runtime finding shape** (what a `module:` export returns): `{ detail: string, scope: string[], evidence?: string }`.
- **Tests:** runtime tests live in `runtime/content/test/*.test.mjs` (run by `pnpm nx run runtime:test`). Cores live in `runtime/content/lib/`.
- **Keep legacy running** — do NOT remove any check from `.git/hooks/pre-commit` / `verify-structure.sh` (P6, out of scope). Double-coverage is intended.
- **Worktree:** all work on branch `worktree-runtime-check-migration-completion`. `$WORKTREE` = `/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/runtime-check-migration-completion` (every command runs from there; edits use worktree-absolute paths). Commits use `--no-verify` (worktree pre-commit hook rejects code commits otherwise) — and verify each commit landed on the branch.
- **Out of scope:** judgment tier (`runtime-check-migration-judgment-tier`), exclusions relocation (`runtime-check-exclusions-content-ring`), CI golden gates (`runtime-check-goldengates-ci`), legacy retirement (P6).

---

### Task 1: Migrate the three `cmd:` checks

**Files:**
- Create: `runtime/content/checks/no-appsync-literals.yaml`
- Create: `runtime/content/checks/typed-fixtures.yaml`
- Create: `runtime/content/checks/typed-subjects.yaml`

**Interfaces:**
- Consumes: the existing tools `tools/check-no-appsync-literals.mjs`, `tools/check-typed-fixtures.mjs`, `tools/check-typed-subjects.mjs` (each: `node …`, exit 0 clean / 1 on violation; accept `--root`). Registry loader `runtime/engine/lib/meta-check.mjs`.
- Produces: three `active` CheckEntries on the `commit` trigger. No exports.

This is a **declarative-config** migration: the "test" is the registry loader (`meta-check.mjs`) staying green (schema-valid + `cmd:` target parseable) and the tool executing. The end-to-end gate demonstration is Task 6.

- [ ] **Step 1: Baseline — registry green, targets absent**

Run: `cd $WORKTREE && node runtime/engine/lib/meta-check.mjs; echo "rc=$?"`
Expected: `rc=0`. Then `ls runtime/content/checks/ | grep -E 'no-appsync-literals|typed-fixtures|typed-subjects'` → no output (not yet migrated).

- [ ] **Step 2: Write `no-appsync-literals.yaml`**

```yaml
id: no-appsync-literals
property: >
  No hardcoded AppSync/AWS endpoint literals (appsync-api, appsync-realtime-api, *.amazonaws.com)
  in apps/** or the shell/frontend-deps/ui libs — charter invariant.
kind: inconsistency
evaluator:
  type: deterministic
  run: cmd:node tools/check-no-appsync-literals.mjs
cost_tier: cheap
contexts: [invariant, gate]
scope:
  paths:
    - "apps/**/*.ts"
    - "libs/shell/**/*.ts"
    - "libs/frontend-deps/**/*.ts"
    - "libs/ui/**/*.ts"
status: active
provenance:
  minted_by: runtime-check-migration-completion
  ratified: "2026-07-06"
```

- [ ] **Step 3: Write `typed-fixtures.yaml`**

```yaml
id: typed-fixtures
property: >
  Test fixtures use typed event builders registered in tools/typed-fixture-registered-events.json —
  no untyped/ad-hoc event fixture literals.
kind: drift
evaluator:
  type: deterministic
  run: cmd:node tools/check-typed-fixtures.mjs
cost_tier: cheap
contexts: [invariant, gate]
scope:
  paths:
    - "services/**/test/**/*.ts"
    - "libs/event-processor/**/*.ts"
status: active
provenance:
  minted_by: runtime-check-migration-completion
  ratified: "2026-07-06"
```

- [ ] **Step 4: Write `typed-subjects.yaml`** (carries `scope.exclusions` — kept at the current `tools/` path; the exclusions item relocates it later)

```yaml
id: typed-subjects
property: >
  Event `subject` strings are built via producer-owned typed subject contracts (parseSubject seam) —
  no ad-hoc subject literals; drift gated against tools/typed-subject-exclusions.json.
kind: drift
evaluator:
  type: deterministic
  run: cmd:node tools/check-typed-subjects.mjs
cost_tier: cheap
contexts: [invariant, gate]
scope:
  paths:
    - "libs/event-processor/**/*.ts"
    - "services/**/src/**/*.ts"
  exclusions: "tools/typed-subject-exclusions.json"
status: active
provenance:
  minted_by: runtime-check-migration-completion
  ratified: "2026-07-06"
```

- [ ] **Step 5: Verify registry loads all three**

Run: `cd $WORKTREE && node runtime/engine/lib/meta-check.mjs; echo "rc=$?"`
Expected: `rc=0`, no dup-id / bad-scheme / missing-module errors. (17 checks now.)

- [ ] **Step 6: Verify each run target executes on the clean tree**

Run: `cd $WORKTREE && node tools/check-no-appsync-literals.mjs; node tools/check-typed-fixtures.mjs; node tools/check-typed-subjects.mjs; echo "rc=$?"`
Expected: each exits `0` (clean worktree), final `rc=0`.

- [ ] **Step 7: Commit**

```bash
git -C $WORKTREE add runtime/content/checks/no-appsync-literals.yaml runtime/content/checks/typed-fixtures.yaml runtime/content/checks/typed-subjects.yaml
git -C $WORKTREE commit --no-verify -m "feat(runtime): migrate 3 cmd: checks (appsync-literals, typed-fixtures, typed-subjects)"
```

---

### Task 2: `backlog-rules-core.mjs` — module + per-file rule exports

**Files:**
- Create: `runtime/content/lib/backlog-rules-core.mjs`
- Test: `runtime/content/test/backlog-rules-core.test.mjs`

**Interfaces:**
- Consumes: `loadBacklogFiles` from `.claude/skills/backlog-lint/lib/frontmatter.mjs`; the rule fns from `.claude/skills/backlog-lint/lib/rules.mjs` (signatures: per-file `(file)`, whole-set `(files)`, `(file, files)`, `(file, repoRoot)`); `ruleIndexMatches(files, indexPath)` from `.claude/skills/backlog-lint/lib/index-render.mjs`. Violation shape from `rules.mjs`: `{ rule, file: string|null, message }`.
- Produces (this task): adapters + these zero-arg exports, each `(dir = 'docs/backlog') => Array<{detail, scope, evidence?}>`:
  `frontmatterParseableViolations`, `activeOutOfScopeViolations` (rule 4), `activeEpicFieldsViolations` (rule 4a), `shippedValidationGateViolations` (rule 5), `promotionTriggerGatedViolations` (rule 8).

Pattern reference: `runtime/content/lib/backlog-id-core.mjs` (maps `{detail: v.message, scope: ['docs/backlog/*.md'], evidence: v.file}`).

- [ ] **Step 1: Write the failing test**

`runtime/content/test/backlog-rules-core.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activeOutOfScopeViolations, shippedValidationGateViolations,
  promotionTriggerGatedViolations, activeEpicFieldsViolations,
  frontmatterParseableViolations,
} from '../lib/backlog-rules-core.mjs';

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'blr-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}
const fm = (o) => `---\n${Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\nbody\n`;

test('rule 4: active item with empty out_of_scope → one finding', () => {
  const dir = fixture({ 'a.md': fm({ id: 'a', status: 'active', type: 'refactor', out_of_scope: '[]' }) });
  const f = activeOutOfScopeViolations(dir);
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /out_of_scope is empty/);
  assert.deepEqual(f[0].scope, ['docs/backlog/*.md']);
  assert.equal(f[0].evidence, 'a.md');
});

test('rule 4: active item with non-empty out_of_scope → clean', () => {
  const dir = fixture({ 'a.md': fm({ id: 'a', status: 'active', type: 'refactor', out_of_scope: '["x"]' }) });
  assert.deepEqual(activeOutOfScopeViolations(dir), []);
});

test('rule 5: shipped item with empty validation_gate → one finding', () => {
  const dir = fixture({ 'a.md': fm({ id: 'a', status: 'shipped', type: 'refactor', validation_gate: 'null' }) });
  assert.equal(shippedValidationGateViolations(dir).length, 1);
});

test('rule 8: queued item with promotion trigger → one finding', () => {
  const body = `---\nid: a\nstatus: queued\ntype: refactor\nrank: 1\n---\n\nPromote once the deploy lands.\n`;
  const dir = fixture({ 'a.md': body });
  assert.equal(promotionTriggerGatedViolations(dir).length, 1);
});

test('precondition: malformed frontmatter → located finding', () => {
  const dir = fixture({ 'bad.md': `---\nid: a\nid: a\n---\n` }); // duplicate key
  const f = frontmatterParseableViolations(dir);
  assert.equal(f.length, 1);
  assert.match(f[0].evidence, /bad\.md/);
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `cd $WORKTREE && node --test runtime/content/test/backlog-rules-core.test.mjs`
Expected: FAIL — `Cannot find module '../lib/backlog-rules-core.mjs'`.

- [ ] **Step 3: Write `backlog-rules-core.mjs` (module + adapters + per-file exports)**

```javascript
// runtime/content/lib/backlog-rules-core.mjs — zero-arg cores wrapping the backlog-lint rules for the
// runtime `module:` seam. DELEGATES to rules.mjs / index-render.mjs (single source of truth) — never forks.
// Each backlog rule is a whole-repo invariant (a violation is wrong regardless of what is staged).
import { execSync } from 'node:child_process';
import { loadBacklogFiles } from '../../../.claude/skills/backlog-lint/lib/frontmatter.mjs';
import {
  ruleFrontmatterParseable, ruleSingleActive, rulePromotionTriggerGated,
  ruleQueuedRanks, ruleActiveOutOfScope, ruleShippedValidationGate,
  ruleReferencesValid, ruleActiveEpicFields, ruleEpicClosure,
  ruleEpicPointerIntegrity, ruleSingleActiveEpic,
} from '../../../.claude/skills/backlog-lint/lib/rules.mjs';
import { ruleIndexMatches } from '../../../.claude/skills/backlog-lint/lib/index-render.mjs';

const DIR = 'docs/backlog';
const INDEX = 'docs/BACKLOG.md';
const repoRoot = () => execSync('git rev-parse --show-toplevel').toString().trim();

// map backlog-lint violations ({rule,file,message}) → runtime findings ({detail,scope,evidence?})
const toFindings = (violations, scope = ['docs/backlog/*.md']) =>
  violations.map((v) => (v.file ? { detail: v.message, scope, evidence: v.file }
                                : { detail: v.message, scope }));

// arity adapters — all return zero-arg (dir-defaulted) cores the runtime can call with no args
const perFile        = (rule) => (dir = DIR) => toFindings(loadBacklogFiles(dir).flatMap(rule));
const wholeSet       = (rule) => (dir = DIR) => toFindings(rule(loadBacklogFiles(dir)));
const perFileWithAll = (rule) => (dir = DIR) => { const fs = loadBacklogFiles(dir); return toFindings(fs.flatMap((f) => rule(f, fs))); };
const perFileWithRoot = (rule) => (dir = DIR, root = repoRoot()) => toFindings(loadBacklogFiles(dir).flatMap((f) => rule(f, root)));

// ── per-file rules (this task) ──
export const frontmatterParseableViolations = perFile(ruleFrontmatterParseable);
export const activeOutOfScopeViolations      = perFile(ruleActiveOutOfScope);       // rule 4
export const activeEpicFieldsViolations      = perFile(ruleActiveEpicFields);       // rule 4a
export const shippedValidationGateViolations = perFile(ruleShippedValidationGate);  // rule 5
export const promotionTriggerGatedViolations = perFile(rulePromotionTriggerGated);  // rule 8
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `cd $WORKTREE && node --test runtime/content/test/backlog-rules-core.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git -C $WORKTREE add runtime/content/lib/backlog-rules-core.mjs runtime/content/test/backlog-rules-core.test.mjs
git -C $WORKTREE commit --no-verify -m "feat(runtime): backlog-rules-core module + per-file rule cores (4, 4a, 5, 8, precondition)"
```

---

### Task 3: `backlog-rules-core.mjs` — whole-set, cross-file, root, and index exports

**Files:**
- Modify: `runtime/content/lib/backlog-rules-core.mjs` (append exports)
- Test: `runtime/content/test/backlog-rules-core.test.mjs` (append tests)

**Interfaces:**
- Consumes: the adapters (`wholeSet`, `perFileWithAll`, `perFileWithRoot`) + `ruleIndexMatches` already imported in Task 2.
- Produces: `singleActiveViolations` (rule 2), `referencesValidViolations` (rule 3), `queuedRanksViolations` (rule 6), `indexMatchesViolations` (rule 7), `epicClosureViolations` (rule 9), `epicPointerIntegrityViolations` (rule 10), `singleActiveEpicViolations` (rule 11) — each `(dir = 'docs/backlog') => Array<{detail, scope, evidence?}>`; rule 3 also accepts `(dir, root)`; rule 7 also accepts `(dir, indexPath)`.

- [ ] **Step 1: Append failing tests**

Append to `runtime/content/test/backlog-rules-core.test.mjs`:

```javascript
import {
  singleActiveViolations, queuedRanksViolations, singleActiveEpicViolations,
  epicClosureViolations, epicPointerIntegrityViolations, indexMatchesViolations,
} from '../lib/backlog-rules-core.mjs';

test('rule 2: two non-epic active items → one finding', () => {
  const dir = fixture({
    'a.md': fm({ id: 'a', status: 'active', type: 'refactor', out_of_scope: '["x"]' }),
    'b.md': fm({ id: 'b', status: 'active', type: 'refactor', out_of_scope: '["x"]' }),
  });
  assert.equal(singleActiveViolations(dir).length, 1);
});

test('rule 6: two queued items with the same rank → one finding', () => {
  const dir = fixture({
    'a.md': fm({ id: 'a', status: 'queued', type: 'refactor', rank: 1 }),
    'b.md': fm({ id: 'b', status: 'queued', type: 'refactor', rank: 1 }),
  });
  assert.equal(queuedRanksViolations(dir).length, 1);
});

test('rule 11: two active epics → one finding', () => {
  const dir = fixture({
    'e1.md': fm({ id: 'e1', status: 'active', type: 'epic', done_when: 'x', scope: 'x', out_of_scope: '["x"]' }),
    'e2.md': fm({ id: 'e2', status: 'active', type: 'epic', done_when: 'x', scope: 'x', out_of_scope: '["x"]' }),
  });
  assert.equal(singleActiveEpicViolations(dir).length, 1);
});

test('rule 10: member pointing at a non-existent epic → one finding', () => {
  const dir = fixture({ 'm.md': fm({ id: 'm', status: 'parking', type: 'refactor', epic: 'ghost' }) });
  assert.equal(epicPointerIntegrityViolations(dir).length, 1);
});

test('rule 9: shipped epic with a non-terminal member → one finding', () => {
  const dir = fixture({
    'e.md': fm({ id: 'e', status: 'shipped', type: 'epic', validation_gate: 'done' }),
    'm.md': fm({ id: 'm', status: 'active', type: 'refactor', epic: 'e', out_of_scope: '["x"]' }),
  });
  assert.equal(epicClosureViolations(dir).length, 1);
});

test('rule 7: index-matches returns findings array (no throw) for a fixture dir', () => {
  const dir = fixture({ 'a.md': fm({ id: 'a', status: 'parking', type: 'refactor' }) });
  const f = indexMatchesViolations(dir, join(dir, 'BACKLOG.md')); // absent index → one finding
  assert.ok(Array.isArray(f));
  assert.equal(f.length, 1);
});
```

Note: rule 3 (`referencesValidViolations`) is exercised in Task 6's live run (it needs real repo paths); here we only assert it exports as a function:

```javascript
import { referencesValidViolations } from '../lib/backlog-rules-core.mjs';
test('rule 3: exported as a function', () => { assert.equal(typeof referencesValidViolations, 'function'); });
```

- [ ] **Step 2: Run — verify new tests fail**

Run: `cd $WORKTREE && node --test runtime/content/test/backlog-rules-core.test.mjs`
Expected: FAIL — new exports are `undefined` (not functions) / import errors.

- [ ] **Step 3: Append the exports to `backlog-rules-core.mjs`**

```javascript
// ── whole-set / cross-file / root / index rules (this task) ──
export const singleActiveViolations         = wholeSet(ruleSingleActive);          // rule 2
export const referencesValidViolations      = perFileWithRoot(ruleReferencesValid); // rule 3
export const queuedRanksViolations           = wholeSet(ruleQueuedRanks);           // rule 6
export const epicClosureViolations           = perFileWithAll(ruleEpicClosure);     // rule 9
export const epicPointerIntegrityViolations  = perFileWithAll(ruleEpicPointerIntegrity); // rule 10
export const singleActiveEpicViolations      = wholeSet(ruleSingleActiveEpic);      // rule 11
export const indexMatchesViolations = (dir = DIR, indexPath = INDEX) =>
  toFindings(ruleIndexMatches(loadBacklogFiles(dir), indexPath), ['docs/BACKLOG.md']);
```

- [ ] **Step 4: Run — verify all pass**

Run: `cd $WORKTREE && node --test runtime/content/test/backlog-rules-core.test.mjs`
Expected: PASS (all tests, Task 2 + Task 3).

- [ ] **Step 5: Commit**

```bash
git -C $WORKTREE add runtime/content/lib/backlog-rules-core.mjs runtime/content/test/backlog-rules-core.test.mjs
git -C $WORKTREE commit --no-verify -m "feat(runtime): backlog-rules-core whole-set/cross-file/index cores (2, 3, 6, 7, 9, 10, 11)"
```

---

### Task 4: Register the twelve backlog-rule CheckEntries

**Files:**
- Create: `runtime/content/checks/backlog-frontmatter-parseable.yaml`, `backlog-single-active.yaml`, `backlog-references-valid.yaml`, `backlog-active-out-of-scope.yaml`, `backlog-active-epic-fields.yaml`, `backlog-shipped-validation-gate.yaml`, `backlog-queued-ranks.yaml`, `backlog-index-matches.yaml`, `backlog-promotion-trigger-gated.yaml`, `backlog-epic-closure.yaml`, `backlog-epic-pointer-integrity.yaml`, `backlog-single-active-epic.yaml`

**Interfaces:**
- Consumes: the exports from Task 2/3 (`module:runtime/content/lib/backlog-rules-core.mjs#<export>`), mirroring `backlog-id-matches-filename.yaml`.
- Produces: 12 `active` CheckEntries on the `commit` trigger.

Each file follows this template (mirror `backlog-id-matches-filename.yaml`), varying only `id`, `property`, `kind`, and the `#export`:

```yaml
id: <id>
property: "<one-line invariant> (backlog-lint rule <N>)."
kind: <inconsistency|gap|staleness>
evaluator:
  type: deterministic
  run: "module:runtime/content/lib/backlog-rules-core.mjs#<export>"
cost_tier: cheap
contexts: [invariant, gate]
scope:
  paths:
    - "docs/backlog/*.md"
status: active
provenance:
  minted_by: runtime-check-migration-completion
  lesson: "docs/superpowers/specs/2026-05-07-backlog-redesign-design.md"
  ratified: "2026-07-06"
```

Exact `id` / `#export` / `kind` per file:

| file | id | #export | kind |
|---|---|---|---|
| backlog-frontmatter-parseable | backlog-frontmatter-parseable | `frontmatterParseableViolations` | inconsistency |
| backlog-single-active | backlog-single-active | `singleActiveViolations` | inconsistency |
| backlog-references-valid | backlog-references-valid | `referencesValidViolations` | staleness |
| backlog-active-out-of-scope | backlog-active-out-of-scope | `activeOutOfScopeViolations` | gap |
| backlog-active-epic-fields | backlog-active-epic-fields | `activeEpicFieldsViolations` | gap |
| backlog-shipped-validation-gate | backlog-shipped-validation-gate | `shippedValidationGateViolations` | gap |
| backlog-queued-ranks | backlog-queued-ranks | `queuedRanksViolations` | inconsistency |
| backlog-index-matches | backlog-index-matches | `indexMatchesViolations` | staleness |
| backlog-promotion-trigger-gated | backlog-promotion-trigger-gated | `promotionTriggerGatedViolations` | inconsistency |
| backlog-epic-closure | backlog-epic-closure | `epicClosureViolations` | inconsistency |
| backlog-epic-pointer-integrity | backlog-epic-pointer-integrity | `epicPointerIntegrityViolations` | inconsistency |
| backlog-single-active-epic | backlog-single-active-epic | `singleActiveEpicViolations` | inconsistency |

(For `backlog-index-matches`, `scope.paths` also includes `"docs/BACKLOG.md"`.)

- [ ] **Step 1: Write all 12 YAML files** per the template + table above (property lines: use each rule's `rules.mjs` comment as the one-liner, e.g. rule 4 → "active item ⇒ out_of_scope non-empty").

- [ ] **Step 2: Verify the registry loads them (module refs resolve)**

Run: `cd $WORKTREE && node runtime/engine/lib/meta-check.mjs; echo "rc=$?"`
Expected: `rc=0`. Every `module:` target resolves (the exports exist from Task 2/3). 29 checks total.

- [ ] **Step 3: Demonstrate one backlog check fires via the engine on a bad fixture**

Run:
```bash
cd $WORKTREE && node -e '
import("./runtime/content/lib/backlog-rules-core.mjs").then(m => {
  const out = m.activeOutOfScopeViolations();  // real docs/backlog — should be clean
  console.log("live active-out-of-scope findings:", out.length);
  process.exit(out.length === 0 ? 0 : 1);
});'
```
Expected: `live active-out-of-scope findings: 0`, exit 0 (the real backlog is clean).

- [ ] **Step 4: Commit**

```bash
git -C $WORKTREE add runtime/content/checks/backlog-*.yaml
git -C $WORKTREE commit --no-verify -m "feat(runtime): register 12 backlog-lint rules as module: CheckEntries"
```

---

### Task 5: `service-structure` — extract a gate-free script + CheckEntry

**Files:**
- Create: `scripts/check-service-structure.sh`
- Modify: `scripts/verify-structure.sh` (replace inline checks #1–#5 with a call to the new script)
- Modify: `.git/hooks/pre-commit` (re-copy from `verify-structure.sh`)
- Create: `runtime/content/checks/service-structure.yaml`
- Test: `runtime/content/test/service-structure-check.test.mjs`

**Interfaces:**
- Consumes: `RUNTIME_STAGED_PATHS` (newline-separated staged∩scope paths, set by the `cmd:` executor) — falls back to `git diff --cached` when unset. Checks resolve relative to cwd.
- Produces: a `service-structure` CheckEntry (`cmd:bash scripts/check-service-structure.sh`, `contexts: [gate]`, `scope: services/**`). `check-service-structure.sh`: exit 0 clean / 1 on any #1–#5 failure. NEVER invokes the runtime gate (no recursion).

- [ ] **Step 1: Write the failing test**

`runtime/content/test/service-structure-check.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts/check-service-structure.sh');

function svc(root, name, { project = true, stack = true, testdir = true } = {}) {
  const dir = join(root, 'services/demo', name);
  mkdirSync(join(dir, 'src'), { recursive: true });
  if (project) writeFileSync(join(dir, 'project.json'), '{}');
  if (stack) writeFileSync(join(dir, 'src/service.stack.ts'), 'export {}');
  if (testdir) mkdirSync(join(dir, 'test'), { recursive: true });
}
const run = (cwd, staged) =>
  spawnSync('bash', [SCRIPT], { cwd, encoding: 'utf8',
    env: { ...process.env, RUNTIME_STAGED_PATHS: staged } });

test('well-formed service → exit 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'svc-'));
  svc(root, 'demo-ctrl');
  const r = run(root, 'services/demo/demo-ctrl/project.json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('missing project.json → exit 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'svc-'));
  svc(root, 'demo-ctrl', { project: false });
  const r = run(root, 'services/demo/demo-ctrl/src/service.stack.ts');
  assert.equal(r.status, 1);
});

test('bad name suffix → exit 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'svc-'));
  svc(root, 'demo-widget');
  const r = run(root, 'services/demo/demo-widget/project.json');
  assert.equal(r.status, 1);
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd $WORKTREE && node --test runtime/content/test/service-structure-check.test.mjs`
Expected: FAIL — `scripts/check-service-structure.sh` does not exist.

- [ ] **Step 3: Write `scripts/check-service-structure.sh`** (extract #1–#5 from `verify-structure.sh`; gate-free; honor `RUNTIME_STAGED_PATHS`)

```bash
#!/usr/bin/env bash
set -euo pipefail
# check-service-structure.sh — hard-fail structural invariants (#1-#5) for staged services.
# GATE-FREE: never invokes the runtime gate (avoids recursion when run as a cmd: CheckEntry).
# Service list from RUNTIME_STAGED_PATHS (newline-separated staged∩scope) when set, else git diff --cached.
RED='\033[0;31m'; NC='\033[0m'
ERRORS=0

if [ -n "${RUNTIME_STAGED_PATHS:-}" ]; then
  CHANGED_SERVICES=$(printf '%s\n' "$RUNTIME_STAGED_PATHS" | grep '^services/' | cut -d'/' -f1-3 | sort -u || true)
else
  CHANGED_SERVICES=$(git diff --cached --name-only | grep '^services/' | cut -d'/' -f1-3 | sort -u || true)
fi
[ -z "$CHANGED_SERVICES" ] && exit 0

for SERVICE_PATH in $CHANGED_SERVICES; do
  [ -d "$SERVICE_PATH" ] || continue
  SERVICE_NAME=$(basename "$SERVICE_PATH")
  [ -f "$SERVICE_PATH/project.json" ]        || { echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Missing project.json"; ERRORS=$((ERRORS+1)); }
  [ -f "$SERVICE_PATH/src/service.stack.ts" ] || { echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Missing src/service.stack.ts"; ERRORS=$((ERRORS+1)); }
  [ -d "$SERVICE_PATH/test" ]                 || { echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Missing test/ directory"; ERRORS=$((ERRORS+1)); }
  if grep -rq "from.*['\"]services/" "$SERVICE_PATH/src/" 2>/dev/null; then
    echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Import boundary violation: imports from services/"; ERRORS=$((ERRORS+1))
  fi
  echo "$SERVICE_NAME" | grep -qE -- '-(ctrl|bff|hub|adpt|web)$' || { echo -e "${RED}FAIL${NC} [$SERVICE_NAME] Name must end with -ctrl, -bff, -hub, -adpt, or -web"; ERRORS=$((ERRORS+1)); }
done
[ "$ERRORS" -gt 0 ] && exit 1 || exit 0
```

- [ ] **Step 4: Run — verify the test passes**

Run: `cd $WORKTREE && chmod +x scripts/check-service-structure.sh && node --test runtime/content/test/service-structure-check.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `verify-structure.sh` to call the extracted script (keep everything else)**

Replace the per-service loop **checks #1–#5** (`verify-structure.sh:39-68` — the project.json / service.stack.ts / test / import-boundary / name-suffix blocks) with a single call, keeping the loop's #6 WARN in place. The minimal change: after the `CHANGED_SERVICES` computation (line 22) and before the loop, insert:

```bash
# Hard-fail structural invariants #1-#5 (extracted, shared with the runtime service-structure check)
if ! RUNTIME_STAGED_PATHS="$(git diff --cached --name-only)" bash scripts/check-service-structure.sh; then
  ERRORS=$((ERRORS + 1))
fi
```

and delete the #1–#5 `if` blocks inside the `for` loop (lines 39-68), leaving **only** the #6 CLAUDE.md WARN block (lines 70-74) in the loop. Leave #7 (nx blast-radius), #8, #9, #10 unchanged.

- [ ] **Step 6: Re-copy the git hook + smoke-test the legacy path**

```bash
cp scripts/verify-structure.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
bash scripts/verify-structure.sh; echo "rc=$?"   # clean worktree, no staged services → rc=0
```
Expected: `rc=0`.

- [ ] **Step 7: Write `service-structure.yaml`**

```yaml
id: service-structure
property: >
  Each staged service has project.json, src/service.stack.ts, a test/ dir, no absolute services/
  imports, and a -ctrl/-bff/-hub/-adpt/-web name suffix (verify-structure #1-5).
kind: inconsistency
evaluator:
  type: deterministic
  run: cmd:bash scripts/check-service-structure.sh
cost_tier: cheap
contexts: [gate]
scope:
  paths:
    - "services/**"
status: active
provenance:
  minted_by: runtime-check-migration-completion
  ratified: "2026-07-06"
```

- [ ] **Step 8: Verify registry + commit**

Run: `cd $WORKTREE && node runtime/engine/lib/meta-check.mjs; echo "rc=$?"` → `rc=0` (30 checks).

```bash
git -C $WORKTREE add scripts/check-service-structure.sh scripts/verify-structure.sh runtime/content/checks/service-structure.yaml runtime/content/test/service-structure-check.test.mjs
git -C $WORKTREE commit --no-verify -m "feat(runtime): service-structure check — extract gate-free #1-5 script + CheckEntry"
# NOTE: .git/hooks/pre-commit is not version-controlled; re-copy is a local install step (Step 6), not committed.
```

---

### Task 6: End-to-end gate demonstration + full validation

**Files:** none (verification only; capture evidence for `validation_gate`).

**Interfaces:** Consumes the full enlarged registry + the commit gate (`runtime/adapters/git/pre-commit-gate.mjs`).

- [ ] **Step 1: Registry integrity + runtime unit suites**

Run: `cd $WORKTREE && node runtime/engine/lib/meta-check.mjs && node --test runtime/content/test/*.test.mjs`
Expected: meta-check `rc=0`; all runtime content tests PASS.

- [ ] **Step 2: Demonstrate the gate BLOCKS a backlog violation (module: check fires on commit)**

```bash
cd $WORKTREE
cp docs/backlog/runtime-check-migration-completion.md /tmp/blr-restore.md
# Inject a rule-4 violation: blank out_of_scope on an active item
node -e 'const f="docs/backlog/runtime-check-migration-completion.md";const s=require("fs").readFileSync(f,"utf8").replace(/out_of_scope:\n(  - .*\n)+/,"out_of_scope: []\n");require("fs").writeFileSync(f,s)'
git add docs/backlog/runtime-check-migration-completion.md
node runtime/adapters/git/pre-commit-gate.mjs; echo "gate rc=$?"
# restore
cp /tmp/blr-restore.md docs/backlog/runtime-check-migration-completion.md && git add docs/backlog/runtime-check-migration-completion.md
```
Expected: `gate rc=1`, output naming `backlog-active-out-of-scope` (the migrated rule 4 fired via the commit gate). Capture this line as `validation_gate` evidence.

- [ ] **Step 3: Demonstrate the gate PASSES on the clean (restored) tree**

Run: `cd $WORKTREE && node runtime/adapters/git/pre-commit-gate.mjs; echo "gate rc=$?"`
Expected: `gate rc=0`.

- [ ] **Step 4: True-affected test + lint**

Run:
```bash
cd $WORKTREE
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
[ -n "$AFFECTED" ] && NX_DAEMON=false pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"
```
Expected: exit 0 (runtime + any affected projects green).

- [ ] **Step 5: Record evidence** — copy the Step 2/3 gate lines, the meta-check count, and the Step 4 result into the workstream file's `validation_gate` during the closing phase (handled by `/backlog-next` Step 6.5, not committed here).

---

## Self-Review

**Spec coverage:** 3 cmd: checks → Task 1. Backlog rules (precondition, 2–11 incl. 3/7) → Tasks 2–4. service-structure #1–#5 gate-free extraction → Task 5. Commit-cadence "demonstrated not asserted" → Task 6. Splits (judgment/exclusions) are out of scope (filed). All spec §3 in-scope items covered.

**Placeholder scan:** every code/YAML/test step shows full content; commands have expected output. Rule-3 live behavior is exercised in Task 6 (needs real repo paths) with a function-export assertion in Task 3 — intentional, not a gap.

**Type consistency:** export names are identical across Task 2/3 definitions and the Task 4 `#export` table (`activeOutOfScopeViolations`, `singleActiveEpicViolations`, etc.). Finding shape `{detail, scope, evidence?}` matches `resolve-evaluator.mjs` `toFindings` and `backlog-id-core.mjs`. Table row for `backlog-single-active-epic` binds `singleActiveEpicViolations` (corrected).
