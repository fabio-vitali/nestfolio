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
