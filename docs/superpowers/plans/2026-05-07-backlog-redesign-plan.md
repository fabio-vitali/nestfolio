# Backlog Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `docs/BACKLOG.md` into per-item files in `docs/backlog/<id>.md` with an auto-generated thin index, build `backlog-lint` to enforce 7 invariants, and remove the duplicated MEMORY.md sections that pushed it over its 24KB soft cap.

**Architecture:** A new `.claude/skills/backlog-lint/` skill ships a Node ESM script (`lint.mjs`) that reads YAML frontmatter from every `docs/backlog/*.md`, validates 7 rules, and in `--fix` mode regenerates `docs/BACKLOG.md` from frontmatter and `related_workstreams:` in topic dossiers from `topic_memory:` pointers. The existing `backlog-add` skill is rewritten to create per-item files instead of appending to `BACKLOG.md`. CLAUDE.md § "Backlog Discipline" is rewritten to point at the new model. Migration runs in 5 phases as described in the spec.

**Tech Stack:** Node 20+ ESM, `yaml@^2.8.3` (already in repo), `node:test` + `node:assert/strict` for unit tests. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-05-07-backlog-redesign-design.md`

---

## File Structure

**Create:**

- `.claude/skills/backlog-lint/SKILL.md` — skill prose + invocation rules
- `.claude/skills/backlog-lint/lint.mjs` — entry point: arg parsing, orchestration, exit codes
- `.claude/skills/backlog-lint/lib/frontmatter.mjs` — load files + parse YAML frontmatter
- `.claude/skills/backlog-lint/lib/rules.mjs` — 7 validation rules (pure functions over loaded files)
- `.claude/skills/backlog-lint/lib/index-render.mjs` — generates `docs/BACKLOG.md` content from files
- `.claude/skills/backlog-lint/lib/dossier-sync.mjs` — regenerates `related_workstreams:` in topic dossiers
- `.claude/skills/backlog-lint/test/frontmatter.test.mjs`
- `.claude/skills/backlog-lint/test/rules.test.mjs`
- `.claude/skills/backlog-lint/test/index-render.test.mjs`
- `.claude/skills/backlog-lint/test/dossier-sync.test.mjs`
- `.claude/skills/backlog-lint/test/fixtures/` — minimal backlog/dossier files for tests
- `docs/backlog/` directory + ~31 `<id>.md` files (Phases 1 + 2)
- `docs/backlog/backlog-redesign.md` — this very workstream's record (created in Phase 1)

**Modify:**

- `.claude/skills/backlog-add/SKILL.md` — rewritten to create per-item file + run `backlog-lint --fix`
- `CLAUDE.md` — § "Backlog Discipline" rewritten; § "Skill Routing" gains a row for `backlog-lint`
- `docs/BACKLOG.md` — replaced with auto-generated index in Phase 1
- `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md` — sections "Recently Completed Work" (Phase 2) and "Active / Planned Work" (Phase 3) deleted; topic-file index updated
- `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_*.md` — gain `related_workstreams:` frontmatter (Phase 4)

**Note on commits:** in-repo files are committed per phase. MEMORY files are outside the repo and are edited but not committed. Phases 3 + 4 produce no in-repo diff (just MEMORY edits + dossier sync).

---

## Phase 0: Build the lint and update skills

### Task 1: Bootstrap `backlog-lint` skill directory + entry point

**Files:**
- Create: `.claude/skills/backlog-lint/lint.mjs`
- Create: `.claude/skills/backlog-lint/test/.gitkeep`

- [ ] **Step 1: Create skill directory + entry point stub**

```bash
mkdir -p .claude/skills/backlog-lint/lib .claude/skills/backlog-lint/test/fixtures
```

Create `.claude/skills/backlog-lint/lint.mjs`:

```javascript
#!/usr/bin/env node
// Entry point — wired up in later tasks.
console.error('backlog-lint: not yet implemented');
process.exit(2);
```

- [ ] **Step 2: Verify it runs**

```bash
node .claude/skills/backlog-lint/lint.mjs
```

Expected: stderr `backlog-lint: not yet implemented`; exit code 2.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/backlog-lint/lint.mjs .claude/skills/backlog-lint/test/
git commit -m "feat(backlog-lint): bootstrap skill directory + entry stub"
```

---

### Task 2: Frontmatter loader (TDD)

**Files:**
- Create: `.claude/skills/backlog-lint/lib/frontmatter.mjs`
- Create: `.claude/skills/backlog-lint/test/frontmatter.test.mjs`
- Create: `.claude/skills/backlog-lint/test/fixtures/sample-active.md`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/backlog-lint/test/frontmatter.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadBacklogFiles, parseFrontmatter } from '../lib/frontmatter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('parseFrontmatter extracts YAML and body', () => {
  const content = `---
id: foo
status: active
type: spec
notes: ""
---

# Foo

Body text.
`;
  const { frontmatter, body } = parseFrontmatter(content);
  assert.equal(frontmatter.id, 'foo');
  assert.equal(frontmatter.status, 'active');
  assert.match(body, /Body text/);
});

test('parseFrontmatter returns null frontmatter when fence missing', () => {
  const { frontmatter, body } = parseFrontmatter('# Just a heading\n');
  assert.equal(frontmatter, null);
  assert.match(body, /Just a heading/);
});

test('loadBacklogFiles reads all .md files in a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'backlog-lint-'));
  writeFileSync(join(dir, 'item-a.md'), `---
id: item-a
status: queued
type: bug
notes: ""
---
`);
  writeFileSync(join(dir, 'item-b.md'), `---
id: item-b
status: parking
type: refactor
notes: ""
---
`);
  const files = loadBacklogFiles(dir);
  assert.equal(files.length, 2);
  assert.deepEqual(files.map(f => f.id).sort(), ['item-a', 'item-b']);
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test .claude/skills/backlog-lint/test/frontmatter.test.mjs
```

Expected: FAIL with `Cannot find module '../lib/frontmatter.mjs'`.

- [ ] **Step 3: Implement the loader**

Create `.claude/skills/backlog-lint/lib/frontmatter.mjs`:

```javascript
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const FENCE_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseFrontmatter(content) {
  const m = content.match(FENCE_RE);
  if (!m) return { frontmatter: null, body: content };
  return { frontmatter: parseYaml(m[1]), body: m[2] };
}

export function loadBacklogFiles(dir) {
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => {
      const path = join(dir, f);
      const content = readFileSync(path, 'utf8');
      const { frontmatter, body } = parseFrontmatter(content);
      return { filename: f, id: f.replace(/\.md$/, ''), path, frontmatter, body };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test .claude/skills/backlog-lint/test/frontmatter.test.mjs
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-lint/lib/frontmatter.mjs .claude/skills/backlog-lint/test/frontmatter.test.mjs
git commit -m "feat(backlog-lint): frontmatter loader + parser"
```

---

### Task 3: Validation rules 1, 2, 6 (id/active/rank — pure structural rules)

**Files:**
- Create: `.claude/skills/backlog-lint/lib/rules.mjs`
- Create: `.claude/skills/backlog-lint/test/rules.test.mjs`

- [ ] **Step 1: Write failing tests for rules 1, 2, 6**

Create `.claude/skills/backlog-lint/test/rules.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleIdMatchesFilename, ruleSingleActive, ruleQueuedRanks } from '../lib/rules.mjs';

const file = (id, fm = {}) => ({
  id, filename: `${id}.md`, path: `/dummy/${id}.md`,
  frontmatter: { id, status: 'parking', type: 'bug', notes: '', ...fm }, body: '',
});

test('rule 1: id matches filename — pass', () => {
  assert.deepEqual(ruleIdMatchesFilename(file('foo')), []);
});

test('rule 1: id matches filename — fail when frontmatter id differs', () => {
  const f = file('foo'); f.frontmatter.id = 'bar';
  const violations = ruleIdMatchesFilename(f);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /id.*does not match filename/i);
});

test('rule 2: exactly one active — pass with one active', () => {
  const files = [file('a', { status: 'active', out_of_scope: ['x'] }), file('b'), file('c')];
  assert.deepEqual(ruleSingleActive(files), []);
});

test('rule 2: exactly one active — fail with zero', () => {
  const files = [file('a'), file('b')];
  const violations = ruleSingleActive(files);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /no file with status: active/i);
});

