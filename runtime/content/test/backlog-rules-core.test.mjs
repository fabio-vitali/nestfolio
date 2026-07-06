import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activeOutOfScopeViolations, shippedValidationGateViolations,
  promotionTriggerGatedViolations, activeEpicFieldsViolations,
  frontmatterParseableViolations, singleActiveViolations,
  queuedRanksViolations, singleActiveEpicViolations, epicClosureViolations,
  epicPointerIntegrityViolations, indexMatchesViolations, referencesValidViolations,
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

test('rule 3: design file with a missing reference → one finding', () => {
  const body = `---\nid: d\nstatus: parking\ntype: design\nreferences:\n  - missing-ref.md\n---\n\nbody\n`;
  const dir = fixture({ 'd.md': body });
  const f = referencesValidViolations(dir, dir); // root = fixture dir → "missing-ref.md" is absent → violation
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /reference path not found/);
});

// Regression: zero-arg must resolve absolute DIR/INDEX so ruleIndexMatches' git-date map (absolute-keyed) lines up.
// With relative defaults this returned a false-positive "BACKLOG.md out of date" finding on the clean backlog.
test('rule 7: indexMatchesViolations() zero-arg on the real backlog is clean (absolute-path resolution)', () => {
  assert.deepEqual(indexMatchesViolations(), []);
});
