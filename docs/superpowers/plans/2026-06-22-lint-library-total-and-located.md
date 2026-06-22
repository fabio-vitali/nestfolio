# Backlog-lint total + located, unified parsers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `backlog-lint` never crash on any frontmatter a backlog skill can legally write, locate malformed files by name, and unify `epic-members.mjs` onto the one canonical frontmatter parser.

**Architecture:** `loadBacklogFiles` becomes the single total parse boundary (per-file try/catch → `parseError` field). A new located `frontmatter-parseable` gate reports the bad file. `renderIndex` is made total with a `str()` coercion helper so a non-string scalar can't crash the `--fix` write. `epic-members.mjs` drops its hand-rolled regex parser and reads through the canonical `loadBacklogFiles`, so its roster resolution is byte-identical to the lint gate.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, the `yaml` package (already a bundle dep).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-lint-library-total-and-located-design.md`. Every task implements part of it.
- All files are `.mjs` ESM under `.claude/skills/`. Match the existing 2-space-indent, single-quote, no-semicolon-omission style of the surrounding files.
- Tests live in each skill's `test/` dir (`backlog-lint/test/`, `backlog-next-epic/test/`). Run an explicit test file with `node --test <path>` — the bare-directory form is a separate Node-24 bug owned by `backlog-skills-misc-polish`; always pass explicit file paths.
- Commits in this worktree use `git commit --no-verify` (the pre-commit hook silently rejects code commits in a worktree). Verify each commit landed with `git log --oneline -1`.
- Do NOT renumber the canonical "11 rules" (CLAUDE.md). The new parse check is a structural precondition gate, not a 12th numbered rule; the `✓ … all 11 rules pass` success line stays.
- Keep the new render/parser tests hermetic (in-memory records or `mkdtemp` fixtures, no reliance on repo git state for assertions). The pre-existing non-hermetic git shell-out in render tests (F-31) is out of scope.

---

### Task 1: Total `loadBacklogFiles` boundary

**Files:**
- Modify: `.claude/skills/backlog-lint/lib/frontmatter.mjs` (`loadBacklogFiles`)
- Test: `.claude/skills/backlog-lint/test/frontmatter.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: every record from `loadBacklogFiles(dir)` now carries `parseError: string | null`. On a YAML parse failure the record is `{ filename, id, path, frontmatter: null, body: <raw content>, parseError: <first error line> }`. `parseFrontmatter(content)` is unchanged (still throws on malformed YAML).

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/backlog-lint/test/frontmatter.test.mjs`:

```js
test('loadBacklogFiles is total: a duplicate-key file yields parseError, does not throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'backlog-lint-'));
  // duplicate validation_gate: key — the exact crash the ship steps can produce
  writeFileSync(join(dir, 'bad.md'), `---
id: bad
status: shipped
validation_gate: null
validation_gate: "5/5 e2e"
---
body
`);
  writeFileSync(join(dir, 'good.md'), `---
id: good
status: parking
type: bug
notes: ""
---
`);
  const files = loadBacklogFiles(dir);            // must not throw
  const bad = files.find(f => f.id === 'bad');
  const good = files.find(f => f.id === 'good');
  assert.equal(bad.frontmatter, null);
  assert.match(bad.parseError, /unique|duplicate/i);
  assert.equal(good.frontmatter.id, 'good');
  assert.equal(good.parseError, null);
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/backlog-lint/test/frontmatter.test.mjs`
Expected: FAIL — `loadBacklogFiles` throws `YAMLParseError: Map keys must be unique` (the assertion is never reached).

- [ ] **Step 3: Write the minimal implementation**

Replace the `loadBacklogFiles` body in `.claude/skills/backlog-lint/lib/frontmatter.mjs` with:

```js
export function loadBacklogFiles(dir) {
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => {
      const path = join(dir, f);
      const id = f.replace(/\.md$/, '');
      const content = readFileSync(path, 'utf8');
      try {
        const { frontmatter, body } = parseFrontmatter(content);
        return { filename: f, id, path, frontmatter, body, parseError: null };
      } catch (e) {
        return { filename: f, id, path, frontmatter: null, body: content, parseError: e.message.split('\n')[0] };
      }
    });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/backlog-lint/test/frontmatter.test.mjs`