test('rule 2: exactly one active — fail with two', () => {
  const files = [
    file('a', { status: 'active', out_of_scope: ['x'] }),
    file('b', { status: 'active', out_of_scope: ['x'] }),
  ];
  const violations = ruleSingleActive(files);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /multiple files with status: active/i);
});

test('rule 6: queued ⇒ rank set + unique', () => {
  const files = [
    file('a', { status: 'queued', rank: 1 }),
    file('b', { status: 'queued', rank: 2 }),
  ];
  assert.deepEqual(ruleQueuedRanks(files), []);
});

test('rule 6: queued ⇒ fail when rank missing', () => {
  const files = [file('a', { status: 'queued' })];
  const violations = ruleQueuedRanks(files);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /missing rank/i);
});

test('rule 6: queued ⇒ fail when ranks duplicate', () => {
  const files = [
    file('a', { status: 'queued', rank: 1 }),
    file('b', { status: 'queued', rank: 1 }),
  ];
  const violations = ruleQueuedRanks(files);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /duplicate rank/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test .claude/skills/backlog-lint/test/rules.test.mjs
```

Expected: FAIL — `Cannot find module '../lib/rules.mjs'`.

- [ ] **Step 3: Implement rules 1, 2, 6**

Create `.claude/skills/backlog-lint/lib/rules.mjs`:

```javascript
const v = (rule, file, message) => ({ rule, file: file?.filename ?? null, message });

export function ruleIdMatchesFilename(file) {
  const expected = file.filename.replace(/\.md$/, '');
  if (file.frontmatter?.id !== expected) {
    return [v('id-matches-filename', file,
      `frontmatter id "${file.frontmatter?.id}" does not match filename "${file.filename}"`)];
  }
  return [];
}

export function ruleSingleActive(files) {
  const active = files.filter(f => f.frontmatter?.status === 'active');
  if (active.length === 0) return [v('single-active', null, 'no file with status: active')];
  if (active.length > 1) {
    const ids = active.map(f => f.id).join(', ');
    return [v('single-active', null, `multiple files with status: active — ${ids}`)];
  }
  return [];
}

export function ruleQueuedRanks(files) {
  const queued = files.filter(f => f.frontmatter?.status === 'queued');
  const violations = [];
  const seenRanks = new Map();
  for (const f of queued) {
    const r = f.frontmatter.rank;
    if (r == null) {
      violations.push(v('queued-rank', f, `${f.id}: queued item missing rank`));
    } else if (seenRanks.has(r)) {
      violations.push(v('queued-rank', f,
        `${f.id}: duplicate rank ${r} (also on ${seenRanks.get(r)})`));
    } else {
      seenRanks.set(r, f.id);
    }
  }
  return violations;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test .claude/skills/backlog-lint/test/rules.test.mjs
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-lint/lib/rules.mjs .claude/skills/backlog-lint/test/rules.test.mjs
git commit -m "feat(backlog-lint): rules 1, 2, 6 — id/active/queued-rank"
```

---

### Task 4: Validation rules 4, 5 (status-coupled requirements)

**Files:**
- Modify: `.claude/skills/backlog-lint/lib/rules.mjs`
- Modify: `.claude/skills/backlog-lint/test/rules.test.mjs`

- [ ] **Step 1: Append failing tests for rules 4 + 5**

Append to `.claude/skills/backlog-lint/test/rules.test.mjs`:

```javascript
import { ruleActiveOutOfScope, ruleShippedValidationGate } from '../lib/rules.mjs';

test('rule 4: active ⇒ out_of_scope non-empty — pass', () => {
  const f = file('a', { status: 'active', out_of_scope: ['something'] });
  assert.deepEqual(ruleActiveOutOfScope(f), []);
});

test('rule 4: active ⇒ out_of_scope non-empty — fail when empty', () => {
  const f = file('a', { status: 'active', out_of_scope: [] });
  const violations = ruleActiveOutOfScope(f);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /out_of_scope.*empty/i);
});

test('rule 4: active ⇒ out_of_scope non-empty — fail when missing', () => {
  const f = file('a', { status: 'active' });
  const violations = ruleActiveOutOfScope(f);
  assert.equal(violations.length, 1);
});

test('rule 5: shipped ⇒ validation_gate non-empty — pass', () => {
  const f = file('a', { status: 'shipped', validation_gate: '5/5 e2e' });
  assert.deepEqual(ruleShippedValidationGate(f), []);
});

test('rule 5: shipped ⇒ validation_gate non-empty — fail when empty', () => {
  const f = file('a', { status: 'shipped', validation_gate: '' });
  const violations = ruleShippedValidationGate(f);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /validation_gate.*empty/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test .claude/skills/backlog-lint/test/rules.test.mjs
```

Expected: 5 new tests fail with `ruleActiveOutOfScope is not a function`.

- [ ] **Step 3: Implement rules 4 + 5**

Append to `.claude/skills/backlog-lint/lib/rules.mjs`:

```javascript
export function ruleActiveOutOfScope(file) {
  if (file.frontmatter?.status !== 'active') return [];
  const oos = file.frontmatter.out_of_scope;
  if (!Array.isArray(oos) || oos.length === 0) {
    return [v('active-out-of-scope', file,
      `${file.id}: active item has empty out_of_scope (rule 4)`)];
  }
  return [];
}

export function ruleShippedValidationGate(file) {
  if (file.frontmatter?.status !== 'shipped') return [];
  const gate = file.frontmatter.validation_gate;
  if (typeof gate !== 'string' || gate.trim() === '') {
    return [v('shipped-validation-gate', file,
      `${file.id}: shipped item has empty validation_gate (rule 5)`)];
  }
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test .claude/skills/backlog-lint/test/rules.test.mjs
```

Expected: 13 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-lint/lib/rules.mjs .claude/skills/backlog-lint/test/rules.test.mjs
git commit -m "feat(backlog-lint): rules 4, 5 — active/shipped status invariants"
```

---

### Task 5: Validation rule 3 (references existence + anchor grep)

**Files:**
- Modify: `.claude/skills/backlog-lint/lib/rules.mjs`
- Modify: `.claude/skills/backlog-lint/test/rules.test.mjs`
- Create: `.claude/skills/backlog-lint/test/fixtures/sample-target.md`

- [ ] **Step 1: Create fixture target file for anchor checks**

```bash
cat > .claude/skills/backlog-lint/test/fixtures/sample-target.md <<'EOF'
# Sample Target

## 7.2 Portfolio Construction

Body.

## 8.1 Decision Lifecycle

Body.
EOF
```

- [ ] **Step 2: Append failing tests for rule 3**

Append to `.claude/skills/backlog-lint/test/rules.test.mjs`:

```javascript
import { ruleReferencesValid } from '../lib/rules.mjs';
import { fileURLToPath } from 'node:url';

const fixturesDir = dirname(fileURLToPath(import.meta.url)) + '/fixtures';

test('rule 3: design type with valid refs (path + anchor) — pass', () => {
  const f = file('a', {
    type: 'spec',
    references: ['sample-target.md#7.2-portfolio-construction'],
  });
  assert.deepEqual(ruleReferencesValid(f, fixturesDir), []);
});

test('rule 3: design type with empty references — fail', () => {
  const f = file('a', { type: 'design', references: [] });
  const violations = ruleReferencesValid(f, fixturesDir);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /references.*empty/i);
});

test('rule 3: design type with non-existent path — fail', () => {
  const f = file('a', { type: 'spec', references: ['nonexistent.md'] });
  const violations = ruleReferencesValid(f, fixturesDir);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /not found/i);
});

test('rule 3: design type with bad anchor — fail', () => {
  const f = file('a', { type: 'spec', references: ['sample-target.md#nope'] });
  const violations = ruleReferencesValid(f, fixturesDir);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /anchor.*not found/i);
});

test('rule 3: non-design types skip the check', () => {
  const f = file('a', { type: 'bug', references: [] });
  assert.deepEqual(ruleReferencesValid(f, fixturesDir), []);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Expected: 5 new tests fail.

- [ ] **Step 4: Implement rule 3**

Append to `.claude/skills/backlog-lint/lib/rules.mjs`:

```javascript
import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function ruleReferencesValid(file, repoRoot) {
  if (!['design', 'spec'].includes(file.frontmatter?.type)) return [];
  const refs = file.frontmatter.references;
  if (!Array.isArray(refs) || refs.length === 0) {
    return [v('references-valid', file,
      `${file.id}: ${file.frontmatter.type} type has empty references (rule 3)`)];
  }
  const violations = [];
  for (const ref of refs) {
    const [pathPart, anchor] = ref.split('#');
    const fullPath = isAbsolute(pathPart) ? pathPart : join(repoRoot, pathPart);
    if (!existsSync(fullPath)) {
      violations.push(v('references-valid', file,
        `${file.id}: reference path not found: ${pathPart}`));
      continue;
    }
    if (anchor) {
      const content = readFileSync(fullPath, 'utf8');
      const headings = [...content.matchAll(/^#+\s+(.+)$/gm)].map(m => slugify(m[1]));
      if (!headings.includes(anchor.toLowerCase())) {
        violations.push(v('references-valid', file,
          `${file.id}: anchor "#${anchor}" not found in ${pathPart}`));
      }
    }
  }
  return violations;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node --test .claude/skills/backlog-lint/test/rules.test.mjs
```

Expected: 18 tests pass total.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/backlog-lint/lib/rules.mjs .claude/skills/backlog-lint/test/rules.test.mjs .claude/skills/backlog-lint/test/fixtures/sample-target.md
git commit -m "feat(backlog-lint): rule 3 — references path + anchor validation"
```

---

### Task 6: Index renderer + rule 7

**Files:**
- Create: `.claude/skills/backlog-lint/lib/index-render.mjs`
- Create: `.claude/skills/backlog-lint/test/index-render.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/backlog-lint/test/index-render.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIndex } from '../lib/index-render.mjs';

const file = (id, fm) => ({
  id, filename: `${id}.md`, path: `/dummy/${id}.md`,
  frontmatter: { id, type: 'bug', notes: '', ...fm }, body: '',
});

test('renderIndex includes all four sections in order', () => {
  const files = [
    file('act-x', { status: 'active', out_of_scope: ['y'], type: 'spec', notes: 'in flight' }),
    file('q-1', { status: 'queued', rank: 1, notes: 'next up' }),
    file('q-2', { status: 'queued', rank: 2, notes: 'after that' }),
    file('park-a', { status: 'parking', notes: 'someday' }),
    file('ship-1', { status: 'shipped', validation_gate: '5/5', notes: 'done', closed: '2026-05-06' }),
  ];
  const out = renderIndex(files);
  assert.match(out, /## ACTIVE/);
  assert.match(out, /## QUEUED/);
  assert.match(out, /## PARKING LOT/);
  assert.match(out, /## Recently Shipped/);
  // section order
  assert.ok(out.indexOf('## ACTIVE') < out.indexOf('## QUEUED'));
  assert.ok(out.indexOf('## QUEUED') < out.indexOf('## PARKING LOT'));
  assert.ok(out.indexOf('## PARKING LOT') < out.indexOf('## Recently Shipped'));
});

test('renderIndex links by id-relative path and includes notes one-liner', () => {
  const files = [
    file('act-x', { status: 'active', out_of_scope: ['y'], type: 'spec', notes: 'in flight' }),
  ];
  const out = renderIndex(files);
  assert.match(out, /\[act-x\]\(backlog\/act-x\.md\)/);
  assert.match(out, /in flight/);
  assert.match(out, /\[spec\]/);
});

test('renderIndex orders QUEUED by rank', () => {
  const files = [
    file('z', { status: 'active', out_of_scope: ['y'], notes: '' }),
    file('q-3', { status: 'queued', rank: 3, notes: 'third' }),
    file('q-1', { status: 'queued', rank: 1, notes: 'first' }),
    file('q-2', { status: 'queued', rank: 2, notes: 'second' }),
  ];
  const out = renderIndex(files);
  const queuedSection = out.split('## QUEUED')[1].split('## PARKING LOT')[0];
  assert.ok(queuedSection.indexOf('q-1') < queuedSection.indexOf('q-2'));
  assert.ok(queuedSection.indexOf('q-2') < queuedSection.indexOf('q-3'));
});

test('renderIndex caps Recently Shipped at 10', () => {
  const shipped = [];
  for (let i = 0; i < 15; i++) {
    shipped.push(file(`s-${i}`, { status: 'shipped', validation_gate: 'ok', notes: '' }));
  }
  const files = [file('a', { status: 'active', out_of_scope: ['y'], notes: '' }), ...shipped];
  const out = renderIndex(files);
  const section = out.split('## Recently Shipped')[1];
  const matches = section.match(/\[s-\d+\]/g) ?? [];
  assert.ok(matches.length <= 10, `expected ≤10, got ${matches.length}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test .claude/skills/backlog-lint/test/index-render.test.mjs
```

Expected: FAIL — `Cannot find module '../lib/index-render.mjs'`.

- [ ] **Step 3: Implement renderer**

Create `.claude/skills/backlog-lint/lib/index-render.mjs`:

```javascript
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const HEADER = `# Nestfolio Backlog

> Generated by \`backlog-lint --fix\` from \`docs/backlog/<id>.md\` frontmatter.
> Do not hand-edit. Discipline rules: see \`CLAUDE.md\` § "Backlog Discipline".

`;

function lineFor(f) {
  const type = f.frontmatter.type ? `[${f.frontmatter.type}]` : '';
  const notes = f.frontmatter.notes?.trim() ? ` — ${f.frontmatter.notes.trim()}` : '';
  return `[${f.id}](backlog/${f.id}.md) ${type}${notes}`.trim();
}

function gitClosedDate(path) {
  try {
    return execSync(`git log -1 --format=%ad --date=short -- "${path}"`).toString().trim() || null;
  } catch { return null; }
}

export function renderIndex(files) {
  const active = files.filter(f => f.frontmatter?.status === 'active');
  const queued = files.filter(f => f.frontmatter?.status === 'queued')
    .sort((a, b) => (a.frontmatter.rank ?? 0) - (b.frontmatter.rank ?? 0));
  const parking = files.filter(f => f.frontmatter?.status === 'parking');
  const shippedAll = files.filter(f => f.frontmatter?.status === 'shipped');
  const shippedRecent = shippedAll
    .map(f => ({ f, date: f.frontmatter.closed ?? gitClosedDate(f.path) ?? '0000-00-00' }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  const lines = [HEADER];
  lines.push('## ACTIVE\n');
  if (active.length === 0) lines.push('_(none)_\n');
  for (const f of active) lines.push(`- ${lineFor(f)}`);
  lines.push('\n## QUEUED\n');
  if (queued.length === 0) lines.push('_(none)_\n');
  queued.forEach((f, i) => lines.push(`${i + 1}. ${lineFor(f)}`));
  lines.push('\n## PARKING LOT\n');
  if (parking.length === 0) lines.push('_(none)_\n');
  for (const f of parking) lines.push(`- ${lineFor(f)}`);
  lines.push('\n## Recently Shipped (last 10)\n');
  if (shippedRecent.length === 0) lines.push('_(none)_\n');
  for (const { f, date } of shippedRecent) lines.push(`- ${date} — ${lineFor(f)}`);
  return lines.join('\n') + '\n';
}

export function ruleIndexMatches(files, indexPath) {
  if (!existsSync(indexPath)) {
    return [{ rule: 'index-matches', file: null, message: `${indexPath} not found` }];
  }
  const expected = renderIndex(files);
  const actual = readFileSync(indexPath, 'utf8');
  if (actual !== expected) {
    return [{ rule: 'index-matches', file: null,
      message: `BACKLOG.md is out of date — run backlog-lint --fix` }];
  }
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test .claude/skills/backlog-lint/test/index-render.test.mjs
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-lint/lib/index-render.mjs .claude/skills/backlog-lint/test/index-render.test.mjs
git commit -m "feat(backlog-lint): index renderer + rule 7 (index-matches)"
```

---

### Task 7: Dossier sync (`--fix` regenerates `related_workstreams:`)

**Files:**
- Create: `.claude/skills/backlog-lint/lib/dossier-sync.mjs`
- Create: `.claude/skills/backlog-lint/test/dossier-sync.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/backlog-lint/test/dossier-sync.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncDossiers } from '../lib/dossier-sync.mjs';

test('syncDossiers writes related_workstreams from topic_memory pointers', () => {
  const memDir = mkdtempSync(join(tmpdir(), 'mem-'));
  writeFileSync(join(memDir, 'project_alpha.md'),
    `---\nname: alpha\n---\n\n# Alpha\nBody.\n`);
  writeFileSync(join(memDir, 'project_beta.md'),
    `# Beta\n\nNo frontmatter.\n`);

  const backlogFiles = [
    { id: 'work-1', frontmatter: { topic_memory: ['project_alpha.md'] } },
    { id: 'work-2', frontmatter: { topic_memory: ['project_alpha.md', 'project_beta.md'] } },
  ];

  syncDossiers(backlogFiles, memDir);

  const alpha = readFileSync(join(memDir, 'project_alpha.md'), 'utf8');
  assert.match(alpha, /related_workstreams:\s*\n\s*-\s*work-1\n\s*-\s*work-2/);
  // existing fields preserved
  assert.match(alpha, /name:\s*alpha/);

  const beta = readFileSync(join(memDir, 'project_beta.md'), 'utf8');
  // beta had no frontmatter — gets one prepended
  assert.match(beta, /^---\nrelated_workstreams:\s*\n\s*-\s*work-2\n---\n/);
  assert.match(beta, /# Beta/);

  rmSync(memDir, { recursive: true });
});

test('syncDossiers clears related_workstreams when no backlog file points to a dossier', () => {
  const memDir = mkdtempSync(join(tmpdir(), 'mem-'));
  // Pre-existing dossier with stale related_workstreams
  writeFileSync(join(memDir, 'project_alpha.md'),
    `---\nname: alpha\nrelated_workstreams:\n  - old-id\n---\n\nBody.\n`);
  // No backlog file references this dossier
  syncDossiers([{ id: 'work-1', frontmatter: {} }], memDir);
  const alpha = readFileSync(join(memDir, 'project_alpha.md'), 'utf8');
  // Stale id removed; related_workstreams now empty
  assert.doesNotMatch(alpha, /old-id/);
  assert.match(alpha, /related_workstreams:\s*(\[\]|\n)/);
  // Other fields preserved
  assert.match(alpha, /name:\s*alpha/);
  rmSync(memDir, { recursive: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: 2 tests fail.

- [ ] **Step 3: Implement dossier sync**

Create `.claude/skills/backlog-lint/lib/dossier-sync.mjs`:

```javascript
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { parseFrontmatter } from './frontmatter.mjs';

function writeDossier(path, ids) {
  const content = readFileSync(path, 'utf8');
  const { frontmatter, body } = parseFrontmatter(content);
  const fm = frontmatter ?? {};
  fm.related_workstreams = [...ids].sort();
  const fmYaml = stringifyYaml(fm);
  const newContent = `---\n${fmYaml}---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
  writeFileSync(path, newContent);
}

export function syncDossiers(backlogFiles, memDir) {
  // Build map: dossier filename → array of workstream ids referencing it
  const map = new Map();
  for (const bf of backlogFiles) {
    const tm = bf.frontmatter?.topic_memory ?? [];
    for (const dossierFile of tm) {
      if (!map.has(dossierFile)) map.set(dossierFile, []);
      map.get(dossierFile).push(bf.id);
    }
  }

  // Walk every project_*.md in memDir; set related_workstreams to current truth
  // (empty list if no backlog file points at it — clears stale ids)
  if (!existsSync(memDir)) return;
  const dossierFiles = readdirSync(memDir)
    .filter(f => f.startsWith('project_') && f.endsWith('.md'));
  for (const dossierFile of dossierFiles) {
    const path = join(memDir, dossierFile);
    const ids = map.get(dossierFile) ?? [];
    writeDossier(path, ids);
  }

  // Warn about backlog topic_memory pointers that target missing dossiers
  for (const [dossierFile, workstreams] of map) {
    if (!dossierFiles.includes(dossierFile)) {
      console.warn(`[dossier-sync] target missing: ${dossierFile} (referenced by ${workstreams.join(', ')})`);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test .claude/skills/backlog-lint/test/dossier-sync.test.mjs
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-lint/lib/dossier-sync.mjs .claude/skills/backlog-lint/test/dossier-sync.test.mjs
git commit -m "feat(backlog-lint): dossier sync regenerates related_workstreams"
```

---

### Task 8: CLI orchestration in `lint.mjs`

**Files:**
- Modify: `.claude/skills/backlog-lint/lint.mjs`

- [ ] **Step 1: Replace stub with full CLI**

Replace contents of `.claude/skills/backlog-lint/lint.mjs`:

```javascript
#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBacklogFiles } from './lib/frontmatter.mjs';
import {
  ruleIdMatchesFilename, ruleSingleActive, ruleQueuedRanks,
  ruleActiveOutOfScope, ruleShippedValidationGate, ruleReferencesValid,
} from './lib/rules.mjs';
import { renderIndex, ruleIndexMatches } from './lib/index-render.mjs';
import { syncDossiers } from './lib/dossier-sync.mjs';

const REPO_ROOT = execSync('git rev-parse --show-toplevel').toString().trim();
const BACKLOG_DIR = join(REPO_ROOT, 'docs/backlog');
const BACKLOG_INDEX = join(REPO_ROOT, 'docs/BACKLOG.md');
const MEMORY_DIR = process.env.NESTFOLIO_MEMORY_DIR
  ?? join(process.env.HOME, '.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory');

function main() {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');

  if (!existsSync(BACKLOG_DIR)) {
    if (fix) mkdirSync(BACKLOG_DIR, { recursive: true });
    else { console.error(`docs/backlog/ missing — run with --fix to create`); process.exit(1); }
  }

  const files = loadBacklogFiles(BACKLOG_DIR);

  if (fix) {
    writeFileSync(BACKLOG_INDEX, renderIndex(files));
    if (existsSync(MEMORY_DIR)) syncDossiers(files, MEMORY_DIR);
    else console.warn(`[backlog-lint] memory dir not found at ${MEMORY_DIR} — skipping dossier sync`);
  }

  const violations = [];
  for (const f of files) {
    violations.push(...ruleIdMatchesFilename(f));
    violations.push(...ruleActiveOutOfScope(f));
    violations.push(...ruleShippedValidationGate(f));
    violations.push(...ruleReferencesValid(f, REPO_ROOT));
  }
  violations.push(...ruleSingleActive(files));
  violations.push(...ruleQueuedRanks(files));
  violations.push(...ruleIndexMatches(files, BACKLOG_INDEX));

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  [${v.rule}] ${v.message}`);
    process.exit(1);
  }
  console.log(`✓ ${files.length} backlog files; all 7 rules pass${fix ? ' (with --fix applied)' : ''}`);
}

main();
```

- [ ] **Step 2: Smoke test on empty state**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix
```

Expected: creates `docs/backlog/` if missing; writes a `docs/BACKLOG.md` with empty sections; exits 1 with rule 2 violation (`no file with status: active`). This is correct — there's no active item yet.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/backlog-lint/lint.mjs
git commit -m "feat(backlog-lint): CLI orchestration over rules + index + dossier sync"
```

---

### Task 9: Author `SKILL.md` for `backlog-lint`

**Files:**
- Create: `.claude/skills/backlog-lint/SKILL.md`

- [ ] **Step 1: Write the skill prose**

Create `.claude/skills/backlog-lint/SKILL.md`:

```markdown
---
name: backlog-lint
description: Validate docs/backlog/ frontmatter against the 7 invariants and (with --fix) regenerate docs/BACKLOG.md from frontmatter and related_workstreams in topic dossiers. Use at every workstream ship and on demand.
---

## When this skill applies

Invoke when:
- A workstream is being shipped (status flips to `shipped`).
- A workstream is being adopted to ACTIVE (status flips to `active`).
- A backlog item is created via `backlog-add`.
- The user asks to verify backlog discipline ("lint the backlog", "check BACKLOG.md", etc.).
- A boundary review is happening (the per-ship 5-minute review).

## What it enforces

7 rules over `docs/backlog/<id>.md`:

1. `id` matches filename.
2. Exactly one file has `status: active`.
3. `type ∈ {design, spec}` ⇒ `references:` non-empty + paths exist + `#anchors` resolve.
4. `status: active` ⇒ `out_of_scope:` non-empty.
5. `status: shipped` ⇒ `validation_gate` non-empty.
6. `status: queued` ⇒ `rank` set + unique among queued.
7. `docs/BACKLOG.md` matches the auto-generated rendering of frontmatter.

## What `--fix` does

- Regenerates `docs/BACKLOG.md` from per-item frontmatter (rule 7 becomes structurally true).
- Regenerates `related_workstreams:` in topic dossiers (`~/.claude/.../memory/project_*.md`) from `topic_memory:` pointers in backlog files. One-way derive; never hand-edit `related_workstreams:`.

## How to invoke

```bash
# Validate only (exit code 1 on violations, 0 on success)
node .claude/skills/backlog-lint/lint.mjs

# Auto-fix index + dossier related_workstreams, then validate
node .claude/skills/backlog-lint/lint.mjs --fix
```

Override the memory dir for tests:

```bash
NESTFOLIO_MEMORY_DIR=/tmp/test-mem node .claude/skills/backlog-lint/lint.mjs --fix
```

## Procedure

1. Run `node .claude/skills/backlog-lint/lint.mjs --fix` from repo root.
2. If violations remain after `--fix`, surface each one with file + rule name. Do not commit until they're resolved.
3. After a clean run, stage the regenerated `docs/BACKLOG.md` (and any modified per-item files) before committing the workstream change.

## Drift surface this lint cannot catch

- A `references:` entry pointing at a still-existing path/anchor whose semantic meaning has changed (rule 3 is structural, not semantic).
- A missing `topic_memory:` entry that should exist but wasn't added during exec.

These decay slowly and should be caught at the per-ship boundary review.
```

- [ ] **Step 2: Verify the skill is discoverable**

```bash
ls .claude/skills/backlog-lint/
```

Expected: `SKILL.md`, `lint.mjs`, `lib/`, `test/`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/backlog-lint/SKILL.md
git commit -m "feat(backlog-lint): SKILL.md describing 7 rules + --fix semantics"
```

---

### Task 10: Rewrite `backlog-add` skill to create per-item files

**Files:**
- Modify: `.claude/skills/backlog-add/SKILL.md`

- [ ] **Step 1: Rewrite the skill prose**

Replace contents of `.claude/skills/backlog-add/SKILL.md`:

```markdown
---
name: backlog-add
description: Create a new backlog file at docs/backlog/<id>.md (default status=parking) and refresh the auto-generated docs/BACKLOG.md index. Use when a side-finding, out-of-scope bug, or future improvement surfaces during execution and should be filed without pivoting from the active workstream.
---

## When this skill applies

Invoke when:
- An out-of-scope failure surfaces during validation of an active spec/plan.
- The user says "park this", "file this for later", "add to backlog".
- A side-finding deserves to be tracked but doesn't justify pivoting.

Do NOT invoke when:
- The finding actually blocks the active workstream's done-definition (then it IS in scope).
- The user is starting a new workstream — use `superpowers:brainstorming` and create the file with `status: queued` or `status: active`.

## What this skill does

Creates `docs/backlog/<id>.md` with minimum-valid frontmatter (default `status: parking`, `type: bug`), then runs `backlog-lint --fix` to regenerate the index.

## Procedure

1. Take the one-liner from the user (or args). If unclear, ask once for: title, type (`bug` | `refactor` | `tooling` | `infra` | `design` | `spec`), and any file:line evidence to put in the body.
2. Compute the `id`: kebab-case slug from the title, ≤ 60 chars, must be unique. Verify with `ls docs/backlog/<id>.md` — if it exists, append `-2`, `-3`, etc.
3. Write `docs/backlog/<id>.md` using the template below.
4. Run `node .claude/skills/backlog-lint/lint.mjs --fix` to refresh `docs/BACKLOG.md` and verify the new file passes.
5. **Commit immediately.** Stage ONLY `docs/backlog/<id>.md` and `docs/BACKLOG.md`. Do NOT use `git add .`. Commit with `docs(backlog): file <id>` (parking), `docs(backlog): promote <id> to QUEUED` (queued), or `docs(backlog): ship <id>` (shipped).
6. Report: "Filed in PARKING LOT: `<id>` (commit `<sha>`). Resuming active workstream."

## File template (parking, default)

```markdown
---
id: <slug>
status: parking
type: bug
notes: "<one-line summary, ≤ 100 chars, shown in BACKLOG.md index>"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# <Title>

<Evidence: file:line refs, hypothesis, cheapest next step. Pointer to topic memory if one exists.>
```

## File template (active or queued)

For status `active`, also fill `out_of_scope:` (rule 4) and `references:` if `type ∈ {design, spec}` (rule 3).
For status `queued`, also fill `rank:` (rule 6).
For status `shipped`, fill `validation_gate:` (rule 5).

## Why auto-commit

Uncommitted backlog edits don't travel cleanly across worktrees, don't survive crashes, and accumulate as hidden todos. File-and-continue should be atomic. The `docs(backlog):` commit prefix is grep-able and squash-merge collapses on PRs.

## Examples of good entries

```markdown
- **`OnboardingRepository.updatePhase` ValidationException on non-mandate commits** — latent backend bug; non-blocking for onboarding e2e per Spec 3 ship.
- **BFF resolver region sweep** — advisory-bff + ledger-bff mutation resolvers likely missing `region` field.
```

## Examples of BAD entries (avoid)

- "TODO: investigate something" (no evidence)
- "Fix the bug we saw earlier" (no path to action)

If you can't be specific, ask one clarifying question before filing.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/backlog-add/SKILL.md
git commit -m "feat(backlog-add): rewrite to create per-item files + run backlog-lint --fix"
```

---

### Task 11: Update `CLAUDE.md` (Backlog Discipline + Skill Routing)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `backlog-lint` row to Skill Routing table**

In `CLAUDE.md`, find the Skill Routing table (around line 48). Add this row before the `Rebuild all docs from code` row:

```markdown
| Validate backlog state                | `backlog-lint`                                      |
```

- [ ] **Step 2: Rewrite `## Backlog Discipline (MANDATORY)` section**

Replace the entire section (current lines ~71–90) with:

```markdown
## Backlog Discipline (MANDATORY)

The canonical record for every workstream is `docs/backlog/<id>.md`. `docs/BACKLOG.md` is an auto-generated thin index — **never hand-edit it**. The `backlog-lint` skill enforces 7 invariants; the `backlog-add` skill creates new entries.

**Storage:**
- `docs/backlog/<id>.md` — one file per workstream, ever. `status: active|queued|parking|shipped|dropped` distinguishes lifecycle. Files never move folder on close.
- `docs/BACKLOG.md` — auto-generated index. Sections: ACTIVE / QUEUED / PARKING LOT / Recently Shipped (last 10).
- Cross-references everywhere are by `id`, never file path.

**The 7 rules** (enforced by `backlog-lint`):
1. `id` matches filename. 2. Exactly one `status: active`. 3. `type ∈ {design, spec}` ⇒ `references:` non-empty + paths exist + anchors resolve. 4. `status: active` ⇒ `out_of_scope:` non-empty. 5. `status: shipped` ⇒ `validation_gate` non-empty. 6. `status: queued` ⇒ `rank` set + unique. 7. `BACKLOG.md` matches files.

**Before starting any spec/plan/implementation:** confirm the active workstream is reflected in `docs/backlog/<id>.md` with `status: active`. If it isn't, create or promote first.

**Adoption to ACTIVE requires verifying every cited reference still matches code** — `backlog-lint` confirms paths and anchors exist, but YOU must confirm the cited section's *meaning* still holds. If any reference is stale, fix the doc layer FIRST.

**Every spec or plan MUST have an explicit § "Out of scope" section** before execution begins. The backlog file's `out_of_scope:` frontmatter mirrors this.

**When an out-of-scope finding surfaces during execution**, default to *file-and-continue*:
1. Invoke the `backlog-add` skill — it creates `docs/backlog/<id>.md` and runs `backlog-lint --fix`.
2. State briefly in chat what was filed.
3. Continue executing the active workstream.

Do NOT pivot mid-flight unless the finding actually blocks the active workstream's done-definition.

**At each workstream ship:**
1. Set `status: shipped`, fill `validation_gate:` in the active file.
2. Run `node .claude/skills/backlog-lint/lint.mjs --fix` — regenerates `BACKLOG.md` and `related_workstreams:` in topic dossiers.
3. Spend 5 minutes on a boundary review of `docs/BACKLOG.md` — re-rank PARKING LOT, promote items to QUEUED, drop items that have aged out.

**BACKLOG ↔ MEMORY contract** (see spec `docs/superpowers/specs/2026-05-07-backlog-redesign-design.md`):
- Backlog file `topic_memory: [project_X.md]` is the single source of truth for the workstream↔dossier link.
- Topic dossier `related_workstreams:` is regenerated by `backlog-lint --fix` — **never hand-edit it**.
- `MEMORY.md` no longer has "Recently Completed Work" or "Active / Planned Work" sections; ship narratives live in the backlog file body.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): rewrite Backlog Discipline § for per-item file model + backlog-lint"
```

---

## Phase 1: Migrate ~21 open items + replace BACKLOG.md with auto-generated index

### Task 12: Migrate ACTIVE + QUEUED + PARKING entries to `docs/backlog/<id>.md`

**Files:**
- Read: `docs/BACKLOG.md` (current shape)
- Create: ~21 new files in `docs/backlog/`
- Replace: `docs/BACKLOG.md` (auto-generated)

- [ ] **Step 1: Inventory current BACKLOG.md sections**

Read the full `docs/BACKLOG.md` and extract:
- The single ACTIVE entry (title, body, references, out_of_scope, spec/plan paths if present).
- All QUEUED entries (title, body, rank order from list position).
- All PARKING LOT entries (one-liners with optional sub-bullets).

Don't rely on memory — read the file each time and extract the verbatim content.

- [ ] **Step 2: For each ACTIVE/QUEUED entry, create a backlog file**

For each entry, compute a kebab-case slug ≤ 60 chars from the title, then write `docs/backlog/<id>.md`:

```markdown
---
id: <slug>
status: <active | queued>
type: <inferred from entry: spec/design/bug/refactor/tooling/infra>
rank: <integer for queued; null for active>
references:
  - <path#anchor cited in entry, if any>
out_of_scope:
  - "<copied from any 'Out of scope' bullet in the entry, if present>"
spec: <path/to/<...>-design.md if mentioned>
plan: <path/to/<...>-plan.md if mentioned>
topic_memory:
  - project_<slug>.md  # if topic memory mentioned
validation_gate: null
notes: "<one-line summary from entry's lead bullet, ≤ 100 chars>"
---

# <Title>

<Body verbatim from BACKLOG.md entry. Preserve formatting, links, file:line refs.>
```

**For ACTIVE specifically**: if `out_of_scope:` is empty after extraction, look at the linked spec file's "## Out of scope" section and copy bullet titles. Never leave it empty (rule 4 will fail).

**For QUEUED specifically**: assign `rank` by the order they appear in BACKLOG.md (1 = first in list).

- [ ] **Step 3: For each PARKING entry, create a minimal backlog file**

```markdown
---
id: <slug>
status: parking
type: <inferred>
notes: "<one-line lead text from BACKLOG entry>"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_<slug>.md  # only if mentioned
validation_gate: null
---

# <Title>

<Body — copy any sub-bullets / file:line refs from BACKLOG entry.>
```

- [ ] **Step 4: Create the backlog-redesign workstream's own file**

Create `docs/backlog/backlog-redesign.md`:

```markdown
---
id: backlog-redesign
status: active
type: spec
references:
  - CLAUDE.md
out_of_scope:
  - "Migrating older shipped work (pre-MEMORY 'Recently Completed Work' cutoff)"
  - "Replacing the auto-memory system or project_*.md topic dossiers"
  - "Unifying project_*.md files into the backlog model"
  - "Adopting Backlog.md (MrLesk) or Linear MCP"
  - "Building a query CLI or web UI"
spec: docs/superpowers/specs/2026-05-07-backlog-redesign-design.md
plan: docs/superpowers/plans/2026-05-07-backlog-redesign-plan.md
topic_memory: []
validation_gate: null
notes: "Decompose BACKLOG.md to per-item files; build backlog-lint; remove MEMORY duplication"
---

# Backlog redesign — hybrid index + per-item files

See spec at `docs/superpowers/specs/2026-05-07-backlog-redesign-design.md` and plan at `docs/superpowers/plans/2026-05-07-backlog-redesign-plan.md` for full detail.

This workstream replaces the previous single-ACTIVE entry on the same topic.
```

**Promote backlog-redesign to ACTIVE**: when this file is created with `status: active`, the existing ACTIVE entry from old BACKLOG.md becomes either `queued` (if the migration hasn't fully shipped yet) or its work continues in parallel — set the prior ACTIVE to `status: queued` with `rank: 1` to preserve invariant 2 (single ACTIVE).

- [ ] **Step 5: Run lint --fix to regenerate BACKLOG.md**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix
```

Expected: writes `docs/BACKLOG.md`; reports `✓ N backlog files; all 7 rules pass`.

If violations are reported, fix the offending file (most likely culprits: missing `out_of_scope:` on the active item, missing `rank:` on queued items, broken anchor in `references:`). Repeat until clean.

- [ ] **Step 6: Sanity-check the regenerated index**

```bash
head -40 docs/BACKLOG.md
```

Expected: header + ACTIVE section showing `backlog-redesign` (and the prior ACTIVE if demoted to queued) + QUEUED list ordered by rank + PARKING LOT.

- [ ] **Step 7: Commit Phase 1**

```bash
git add docs/backlog/ docs/BACKLOG.md
git commit -m "feat(backlog): Phase 1 — migrate ACTIVE/QUEUED/PARKING to per-item files

Replaces single-file BACKLOG.md with auto-generated index over per-item files in
docs/backlog/. ~21 items migrated. Lint passes 7/7."
```

---

## Phase 2: Backfill ~10 shipped items from MEMORY.md "Recently Completed Work"

### Task 13: Create shipped backlog files + delete MEMORY RCW section

**Files:**
- Read: `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md`
- Create: ~10 files in `docs/backlog/<id>.md` with `status: shipped`
- Modify: `MEMORY.md` (delete `## Recently Completed Work` section)
- Modify: `docs/BACKLOG.md` (regenerated)

- [ ] **Step 1: Inventory the RCW section**

Read MEMORY.md and extract every entry under `## Recently Completed Work`. For each, capture:
- Title
- Ship date
- Commits referenced
- Validation gate result (e.g., "39/41 integration", "5/5 e2e")
- Topic memory pointers
- Spec + plan paths if mentioned
- Body narrative

- [ ] **Step 2: For each, create `docs/backlog/<id>.md` with `status: shipped`**

```markdown
---
id: <slug>
status: shipped
type: <spec | design | bug | refactor | tooling | infra>
references: []
out_of_scope: []
spec: <path>
plan: <path>
topic_memory:
  - project_<slug>.md
validation_gate: "<short string from RCW entry, e.g., '5/5 e2e onboarding, 39/41 integration'>"
notes: "<one-line summary>"
---

# <Title>

<Full narrative copied from MEMORY.md RCW entry. Preserve commit SHAs, validation
specifics, gotchas, what was filed in PARKING LOT during exec, etc.>
```

**Validation gate is required** (rule 5). Pull the most concrete result line from the RCW narrative — e.g., "39/41 integration; 5/5 onboarding completions; 2/5 full journey".

- [ ] **Step 3: Delete the `## Recently Completed Work` section from MEMORY.md**

In `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md`, delete the entire `## Recently Completed Work` section (header + all entries) up to (not including) the next `## ` header.

- [ ] **Step 4: Run lint --fix**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix
```

Expected: regenerates `docs/BACKLOG.md` (now showing 10 entries in "Recently Shipped (last 10)" section); rules pass.

- [ ] **Step 5: Verify MEMORY.md size dropped substantially**

```bash
wc -c ~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md
```

Expected: substantially smaller than ~31KB (RCW was the bulk). May still be over the 24.4KB cap if A/PW is also large; Phase 3 takes care of the rest.

- [ ] **Step 6: Commit Phase 2**

```bash
git add docs/backlog/ docs/BACKLOG.md
git commit -m "feat(backlog): Phase 2 — backfill 10 shipped items from MEMORY RCW

MEMORY.md 'Recently Completed Work' section deleted (not committed; outside repo).
Ship narratives now live in docs/backlog/<id>.md with status: shipped."
```

---

## Phase 3: Reconcile + delete MEMORY.md "Active / Planned Work" section

### Task 14: Verify every A/PW entry exists as a backlog file, then delete the section

**Files:**
- Read: `MEMORY.md`
- Modify: `MEMORY.md` (delete `## Active / Planned Work` section)

- [ ] **Step 1: Inventory the A/PW section**

Read MEMORY.md and list every entry under `## Active / Planned Work`. For each, note title + claimed status (e.g., "DESIGN IN PROGRESS", "PENDING", "RESOLVED").

- [ ] **Step 2: For each entry, verify a corresponding backlog file exists**

```bash
ls docs/backlog/ | grep -i <slug-fragment>
```

If a backlog file is missing for an A/PW entry that's still relevant, create it (parking or queued as appropriate) using the `backlog-add` template before deleting the section.

If an entry is labeled RESOLVED in A/PW, it should already exist as `status: shipped` in `docs/backlog/`. Verify and skip.

- [ ] **Step 3: Run lint --fix to confirm consistency**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix
```

Expected: rules pass.

- [ ] **Step 4: Delete the `## Active / Planned Work` section from MEMORY.md**

Remove the entire section header + entries.

- [ ] **Step 5: Verify MEMORY.md state**

```bash
wc -c ~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md
grep -c '^## ' ~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md
```

Expected: file size further reduced; section count drops by 1.

- [ ] **Step 6: Commit any in-repo changes from this phase**

If new backlog files were created in Step 2, commit them:

```bash
git add docs/backlog/ docs/BACKLOG.md
git commit -m "feat(backlog): Phase 3 — reconcile MEMORY A/PW entries to backlog files

MEMORY.md 'Active / Planned Work' section deleted (not committed; outside repo)."
```

If no new backlog files were needed, skip the commit — Phase 3 is MEMORY-only.

---

## Phase 4: Populate `related_workstreams:` in topic dossiers

### Task 15: Run dossier sync, verify, and update MEMORY.md topic-file index

**Files:**
- Modify: `~/.claude/.../memory/project_*.md` (~22 files; gain `related_workstreams:` frontmatter)
- Modify: `MEMORY.md` (update topic-file index lines if any references became stale)

- [ ] **Step 1: Run lint --fix**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix
```

Expected: writes `related_workstreams:` into every dossier mentioned by any backlog file's `topic_memory:` array. Console may warn about missing dossier files; investigate each warning.

- [ ] **Step 2: Spot-check 3 dossiers**

For 3 random `project_*.md` files in the memory dir, verify the new frontmatter is present and matches expected workstream ids:

```bash
head -10 ~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_operating_mode.md
```

Expected: `---\nrelated_workstreams:\n  - <id>\n  - <id>\n---` at top of file.

- [ ] **Step 3: Re-skim MEMORY.md `## Topic Files` index for stale entries**

If any topic file is no longer referenced by any backlog item AND no longer relevant, decide whether to delete the dossier or leave it as historical. Default: leave it.

- [ ] **Step 4: Final lint verification**

```bash
node .claude/skills/backlog-lint/lint.mjs
```

Expected: `✓ N backlog files; all 7 rules pass` (no `--fix`).

- [ ] **Step 5: Phase 4 produces no in-repo diff** — MEMORY edits are not committed.

---

## Phase 5: End-to-end smoke + ship the workstream

### Task 16: Verify the full system + ship `backlog-redesign`

- [ ] **Step 1: Run the full lint test suite**

```bash
node --test .claude/skills/backlog-lint/test/
```

Expected: all tests pass (frontmatter + rules + index-render + dossier-sync).

- [ ] **Step 2: Run the lint on real state**

```bash
node .claude/skills/backlog-lint/lint.mjs
```

Expected: clean exit with `✓` line.

- [ ] **Step 3: Smoke-test `backlog-add` end-to-end**

Manually create a parking item via the skill flow (read SKILL.md, follow procedure):

```bash
cat > docs/backlog/smoke-test-entry.md <<'EOF'
---
id: smoke-test-entry
status: parking
type: bug
notes: "smoke test for backlog-add procedure"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Smoke test entry

Manually created to verify backlog-add procedure works end-to-end.
EOF
node .claude/skills/backlog-lint/lint.mjs --fix
grep smoke-test-entry docs/BACKLOG.md
```

Expected: lint passes; `smoke-test-entry` appears in PARKING LOT section of `docs/BACKLOG.md`.

Then delete it:

```bash
rm docs/backlog/smoke-test-entry.md
node .claude/skills/backlog-lint/lint.mjs --fix
```

Expected: lint passes; `smoke-test-entry` removed from index.

- [ ] **Step 4: Ship `backlog-redesign`**

Edit `docs/backlog/backlog-redesign.md`:
- Set `status: shipped`.
- Set `validation_gate: "16-task plan executed; 7/7 lint rules pass; MEMORY.md ≤ 25KB"` (or actual numbers).
- Append a "## Ship narrative" section to the body summarizing what landed, any deviations from the plan, and any out-of-scope items filed during execution.

- [ ] **Step 5: Run lint --fix and commit ship**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix
git add docs/backlog/backlog-redesign.md docs/BACKLOG.md
git commit -m "feat(backlog): ship backlog-redesign workstream

Validation gate: 7/7 lint rules pass; MEMORY.md back below 24.4KB cap; per-item
files + auto-generated index live; backlog-lint and backlog-add skills wired."
```

- [ ] **Step 6: Boundary review (per CLAUDE.md discipline)**

Spend 5 minutes on `docs/BACKLOG.md`:
- Re-rank PARKING LOT — anything grown teeth that should be promoted to QUEUED?
- Drop items aged out (>90 days, no longer relevant).
- Confirm exactly one ACTIVE remains — promote the next workstream from QUEUED into the now-vacant ACTIVE slot, or leave ACTIVE empty if waiting on input.

---

## Verification matrix (spec coverage)

| Spec section | Implemented in |
|---|---|
| Storage shape (no archive, id-refs) | Tasks 1, 12 |
| Frontmatter schema (11 fields) | Tasks 12, 13 (and `backlog-add` template) |
| Lint rule 1 (id matches filename) | Task 3 |
| Lint rule 2 (single active) | Task 3 |
| Lint rule 3 (references) | Task 5 |
| Lint rule 4 (active ⇒ out_of_scope) | Task 4 |
| Lint rule 5 (shipped ⇒ validation_gate) | Task 4 |
| Lint rule 6 (queued ⇒ rank) | Task 3 |
| Lint rule 7 (index matches) | Task 6 |
| `--fix` regenerates BACKLOG.md | Tasks 6, 8 |
| `--fix` regenerates dossier `related_workstreams` | Tasks 7, 8, 15 |
| BACKLOG↔MEMORY contract (option 4) | Tasks 11, 13, 14, 15 |
| Phase 0 (infrastructure) | Tasks 1–11 |
| Phase 1 (migrate ~21 open) | Task 12 |
| Phase 2 (backfill ~10 shipped) | Task 13 |
| Phase 3 (delete MEMORY A/PW) | Task 14 |
| Phase 4 (dossier related_workstreams) | Task 15 |
| Done definition | Task 16 |
