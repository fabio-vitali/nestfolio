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