Expected: PASS (all tests in the file, including the two pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-lint/lib/frontmatter.mjs .claude/skills/backlog-lint/test/frontmatter.test.mjs
git commit --no-verify -m "fix(backlog-lint): make loadBacklogFiles total — parse errors become a per-file parseError field"
git log --oneline -1
```

---

### Task 2: Located `frontmatter-parseable` gate

**Files:**
- Modify: `.claude/skills/backlog-lint/lib/rules.mjs` (add `ruleFrontmatterParseable`)
- Modify: `.claude/skills/backlog-lint/lint.mjs` (import + wire into the per-file loop)
- Test: `.claude/skills/backlog-lint/test/rules.test.mjs`

**Interfaces:**
- Consumes: the `parseError` field produced by Task 1.
- Produces: `ruleFrontmatterParseable(file) -> violation[]`. Emits one `{ rule: 'frontmatter-parseable', file: <filename>, message }` when `file.parseError` is truthy, naming the file; `[]` otherwise.

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/backlog-lint/test/rules.test.mjs` (and add `ruleFrontmatterParseable` to the imports from `../lib/rules.mjs` at the top):

```js
test('frontmatter-parseable: located violation naming the file when parseError set', () => {
  const f = { id: 'bad', filename: 'bad.md', path: '/dummy/bad.md',
              frontmatter: null, body: '', parseError: 'Map keys must be unique' };
  const violations = ruleFrontmatterParseable(f);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'frontmatter-parseable');
  assert.equal(violations[0].file, 'bad.md');
  assert.match(violations[0].message, /bad\.md.*malformed YAML/i);
});

test('frontmatter-parseable: no violation for a cleanly parsed file', () => {
  assert.deepEqual(ruleFrontmatterParseable(file('ok')), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/backlog-lint/test/rules.test.mjs`
Expected: FAIL — `ruleFrontmatterParseable is not a function` (not exported yet).

- [ ] **Step 3: Write the minimal implementation**

In `.claude/skills/backlog-lint/lib/rules.mjs`, add (near `ruleIdMatchesFilename`):

```js
// Structural precondition gate (NOT a numbered rule): a file whose YAML frontmatter
// could not be parsed is reported located-by-filename, so a malformed file never
// crashes the run unlocated. Relies on loadBacklogFiles' total parseError field.
export function ruleFrontmatterParseable(file) {
  if (file.parseError) {
    return [v('frontmatter-parseable', file,
      `${file.filename}: malformed YAML frontmatter — ${file.parseError}`)];
  }
  return [];
}
```

In `.claude/skills/backlog-lint/lint.mjs`, add `ruleFrontmatterParseable` to the import from `./lib/rules.mjs`, and add it as the FIRST check inside the per-file loop (before `ruleIdMatchesFilename`):

```js
  for (const f of files) {
    violations.push(...ruleFrontmatterParseable(f));
    violations.push(...ruleIdMatchesFilename(f));
    // ...existing rules unchanged...
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/backlog-lint/test/rules.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-lint/lib/rules.mjs .claude/skills/backlog-lint/lint.mjs .claude/skills/backlog-lint/test/rules.test.mjs
git commit --no-verify -m "feat(backlog-lint): located frontmatter-parseable gate names the malformed file"
git log --oneline -1
```

---

### Task 3: Total render via `str()`

**Files:**
- Modify: `.claude/skills/backlog-lint/lib/index-render.mjs` (`str` helper, `lineFor`, `renderEpicBlock`)
- Test: `.claude/skills/backlog-lint/test/index-render.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `renderIndex(files)` never throws on a non-string `notes`/`done_when`/`type`; a `frontmatter: null` record is excluded from every section without throwing.

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/backlog-lint/test/index-render.test.mjs`:

```js
test('renderIndex is total: a non-string notes (YAML list) does not crash the render', () => {
  const files = [
    file('a', { status: 'active', out_of_scope: ['y'], notes: '' }),
    // notes written as a list — e.g. a backlog-add one-liner starting with "-"
    file('park', { status: 'parking', notes: ['- accidental', '- list'] }),
  ];
  const out = renderIndex(files);                  // must not throw
  assert.match(out, /## LATER/);
  assert.match(out, /\(backlog\/park\.md\)/);
});

test('renderIndex excludes a null-frontmatter (unparseable) record without throwing', () => {
  const files = [
    file('a', { status: 'active', out_of_scope: ['y'], notes: '' }),
    { id: 'broken', filename: 'broken.md', path: '/dummy/broken.md', frontmatter: null, body: '', parseError: 'boom' },
  ];
  const out = renderIndex(files);                  // must not throw
  assert.ok(!out.includes('(backlog/broken.md)'), 'unparseable file must not appear in the index');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/backlog-lint/test/index-render.test.mjs`
Expected: FAIL — the first test throws `TypeError: f.frontmatter.notes?.trim is not a function` inside `lineFor`.

- [ ] **Step 3: Write the minimal implementation**

In `.claude/skills/backlog-lint/lib/index-render.mjs`, add the helper just below `statusRank` (line ~14):

```js
// Total scalar coercion: frontmatter values can be non-string (a list/number written
// by a skill one-liner). Coerce before any string op so render never crashes the --fix write.
const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
```

Replace `lineFor` (lines ~16-21) with:

```js
function lineFor(f) {
  const type = f.frontmatter.type ? `[${str(f.frontmatter.type)}]` : '';
  const notesStr = str(f.frontmatter.notes).trim();
  const notes = notesStr ? ` — ${notesStr}` : '';
  const epicTag = f.frontmatter.epic ? ` \`[epic:${f.frontmatter.epic} · ${epicRole(f)}]\`` : '';
  return `[${f.id}](backlog/${f.id}.md) ${type}${notes}`.trim() + epicTag;
}
```

In `renderEpicBlock`, replace the `notes` line (line ~73) and the `done_when` line (line ~75):

```js
  const notesStr = str(epic.frontmatter?.notes).trim();
  const notes = notesStr ? ` — ${notesStr}` : '';
