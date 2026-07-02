import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scopeGate, singleActive, readItems } from '../lib/scope-gate.mjs';

test('B1: a diff fully inside declared scope → withinScope, no findings', () => {
  const r = scopeGate({ activeItem: { id: 'x', scope: 'services/foo/**' }, diffPaths: ['services/foo/bar.ts'] });
  assert.equal(r.withinScope, true);
  assert.deepEqual(r.escapes, []);
  assert.deepEqual(r.findings, []);
});

test('B2: a diff touching a path outside scope → the gate bites (one inconsistency finding)', () => {
  const r = scopeGate({ activeItem: { id: 'x', scope: 'services/foo/**' }, diffPaths: ['services/foo/bar.ts', 'services/baz/qux.ts'] });
  assert.equal(r.withinScope, false);
  assert.deepEqual(r.escapes, ['services/baz/qux.ts']);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].kind, 'inconsistency');
  assert.match(r.findings[0].detail, /services\/baz\/qux\.ts/);
});

test('B3: single-active — two active items is a broken floor', () => {
  const items = [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }, { id: 'c', status: 'queued' }];
  assert.equal(singleActive(items).length, 2);   // != 1 ⇒ the CLI exits 1
});

test('the CLI self-resolves the active item — readItems parses frontmatter, singleActive picks it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-'));
  writeFileSync(join(dir, 'a.md'), '---\nid: a\nstatus: active\nscope: "src/**"\n---\nbody');
  writeFileSync(join(dir, 'b.md'), '---\nid: b\nstatus: queued\n---\nbody');
  const actives = singleActive(readItems(dir));
  assert.equal(actives.length, 1);
  assert.equal(actives[0].scope, 'src/**');   // the scope the starter check gates against, resolved from disk
});
