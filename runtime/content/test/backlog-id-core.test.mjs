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
