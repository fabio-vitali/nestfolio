// tools/check-typed-fixtures.test.mjs — node:test sibling for check-typed-fixtures.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { scanFile, stripComments } from './check-typed-fixtures.mjs';

const REG = new Set(['BALANCE_UPDATED', 'ALPACA_ORDER_FILLED']);
const F = 'services/x/x-ctrl/test/integration/x.integration.test.ts';
const GATE = join(process.cwd(), 'tools/check-typed-fixtures.mjs');

// Build a temp repo-root tree and run the gate CLI against it via --root (hermetic).
function withTree(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'nf-tfix-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const REGISTRY_JSON = JSON.stringify({ registeredEvents: ['BALANCE_UPDATED'] });

test('registered literal detailType + detail: → violation', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'BALANCE_UPDATED', detail: { x: 1 } });`;
  const { violations } = scanFile(F, src, REG);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /BALANCE_UPDATED — legacy putEvent/);
});

test('member detailType whose trailing name is not registered → clean (note only)', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: BrokerCtrlEventTypes.ORDER_FILLED, detail: { x: 1 } });`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /compound detailType 'BrokerCtrlEventTypes.ORDER_FILLED'/);
});

test('typed form (registered literal, no detail:) → clean', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'BALANCE_UPDATED', subject: { cashBalanceCents: 1 } });`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 0);
});

test('bare literal not in registry + detail: → clean', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'ORDER_REJECTED', detail: { x: 1 } });`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 0);
});

test('.subject as T cast inside putEvent → violation', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'BALANCE_UPDATED', subject: payload.subject as Foo });`;
  const { violations } = scanFile(F, src, REG);
  assert.ok(violations.some((v) => /cast inside putEvent fixture/.test(v)));
});

test('CLI exits 0 on a clean tree (typed fixture)', () => {
  withTree({
    'tools/typed-fixture-registered-events.json': REGISTRY_JSON,
    'services/x/x-ctrl/test/x.test.ts': `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'BALANCE_UPDATED', subject: { cashBalanceCents: 1 } });`,
  }, (root) => {
    const r = spawnSync('node', [GATE, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 0);
  });
});

test('CLI exits 1 on a dynamic-detailType tree', () => {
  withTree({
    'tools/typed-fixture-registered-events.json': REGISTRY_JSON,
    'services/x/x-ctrl/test/x.test.ts': `await eb.putEvent({ bus: 'b', targetService: 's', detailType, detail });`,
  }, (root) => {
    const r = spawnSync('node', [GATE, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /dynamic detailType/);
  });
});

test('dynamic detailType (bare variable) + detail: → violation', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType, detail });`;
  const { violations } = scanFile(F, src, REG);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /dynamic detailType/);
});

test('dynamic detailType with NO detail: key also → violation (absolute ban)', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType, subject: makeSubject() });`;
  const { violations } = scanFile(F, src, REG);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /dynamic detailType/);
});

test('putEvent inside a // line comment → ignored', () => {
  const src = `// await eb.putEvent({ detailType, detail });\nconst x = 1;`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 0);
});

test('putEvent inside a /* block comment */ → ignored', () => {
  const src = `/*\n  await eb.putEvent({ detailType, detail });\n*/\nconst x = 1;`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 0);
});

test('stripComments preserves line count and string content containing //', () => {
  const src = `const u = 'http://x'; // trailing\nawait eb.putEvent({ detailType: 'BALANCE_UPDATED', detail: {} });`;
  const stripped = stripComments(src);
  assert.equal(stripped.split('\n').length, src.split('\n').length);
  assert.match(stripped, /'http:\/\/x'/);
  const { violations } = scanFile(F, src, REG);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /:2:/);
});