```
```js
  const dwStr = str(epic.frontmatter?.done_when).trim();
  if (dwStr) lines.push(`done_when: ${dwStr}`);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/backlog-lint/test/index-render.test.mjs`
Expected: PASS (including the pre-existing render tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-lint/lib/index-render.mjs .claude/skills/backlog-lint/test/index-render.test.mjs
git commit --no-verify -m "fix(backlog-lint): total render — str() coerces non-string scalars so --fix never crashes"
git log --oneline -1
```

---

### Task 4: Unify `epic-members.mjs` onto the canonical parser

**Files:**
- Modify: `.claude/skills/backlog-next-epic/epic-members.mjs` (delete local parser, import `loadBacklogFiles`, add `loadRecords`, fix rank coercion)
- Test: `.claude/skills/backlog-next-epic/test/epic-members.test.mjs`

**Interfaces:**
- Consumes: `loadBacklogFiles` from `../backlog-lint/lib/frontmatter.mjs`.
- Produces: `loadRecords(dir) -> { id, fm }[]` (the records `main()` feeds to `coreMembers`/`selectNextMember`, built via the canonical loader). The local `parseFrontmatter` export is removed. `coreMembers` rank coercion treats `null`/missing as `undefined`.

- [ ] **Step 1: Update the test (write the failing test)**

In `.claude/skills/backlog-next-epic/test/epic-members.test.mjs`:

1. Change the import block to drop `parseFrontmatter` and add `loadRecords`, plus the temp-dir helpers:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  coreMembers,
  openMembers,
  isDrainable,
  selectNextMember,
  loadRecords,
} from '../epic-members.mjs';
```

2. DELETE the two `parseFrontmatter` tests (the `'parseFrontmatter reads flat scalar fields…'` and `'parseFrontmatter returns {} when no frontmatter block'` tests) — that export no longer exists.

3. Append this regression test (proves the drift bugs are gone via the canonical loader):

```js
test('loadRecords parses identically to the lint gate: inline comments + rank:null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'epic-members-'));
  // a core member whose status carries an inline comment — must be seen as ACTIVE
  writeFileSync(join(dir, 'm-wip.md'), `---
id: m-wip
epic: E
epic_role: core
status: active # WIP
---
`);
  // a captured member whose role carries an inline comment — must be EXCLUDED from core
  writeFileSync(join(dir, 'm-capt.md'), `---
id: m-capt
epic: E
epic_role: captured # rides along
status: queued
rank: null
---
`);
  const records = loadRecords(dir);
  const core = coreMembers(records, 'E');
  const ids = core.map(m => m.id).sort();
  assert.deepEqual(ids, ['m-wip'], 'captured(#comment) excluded; active(#comment) kept as core');
  assert.equal(core.find(m => m.id === 'm-wip').status, 'active');     // comment stripped
  assert.equal(selectNextMember(core), 'm-wip');                        // active member resumes
  rmSync(dir, { recursive: true });
});

