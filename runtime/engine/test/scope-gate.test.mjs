import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopeGate, activePartition, readItems } from '../lib/scope-gate.mjs';

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

test('B3: single-active — two active non-epic items is a broken floor', () => {
  const items = [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }, { id: 'c', status: 'queued' }];
  assert.equal(activePartition(items).executables.length, 2);   // > 1 ⇒ the CLI exits 1
});

test('the CLI self-resolves the active item — readItems parses frontmatter, activePartition picks it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bl-'));
  writeFileSync(join(dir, 'a.md'), '---\nid: a\nstatus: active\ntype: feature\nscope: "src/**"\n---\nbody');
  writeFileSync(join(dir, 'b.md'), '---\nid: b\nstatus: queued\ntype: bug\n---\nbody');
  const { executables } = activePartition(readItems(dir));
  assert.equal(executables.length, 1);
  assert.equal(executables[0].scope, 'src/**');   // the scope the starter check gates against, resolved from disk
});

const it = (id, status, type) => ({ id, status, ...(type ? { type } : {}) });

test('activePartition splits active epics from active executables', () => {
  const { executables, epics } = activePartition([
    it('a', 'active'), it('e', 'active', 'epic'), it('q', 'queued'), it('p', 'parking', 'epic')]);
  assert.deepEqual(executables.map((i) => i.id), ['a']);
  assert.deepEqual(epics.map((i) => i.id), ['e']);
});

// CLI-level: the real single-active law (≤1 active non-epic, ≤1 active epic, ZERO legal — redteam item 6)
const SG = fileURLToPath(new URL('../lib/scope-gate.mjs', import.meta.url));
const md = (id, status, type = 'bug') => `---\nid: ${id}\nstatus: ${status}\n${type ? `type: ${type}\n` : ''}---\n`;
const fixtureDir = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'sa-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
};
const runSA = (d) => spawnSync('node', [SG, `--single-active`, `--backlog-dir=${d}`], { encoding: 'utf8' });

test('single-active: ZERO active is legal (exit 0) — the empirical redteam repro', () => {
  assert.equal(runSA(fixtureDir({ 'q.md': md('q', 'queued') })).status, 0);
});
test('single-active: one active epic + one active member is legal (exit 0)', () => {
  assert.equal(runSA(fixtureDir({ 'e.md': md('e', 'active', 'epic'), 'm.md': md('m', 'active') })).status, 0);
});
test('single-active: two active non-epics break the law (exit 1)', () => {
  const r = runSA(fixtureDir({ 'a.md': md('a', 'active'), 'b.md': md('b', 'active') }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /2 active non-epic/);
});
test('single-active: two active epics break the law (exit 1)', () => {
  assert.equal(runSA(fixtureDir({ 'e1.md': md('e1', 'active', 'epic'), 'e2.md': md('e2', 'active', 'epic') })).status, 1);
});

// readItems is the production read path (run-item.mjs + both CLI modes) — reconciled 2026-07-05:
// every item is schema-validated on read; an invalid file fails CLOSED (registry precedent, redteam item 2).
test('readItems validates each item — an invalid file fails CLOSED with an aggregate error naming it', () => {
  const d = mkdtempSync(join(tmpdir(), 'bl-inv-'));
  writeFileSync(join(d, 'good.md'), '---\nid: good\nstatus: queued\ntype: bug\n---\n');
  writeFileSync(join(d, 'bad.md'), '---\nid: bad\nstatus: queued\ntype: bug\nepic_role: bogus\n---\n');
  assert.throws(() => readItems(d), /bad\.md/);
});

test('readItems preserves project-local extension keys and nullable rank on validated items', () => {
  const d = mkdtempSync(join(tmpdir(), 'bl-ext-'));
  writeFileSync(join(d, 'a.md'), '---\nid: a\nstatus: shipped\ntype: bug\nvalidation_gate: "evidence"\nclosed: "2026-07-05"\nrank: null\n---\n');
  const [a] = readItems(d);
  assert.equal(a.validation_gate, 'evidence');
  assert.equal(a.rank, null);
});
