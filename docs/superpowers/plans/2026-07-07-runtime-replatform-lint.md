# Runtime-replatform-lint (WS-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-platform the `backlog-lint` skill onto the runtime check-registry by (a) wiring the `RUNTIME_ENGINE` flag so `preflight`/`postflight` validate the backlog store via the runtime watch gate instead of legacy `lint.mjs`, and (b) closing the parity-oracle lint-differential gap (r4/r5/r6/r8) so every mapped backlog rule is graded green.

**Architecture:** The 13 backlog rules are **already** migrated as `module:` checks in `runtime/content/checks/backlog-*.yaml` (P4 check-migration) — including rule-3, whose anchor evaluator is complete (verified `both-catch`). This member adds **no new check logic**. A small skill adapter (`backlog-next/backlog-gate.mjs`) selects the validation command from the flag: on → `run-watch --on=commit --changed='docs/backlog/*.md'` (the 13 backlog checks + true invariants, backlog-scoped; the `commit` trigger excludes audit judge checks and the backlog scope excludes gate-only non-backlog checks like `typed-subjects`); off → legacy `lint.mjs` (retained byte-for-byte). The oracle work is mechanical: seed the four already-migrated content checks into the differential sandbox and flip their `RULE_MAP` rows to `mapped:true`.

**Tech Stack:** Node.js ESM, `node:test`, `node:child_process`. No new dependencies. The runtime engine (`run-watch.mjs`, `path-provenance.mjs`), the check registry, and the parity-oracle harness all already exist.

## Global Constraints

- **Worktree commits:** this runs in the worktree `.claude/worktrees/runtime-replatform-lint` (branch `worktree-runtime-replatform-lint`). Commit with `git commit --no-verify` (the pre-commit hook rejects worktree code commits) and verify each commit landed with `git log --oneline -1`. See [[feedback-worktree-commit-no-verify]].
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Flag reads:** `RUNTIME_ENGINE` is read ONLY via `usesRuntimeEngine(process.env)` (`runtime/engine/lib/path-provenance.mjs:13`) — never a bespoke `process.env.RUNTIME_ENGINE` check.
- **Legacy retained (no-cleanup-during-migration):** `lint.mjs` and its `lib/rules.mjs` / `index-render.mjs` stay **byte-for-byte** intact behind the flag-off branch. Deleting legacy rule bodies is P6, user-triggered — out of scope.
- **Side-car untouched:** `renderIndex` / `syncDossiers` (the `--fix` index+dossier regen) stay a skill/adapter side-car; the runtime gate only ever runs the read-side checks. Do not route them through the runtime.
- **Gate entrypoint (decision D3, user-confirmed):** the flag-on gate is `run-watch --on=commit --changed='docs/backlog/*.md'`. NOT `--on=manual` (measured: it pulls in 5 audit `skill:` checks that fail-closed without an LLM judge, and surfaces the pre-existing `typed-subjects` drift). The single-quotes around the glob are load-bearing — they stop the shell from expanding it before `run-watch` (which does its own glob-overlap match) sees it.
- **No new checks / no rule-3 work:** rule-3 (`backlog-references-valid`) is already a complete `module:` check (verified `both-catch`). Do NOT author a rule-3 evaluator — the spec §8 premise is stale.
- **r9/r10 stay transitive:** leave `r9-epic-closure` / `r10-epic-pointer` as `mapped:false` (already `both-catch` transitively via `index-fresh`, a deliberately-documented design). They are not part of the `legacy-only` gap; do not seed dedicated checks for them here.
- **Test harness:** `node --test <file>`. Skill tests live under `.claude/skills/<skill>/test/`; oracle tests under `scripts/parity-oracle/test/`.

## Design decisions & open point (confirm at review)