test('coreMembers treats rank:null as undefined (sorts after explicit ranks)', () => {
  const recs = [
    { id: 'nullrank', fm: { epic: 'E', status: 'queued', rank: null, epic_role: 'core' } },
    { id: 'r2', fm: { epic: 'E', status: 'queued', rank: 2, epic_role: 'core' } },
  ];
  assert.equal(selectNextMember(coreMembers(recs, 'E')), 'r2');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/backlog-next-epic/test/epic-members.test.mjs`
Expected: FAIL — `loadRecords` is not exported (and the import would error).

- [ ] **Step 3: Write the implementation**

In `.claude/skills/backlog-next-epic/epic-members.mjs`:

1. Replace the `node:` import block + the local `parseFrontmatter` (current lines ~20-49) with:

```js
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadBacklogFiles } from '../backlog-lint/lib/frontmatter.mjs';

const OPEN_STATUSES = new Set(['active', 'queued', 'parking']);

/** The records main() feeds to the resolver, built via the ONE canonical backlog
 * frontmatter parser (backlog-lint/lib/frontmatter.mjs) — so epic-members resolves
 * rosters byte-identically to the lint gate (no 4th hand-rolled parser to drift).
 * A file the canonical loader cannot parse yields fm:{}, which simply fails the
 * epic filter (the lint gate reports it located). */
export function loadRecords(dir) {
  return loadBacklogFiles(dir).map((f) => ({ id: f.id, fm: f.frontmatter ?? {} }));
}
```

2. In `coreMembers`, change the rank line to treat null/missing alike:

```js
      rank: r.fm.rank != null ? Number(r.fm.rank) : undefined,
```

3. In `main()`, replace the `readdirSync(...).map(... parseFrontmatter ...)` records construction with:

```js
  const records = loadRecords(dir);
```

(Keep the `repoRoot`/`dir` derivation and everything downstream unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/backlog-next-epic/test/epic-members.test.mjs`
Expected: PASS (the regression tests + all pre-existing pure-function tests).

- [ ] **Step 5: Smoke-test the CLI against a real epic + commit**

Run: `node .claude/skills/backlog-next-epic/epic-members.mjs backlog-skills-hardening`
Expected: prints the roster with `lint-library-total-and-located` shown `active` and `next=lint-library-total-and-located` (exit 0) — proving the unified loader drives the real resolver.

```bash
git add .claude/skills/backlog-next-epic/epic-members.mjs .claude/skills/backlog-next-epic/test/epic-members.test.mjs
git commit --no-verify -m "refactor(backlog-next-epic): unify epic-members onto canonical loadBacklogFiles (delete 4th parser)"
git log --oneline -1
```

---

### Task 5: Write-side guard in `backlog-add` (defense-in-depth)

**Files:**
- Modify: `.claude/skills/backlog-add/SKILL.md` (frontmatter-template guidance)

**Interfaces:** none (prose skill).

- [ ] **Step 1: Add the explicit quoting instruction**

In `.claude/skills/backlog-add/SKILL.md`, immediately after the `notes: "<one-line summary…>"` template line (~line 72), add a bullet:

```markdown
> **Always emit `notes:` as a double-quoted scalar** (as templated above) — never a bare value. A bare one-liner that begins with `-` or `:` parses as a YAML list/map. The lint read-side is now total (it locates such a file rather than crashing), but quoting keeps the write correct at the source.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/backlog-add/SKILL.md
git commit --no-verify -m "docs(backlog-add): mandate quoted notes scalar (write-side defense-in-depth)"
git log --oneline -1
```

---

### Task 6: Whole-pipeline verification (done-when proof)

**Files:** none (verification only).

- [ ] **Step 1: Run every affected test suite**

Run:
```bash
node --test \
  .claude/skills/backlog-lint/test/frontmatter.test.mjs \
  .claude/skills/backlog-lint/test/rules.test.mjs \
  .claude/skills/backlog-lint/test/index-render.test.mjs \
  .claude/skills/backlog-next-epic/test/epic-members.test.mjs
```
Expected: all suites PASS, 0 failures.

- [ ] **Step 2: Prove `lint --fix` is total + the index regenerates clean**

Run: `node .claude/skills/backlog-lint/lint.mjs --fix`
Expected: `✓ 340 backlog files; all 11 rules pass (with --fix applied)`, exit 0, no `TypeError`/`YAMLParseError`.

- [ ] **Step 3: Prove location on a deliberately-malformed throwaway file**

Run:
```bash
printf '%s\n' '---' 'id: zzz-scratch-malformed' 'validation_gate: null' 'validation_gate: x' '---' > docs/backlog/zzz-scratch-malformed.md
node .claude/skills/backlog-lint/lint.mjs ; echo "exit=$?"
rm docs/backlog/zzz-scratch-malformed.md
```
Expected: a located `[frontmatter-parseable] zzz-scratch-malformed.md: malformed YAML frontmatter — …` violation, `exit=1`, and NO unlocated raw `YAMLParseError` stack. (The scratch file is removed immediately; do not commit it.)

- [ ] **Step 4: Confirm the working tree is clean**

Run: `git status --short`
Expected: empty (the scratch file removed; no stray index change beyond what was committed).

## Self-Review

**Spec coverage:** §1 total load → Task 1. §2 located gate → Task 2. §3 total render → Task 3. §4 unify epic-members → Task 4. §5 write-side guard → Task 5. §6 regression tests → folded into Tasks 1–4 (one per failure mode) + Task 6 holistic proof. Done-when's three clauses (never throws / located violation / epic-members identical) → Task 6 Steps 2,3 + Task 4. No gaps.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the exact command + expected output.

**Type consistency:** `parseError` field shape is consistent across Task 1 (produces), Task 2 (consumes in `ruleFrontmatterParseable`), and Task 3's null-frontmatter test. `loadRecords(dir) -> {id, fm}[]` defined in Task 4 and used only there. `str()` is module-local to index-render. The `frontmatter-parseable` rule name is identical in rules.mjs, lint.mjs wiring, and the test assertion.
