import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkFiles, runGate, parseExclusions, lineOf, parseRootArg } from './text-scan.mjs';

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'nf-scan-'));
  for (const [rel, contents] of Object.entries(files)) { const abs = join(root, rel); mkdirSync(join(abs, '..'), { recursive: true }); writeFileSync(abs, contents, 'utf8'); }
  return root;
}
const clean = (root) => rmSync(root, { recursive: true, force: true });

test('TS1 walkFiles yields .ts under services/, skips node_modules + (excludeTest) test/', () => {
  const root = tree({ 'services/x/src/a.ts': 'A', 'services/x/test/b.ts': 'B', 'services/x/node_modules/c.ts': 'C', 'services/x/src/d.js': 'D' });
  try {
    const rels = [...walkFiles(root, { includeUnder: ['services'], ext: ['.ts'], excludeTest: true })].map((f) => f.relPath).sort();
    assert.deepEqual(rels, ['services/x/src/a.ts']);
  } finally { clean(root); }
});

test('TS2 runGate aggregates a predicate across files', () => {
  const root = tree({ 'services/x/src/a.ts': 'bad\nbad', 'services/x/src/b.ts': 'ok' });
  try {
    const v = runGate(root, (text, relPath) => text.includes('bad') ? [{ rule: 'r', relPath, line: 1, token: 'bad' }] : [], { includeUnder: ['services'] });
    assert.equal(v.length, 1);
    assert.equal(v[0].relPath, 'services/x/src/a.ts');
  } finally { clean(root); }
});

test('TS3 parseExclusions reads {path,reason}, absent file → empty, bad entry throws', () => {
  const root = tree({ 'tools/x-exclusions.json': '{"exclusions":[{"path":"services/x/src/ok.ts","reason":"vetted"}]}' });
  try {
    assert.deepEqual([...parseExclusions(root, 'tools/x-exclusions.json')], ['services/x/src/ok.ts']);
    assert.equal(parseExclusions(root, 'tools/missing.json').size, 0);
  } finally { clean(root); }
  const bad = tree({ 'tools/b.json': '{"exclusions":[{"path":"p"}]}' });
  try { assert.throws(() => parseExclusions(bad, 'tools/b.json'), /reason/); } finally { clean(bad); }
});

test('TS4 lineOf + parseRootArg', () => {
  assert.equal(lineOf('a\nb\nc', 4), 3);
  assert.equal(parseRootArg(['node', 's', '--root', '/tmp/x']), '/tmp/x');
});
