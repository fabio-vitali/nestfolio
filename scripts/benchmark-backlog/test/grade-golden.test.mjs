import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gradeGolden } from '../grade.mjs';

function sb(files) {
  const d = mkdtempSync(join(tmpdir(), 'bef-g-')); mkdirSync(join(d, 'docs/backlog'), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, 'docs/backlog', name), body);
  return d;
}
test('passes when frontmatter matches golden', () => {
  const d = sb({ 'foo.md': '---\nid: foo\nstatus: parking\ntype: bug\nepic: e\nepic_role: captured\nnotes: "x"\n---\n# Foo\n' });
  const r = gradeGolden({ golden: { frontmatter: { foo: { epic: 'e', epic_role: 'captured' } } } }, d);
  assert.equal(r.pass, true, r.failures.join('; '));
});
test('fails when a golden field mismatches', () => {
  const d = sb({ 'foo.md': '---\nid: foo\nstatus: parking\ntype: bug\nepic: e\nepic_role: core\nnotes: "x"\n---\n# Foo\n' });
  const r = gradeGolden({ golden: { frontmatter: { foo: { epic_role: 'captured' } } } }, d);
  assert.equal(r.pass, false);
});