- **D1 (routing):** TDD plan now → user reviews before execution. **D2→D3 (gate entrypoint):** `run-watch --on=commit --changed='docs/backlog/*.md'`. Both in the workstream's `## Decision log`.
- **Open point — `path:runtime` journaling (my recommendation: DO NOT journal in the lint gate).** The strangler spec §4 says every runtime-path *run* journals `path:runtime` keyed to the workstream. That clause is about the workstream **drivers** (`run-intake` / `run-item` / WS-3's `runWorker`), which own a journal + runId + workstream id. `backlog-lint` is a **validation gate**, invoked many times per workstream by `preflight`/`postflight`, which carry no journal/runId/workstream context (preflight often has no `--id` at all). Journaling per-lint-invocation would be redundant noise, and the soak-observer counts distinct **driver** `path:runtime` records, not gate runs. So this plan keeps the gate a pure command-selector with **no** journaling. If you want the lint gate to contribute its own provenance record, say so at review and I'll add a task. This is the one design choice I'm flagging rather than locking.

---

### Task 1: `backlog-gate.mjs` — the flag-branch command selector

**Files:**
- Create: `.claude/skills/backlog-next/backlog-gate.mjs`
- Test: `.claude/skills/backlog-next/test/backlog-gate.test.mjs`

**Interfaces:**
- Consumes: `usesRuntimeEngine(env)` from `runtime/engine/lib/path-provenance.mjs`.
- Produces: `backlogGate(env) -> { cmd: string, rule: string, label: string }` — the shell command `preflight`/`postflight` run to validate the backlog store, plus the failure `rule` id and human `label` for the report.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/backlog-next/test/backlog-gate.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backlogGate } from '../backlog-gate.mjs';

test('flag off → legacy backlog-lint command', () => {
  const g = backlogGate({});
  assert.match(g.cmd, /\.claude\/skills\/backlog-lint\/lint\.mjs/);
  assert.doesNotMatch(g.cmd, /run-watch/);
  assert.equal(g.rule, 'backlog-lint');
});

test('flag on → runtime backlog-scoped watch gate (commit trigger, backlog scope)', () => {
  const g = backlogGate({ RUNTIME_ENGINE: '1' });
  assert.match(g.cmd, /run-watch\.mjs --on=commit/);
  assert.match(g.cmd, /--changed='docs\/backlog\/\*\.md'/);   // quoted glob is load-bearing
  assert.equal(g.rule, 'backlog-gate');
});

test('label is present on both branches (used in the failure report)', () => {
  assert.ok(backlogGate({}).label.length > 0);
  assert.ok(backlogGate({ RUNTIME_ENGINE: '1' }).label.length > 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/backlog-next/test/backlog-gate.test.mjs`
Expected: FAIL — `Cannot find module '../backlog-gate.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `.claude/skills/backlog-next/backlog-gate.mjs`:

```js
// .claude/skills/backlog-next/backlog-gate.mjs — the RUNTIME_ENGINE strangler branch for the backlog
// validation gate (WS-2, spec §8 / §4). preflight + postflight import this so the flag decision lives in
// ONE place. Flag off → legacy backlog-lint (backlog-only, all 11 rules), retained byte-for-byte until P6.
// Flag on → the runtime watch gate scoped to the backlog store: `run-watch --on=commit --changed=docs/backlog/*.md`
// runs the 13 migrated backlog checks (they are invariants → always ride) plus the repo's true invariants.
// The `commit` trigger excludes the `audit` context (so no skill: judge checks fire), and the backlog
// `--changed` scope excludes gate-only non-backlog checks (e.g. typed-subjects, contexts:[gate]). Verified
// clean against the real registry (decision D3). The single-quotes around the glob stop the shell from
// expanding it before run-watch's own glob-overlap match runs.
import { usesRuntimeEngine } from '../../../runtime/engine/lib/path-provenance.mjs';

export function backlogGate(env) {
  if (usesRuntimeEngine(env)) {
    return {
      cmd: "node runtime/engine/lib/run-watch.mjs --on=commit --changed='docs/backlog/*.md'",
      rule: 'backlog-gate',
      label: 'runtime backlog gate (run-watch --on=commit, backlog-scoped)',
    };
  }
  return {
    cmd: 'node .claude/skills/backlog-lint/lint.mjs',
    rule: 'backlog-lint',
    label: 'backlog-lint',
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/backlog-next/test/backlog-gate.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-next/backlog-gate.mjs .claude/skills/backlog-next/test/backlog-gate.test.mjs
git commit --no-verify -m "$(cat <<'EOF'
feat(backlog-next): backlog-gate flag-branch command selector (WS-2)

RUNTIME_ENGINE off → legacy backlog-lint; on → runtime watch gate scoped to
the backlog store (run-watch --on=commit --changed=docs/backlog/*.md). One
place owns the flag decision; preflight/postflight consume it next.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
git log --oneline -1
```

---

### Task 2: Wire `backlogGate` into `preflight.mjs` + `postflight.mjs`

**Files:**
- Modify: `.claude/skills/backlog-next/preflight.mjs` (import; replace the check-3 lint block at lines 108-121; success-message strings at lines 183 + 185)
- Modify: `.claude/skills/backlog-next/postflight.mjs` (import; replace the check-2 lint block at lines 199-208; success-message string at line 362)
- Test: `.claude/skills/backlog-next/test/gate-wiring.test.mjs` (regression: both gates import + call `backlogGate`)

**Interfaces:**
- Consumes: `backlogGate` from Task 1. Both files already have a `shSafe(cmd) -> {ok, out, err}` helper (`preflight.mjs:60-63`, `postflight.mjs:121-124`) over `execSync` with `cwd: REPO_ROOT`.
- Produces: no new exports — the two gates now branch on the flag.

- [ ] **Step 1: Write the failing regression test**

Create `.claude/skills/backlog-next/test/gate-wiring.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(HERE, '..', f), 'utf8');

for (const file of ['preflight.mjs', 'postflight.mjs']) {
  test(`${file} routes backlog validation through backlogGate (flag-branch, not a hardcoded lint.mjs call)`, () => {
    const src = read(file);
    assert.match(src, /import \{ backlogGate \} from '\.\/backlog-gate\.mjs'/, `${file}: missing backlogGate import`);
    assert.match(src, /backlogGate\(process\.env\)/, `${file}: does not call backlogGate(process.env)`);
    // the old unconditional lint.mjs shell-out must be gone (the flag branch owns it now)
    assert.doesNotMatch(src, /shSafe\(`node "\$\{lintPath\}"`\)/, `${file}: still has the hardcoded lint.mjs call`);
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/backlog-next/test/gate-wiring.test.mjs`
Expected: FAIL — both files still hardcode `shSafe(\`node "${lintPath}"\`)` and don't import `backlogGate`.

- [ ] **Step 3: Modify `preflight.mjs`**

Add the import after the existing imports (after line 30, `import { fileURLToPath } from 'node:url';`):

```js
import { backlogGate } from './backlog-gate.mjs';
```

Replace the check-3 block (lines 108-121, from `// 3. backlog-lint (always).` through its closing `}`) with:

```js
  // 3. Backlog store validation (always). RUNTIME_ENGINE selects the runtime watch gate vs legacy backlog-lint.
  const gate = backlogGate(process.env);
  const gateRes = shSafe(gate.cmd);
  if (!gateRes.ok) {
    failures.push({
      rule: gate.rule,
      message: `${gate.label} failed. Fix violations before starting a new workstream.`,
      detail: [gateRes.out, gateRes.err].filter(Boolean).join('\n'),
    });
  }
```

Update the two success messages so they are gate-agnostic. Line 183:

```js
    console.log('✓ Preflight passed: tree clean, main = origin/main, backlog checks green, no stale worktrees.');
```

Line 185:

```js
    console.log('✓ Preflight passed (lane=epic-member): worktree tree clean, backlog checks green.');
```

(The `existsSync(lintPath)` guard is intentionally dropped — a missing gate script now surfaces as a loud `!gateRes.ok` failure with the node error in `detail`, which is sufficient.)

- [ ] **Step 4: Modify `postflight.mjs`**

Add the import after line 32 (`import { makeJournal } from '../../../runtime/engine/lib/journal.mjs';`):

```js
import { backlogGate } from './backlog-gate.mjs';
```

Replace the check-2 block (lines 199-208, from `// 2. backlog-lint` through its closing `}`) with:

```js
  // 2. Backlog store validation. RUNTIME_ENGINE selects the runtime watch gate vs legacy backlog-lint.
  const gate = backlogGate(process.env);
  const gateRes = shSafe(gate.cmd);
  if (!gateRes.ok) {
    failures.push({
      rule: gate.rule,
      message: `${gate.label} failed. Fix violations before declaring the workstream done.`,
      detail: [gateRes.out, gateRes.err].filter(Boolean).join('\n'),
    });
  }
```

Update the success message (line 362):

```js
  console.log(`✓ Postflight passed (lane=${lane}): tree clean, backlog checks green${runsComplexChecks(lane) ? ', on main, synced with origin, no stale worktrees' : ''}.`);
```

- [ ] **Step 5: Run the regression test to verify it passes**

Run: `node --test .claude/skills/backlog-next/test/gate-wiring.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit** (before the smoke — see Step 7's tree-clean note)

```bash
git add .claude/skills/backlog-next/preflight.mjs .claude/skills/backlog-next/postflight.mjs .claude/skills/backlog-next/test/gate-wiring.test.mjs
git commit --no-verify -m "$(cat <<'EOF'
feat(backlog-next): preflight/postflight validate via the RUNTIME_ENGINE gate (WS-2)

Both gates now route backlog validation through backlogGate(process.env):
flag on → run-watch --on=commit --changed=docs/backlog/*.md (backlog-scoped
runtime gate); flag off → legacy lint.mjs (byte-for-byte). Success messages
made gate-agnostic. Regression test guards the wiring in both files.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
git log --oneline -1
```

- [ ] **Step 7: Smoke-run the backlog gate, both flag states, ON THE CLEAN (post-commit) TREE**

Run this AFTER the Step 6 commit — `--lane=epic-member` preflight runs a **tree-clean check**, so an uncommitted diff would fail it and mask the gate result. Use `--lane=epic-member` (not `--lane=complex`/no-lane) so preflight runs ONLY tree-clean + the backlog gate and skips the branch-scope checks — we are on the feature branch, not `main`, so a non-epic-member run would fail the unrelated `not-on-main` check.

Run:
```bash
# flag off → legacy lint path (must pass on the clean tree)
node .claude/skills/backlog-next/preflight.mjs --lane=epic-member; echo "preflight legacy exit=$?"
# flag on → runtime backlog gate (must pass — measured clean; this is the D3 path)
RUNTIME_ENGINE=1 node .claude/skills/backlog-next/preflight.mjs --lane=epic-member; echo "preflight runtime exit=$?"
```
Expected: both exit **0** (tree clean + backlog checks green), each printing the epic-member success line with no `backlog-gate` failure. If the flag-on run fails on `backlog-gate` (not on tree-clean), stop and report — the wiring or the gate command is wrong. (epic-member preflight writes no snapshot and stops no daemon, so it leaves the tree clean.)

Note for the executor: postflight's smoke is deferred to the workstream closing phase (it asserts shipped-frontmatter + backward-edge evidence that only exist at ship). The `gate-wiring` regression test + this preflight smoke are the Task-2 gates.

---

### Task 3: Document the runtime path in `backlog-lint/SKILL.md` + grep regression test

**Files:**
- Modify: `.claude/skills/backlog-lint/SKILL.md` (add a "Runtime engine path (`RUNTIME_ENGINE`)" section; leave the legacy rule docs intact)
- Test: `.claude/skills/backlog-lint/test/runtime-flag.test.mjs`

**Interfaces:**
- Consumes: nothing (documentation + a grep gate). Mirrors WS-1's `backlog-add/SKILL.md` toggle-site documentation pattern.
- Produces: the operator-facing description of the flag-on validation path.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/backlog-lint/test/runtime-flag.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const skillMd = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'SKILL.md'), 'utf8');

test('SKILL.md documents the RUNTIME_ENGINE runtime-gate validation path', () => {
  assert.match(skillMd, /RUNTIME_ENGINE/);
  // match the distinctive scope+trigger; avoid the run-watch vs run-watch.mjs prefix ambiguity
  assert.match(skillMd, /--on=commit --changed='docs\/backlog\/\*\.md'/);
});

test('SKILL.md still documents the legacy 11-rule lint (retained until P6)', () => {
  assert.match(skillMd, /11 rules/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/backlog-lint/test/runtime-flag.test.mjs`
Expected: FAIL on the first test — SKILL.md has no `RUNTIME_ENGINE` / `run-watch` text yet. The second test PASSES (the "11 rules" description already exists).

- [ ] **Step 3: Write the documentation**

In `.claude/skills/backlog-lint/SKILL.md`, add this section immediately after the frontmatter's closing `---` and the top-level heading, before the existing rule descriptions (adjust the exact anchor to sit right after the intro paragraph):

```markdown
## Runtime engine path (`RUNTIME_ENGINE`)

When `RUNTIME_ENGINE` is set (read via `usesRuntimeEngine(process.env)` — `runtime/engine/lib/path-provenance.mjs:13`), the `/backlog-next` `preflight`/`postflight` gates validate the backlog store through the **runtime check-registry** instead of this `lint.mjs`:

```
node runtime/engine/lib/run-watch.mjs --on=commit --changed='docs/backlog/*.md'
```

The 11 rules run as their already-migrated `module:` checks (`runtime/content/checks/backlog-*.yaml`, each delegating to this skill's `lib/rules.mjs` as the single source of truth). The `commit` trigger excludes the `audit` context (no LLM judge needed) and the `docs/backlog/*.md` scope keeps gate-only non-backlog checks (e.g. `typed-subjects`) out, so the gate is deterministic and backlog-scoped. The flag decision lives in `.claude/skills/backlog-next/backlog-gate.mjs`.

When `RUNTIME_ENGINE` is unset, `preflight`/`postflight` run this `lint.mjs` (retained byte-for-byte until P6 legacy retirement). The `--fix` index + dossier regen (`renderIndex` / `syncDossiers`) always stays a side-car of this skill — the runtime gate never runs it.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/backlog-lint/test/runtime-flag.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-lint/SKILL.md .claude/skills/backlog-lint/test/runtime-flag.test.mjs
git commit --no-verify -m "$(cat <<'EOF'
docs(backlog-lint): document the RUNTIME_ENGINE runtime-gate validation path (WS-2)

Describes the flag-on preflight/postflight path (run-watch --on=commit,
backlog-scoped) and that the 11 rules run as migrated module: checks, with
the legacy lint.mjs retained byte-for-byte for the flag-off path. Grep
regression test guards both branches.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
git log --oneline -1
```

---

### Task 4: Close the oracle differential gap — seed r4/r5/r6/r8 + flip `RULE_MAP`

**Files:**
- Modify: `scripts/parity-oracle/test/lint-differential.test.mjs` (move r4/r5/r6/r8 from the `legacy-only` group to the `both-catch` group)
- Modify: `scripts/parity-oracle/store-sandbox.mjs:19` (`SEED_CHECKS.content` — add the four checks)
- Modify: `scripts/parity-oracle/lint-differential.mjs:17-20` (`RULE_MAP` — flip r4/r5/r6/r8 to `mapped:true` with their check ids)

**Interfaces:**
- Consumes: the four already-migrated content checks `backlog-active-out-of-scope.yaml`, `backlog-shipped-validation-gate.yaml`, `backlog-queued-ranks.yaml`, `backlog-promotion-trigger-gated.yaml` (exist in `runtime/content/checks/`), and their fixtures `scripts/parity-oracle/fixtures/lint/{r4-active-out-of-scope,r5-shipped-validation-gate,r6-queued-ranks,r8-promotion-trigger}/{good,bad}/` (all present).
- Produces: r4/r5/r6/r8 differential rows classify `both-catch` and are `mapped:true`; the deterministic differential stays green.

- [ ] **Step 1: Update the class-table test to the target state (write the failing test)**

In `scripts/parity-oracle/test/lint-differential.test.mjs`, edit the second test's two loops. Change the `both-catch` loop (line 21) to INCLUDE r4/r5/r6/r8:

```js
  // mapped rules: runtime must catch what legacy catches
  for (const rule of ['r1-id-matches-filename', 'r2-single-active', 'r3-references-valid',
    'r4-active-out-of-scope', 'r5-shipped-validation-gate', 'r6-queued-ranks', 'r8-promotion-trigger',
    'r11-single-active-epic', 'index-matches'])
    assert.equal(byRule[rule].class, 'both-catch', `${rule}: ${JSON.stringify(byRule[rule])}`);
```

Delete the now-obsolete `legacy-only` loop (old lines 23-25, the `// unmapped rules: legacy-only is the HONEST gap` block). Leave the r9/r10 block (still `both-catch` + `mapped:false`), the `element-shape` assertion, and the good-fixture assertion unchanged.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/parity-oracle/test/lint-differential.test.mjs`
Expected: FAIL — r4/r5/r6/r8 are still `legacy-only` (the sandbox does not seed their checks yet), and the RULE_MAP-totality test (line 14) has not yet been given `checks` for them.

- [ ] **Step 3: Seed the four content checks into the differential sandbox**

In `scripts/parity-oracle/store-sandbox.mjs`, replace the `content` line (line 19):

```js
  content: ['item-store-valid.yaml', 'backlog-id-matches-filename.yaml', 'backlog-active-out-of-scope.yaml', 'backlog-shipped-validation-gate.yaml', 'backlog-queued-ranks.yaml', 'backlog-promotion-trigger-gated.yaml'],
```

- [ ] **Step 4: Flip the four `RULE_MAP` rows to mapped with their check ids**

In `scripts/parity-oracle/lint-differential.mjs`, replace the four rows (lines 17-20):

```js
  { rule: 'r4-active-out-of-scope', checks: ['backlog-active-out-of-scope'], mapped: true },
  { rule: 'r5-shipped-validation-gate', checks: ['backlog-shipped-validation-gate'], mapped: true },
  { rule: 'r6-queued-ranks', checks: ['backlog-queued-ranks'], mapped: true },
  { rule: 'r8-promotion-trigger', checks: ['backlog-promotion-trigger-gated'], mapped: true },
```

- [ ] **Step 5: Run the test + the differential to verify green**

Run: `node --test scripts/parity-oracle/test/lint-differential.test.mjs`
Expected: PASS (both tests — r4/r5/r6/r8 now `both-catch` + `mapped:true` with non-empty `checks`; r9/r10 unchanged).

Run: `node scripts/parity-oracle/lint-differential.mjs; echo "exit=$?"`
Expected: every row prints `both-catch` except `element-shape` (`runtime-only`); `exit=0` (no `mapped && legacy-only` rows remain). This matches the verified throwaway measurement.

- [ ] **Step 6: Commit**

```bash
git add scripts/parity-oracle/store-sandbox.mjs scripts/parity-oracle/lint-differential.mjs scripts/parity-oracle/test/lint-differential.test.mjs
git commit --no-verify -m "$(cat <<'EOF'
feat(parity-oracle): map lint rules r4/r5/r6/r8 to their runtime checks (WS-2)

Seed the four already-migrated backlog checks (active-out-of-scope,
shipped-validation-gate, queued-ranks, promotion-trigger-gated) into the
differential sandbox and flip their RULE_MAP rows to mapped:true. They were
legacy-only ONLY because the sandbox never seeded them; the checks + fixtures
already exist. Class table updated: r4/r5/r6/r8 now both-catch. r9/r10 stay
the documented transitive case (mapped:false). Differential green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
git log --oneline -1
```

---

### Task 5: Full-suite verification + true-affected gate

**Files:** none modified — verification only.

**Interfaces:** Consumes all prior tasks.

- [ ] **Step 1: Run the new + touched test files**

Run:
```bash
node --test \
  .claude/skills/backlog-next/test/backlog-gate.test.mjs \
  .claude/skills/backlog-next/test/gate-wiring.test.mjs \
  .claude/skills/backlog-lint/test/runtime-flag.test.mjs \
  scripts/parity-oracle/test/lint-differential.test.mjs
```
Expected: all PASS.

- [ ] **Step 2: Run the full parity-oracle + backlog skill test suites (regression)**

Run:
```bash
node --test scripts/parity-oracle/test/*.test.mjs
node --test .claude/skills/backlog-lint/test/*.test.mjs
node --test .claude/skills/backlog-next/test/*.test.mjs
```
Expected: all PASS. In particular `scripts/parity-oracle/test/mapping.test.mjs` (behavioral scenario mapping — untouched by WS-2, `mapped.length === 11` still holds) and `oracle-teeth.test.mjs` stay green; the lint-differential change is confined to the deterministic table.

- [ ] **Step 3: True-affected nx test + typecheck + lint**

Run:
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
[ -n "$AFFECTED" ] && NX_DAEMON=false pnpm nx run-many -t test,typecheck,lint -p "$AFFECTED" || echo "no affected nx projects"
```
Expected: PASS. (WS-2 touches `.claude/skills/**` and `scripts/parity-oracle/**` — plus no `runtime/` source — so the affected set is small or empty; `runtime` itself is unchanged. If `node_modules` is missing in the worktree, symlink it first: `ln -sfn /Users/fabiovitali/WebstormProjects/nestfolio/node_modules node_modules`.)

- [ ] **Step 4: Confirm no deploy is needed (Tier 0)**

Run: `node .claude/skills/backlog-next/detect-deploy-needed.mjs; echo "exit=$?"`
Expected: exit **10** (skip deploy) — WS-2 changes no CDK/service/infra code. Record this in the workstream's `validation_gate`.

- [ ] **Step 5: Final differential confirmation for the validation gate**

Run: `node scripts/parity-oracle/lint-differential.mjs; echo "exit=$?"`
Expected: `exit=0`, all rows `both-catch` except `element-shape` (`runtime-only`). This is the parity acceptance for WS-2 — **deterministic, no live LLM sweep required** (unlike WS-1, the lint slice has no behavioral scenarios, so there is no cost-gated oracle run). Capture the output in `validation_gate`.

---

## Notes for the executor

- **No mapping.mjs edits.** WS-2 works in the deterministic `lint-differential.mjs` `RULE_MAP`, NOT the behavioral `scripts/parity-oracle/mapping.mjs`. There is no `rt-lint-*` scenario to add. Do not touch `mapping.test.mjs`'s `mapped.length === 11` assertion.
- **Legacy is load-bearing during soak.** Never delete or restructure `lint.mjs` / `lib/rules.mjs` / `lib/index-render.mjs`. The flag-off path and future fallbacks depend on them byte-for-byte.
- **The glob quoting matters.** In `backlog-gate.mjs` the `--changed='docs/backlog/*.md'` single-quotes prevent the shell (execSync runs `/bin/sh -c`) from expanding the glob before `run-watch` receives it. If you drop the quotes the gate silently mis-scopes.
- **r9/r10 are intentionally transitive.** They are already `both-catch` via `index-fresh` and stay `mapped:false` with their explanatory comment. Do not seed `backlog-epic-closure` / `backlog-epic-pointer-integrity` here — that is a separate, clean, optional item.
- **path:runtime journaling is deliberately absent** from the lint gate (see "Design decisions & open point"). If review overturns that, add a task that threads a journal + workstream id into the flag-on branch.
