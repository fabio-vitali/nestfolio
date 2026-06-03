// node:test sibling for check-read-model-drift.mjs.
// Verifies the read-model ownership drift-checker: registry parse, call-site /
// command scans, the four drift rules, and the CLI exit codes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseRegistry,
  scanIntentCalls,
  scanCommandWrites,
  parseExclusions,
  evaluate,
} from './check-read-model-drift.mjs';

const SCRIPT = join(process.cwd(), 'tools/check-read-model-drift.mjs');

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'nf-rmdrift-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }
  return root;
}
function withTree(files, fn) {
  const root = makeTree(files);
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

// ---- Task 1: registry parse ----

test('parseRegistry reads P1/P2/P3/CommandOwned tags', () => {
  withTree({
    'services/x/x-bff/src/read-model-ownership.ts':
      `declare module '@nestfolio/event-processor' {\n  interface ReadModelOwnership {\n    Foo: Projection<'P1'>;\n    Bar: CommandOwned;\n    Baz: Projection<'P2'>;\n    Qux: Projection<'P3'>;\n  }\n}\n`,
  }, (root) => {
    const { registry, conflicts } = parseRegistry(root);
    assert.equal(registry['x-bff'].Foo.tag, 'P1');
    assert.equal(registry['x-bff'].Bar.tag, 'CommandOwned');
    assert.equal(registry['x-bff'].Baz.tag, 'P2');
    assert.equal(registry['x-bff'].Qux.tag, 'P3');
    assert.equal(conflicts.length, 0);
  });
});

test('parseRegistry flags a conflicting tag for the same typename', () => {
  withTree({
    'services/a/a-bff/src/read-model-ownership.ts':
      `interface ReadModelOwnership { Shared: Projection<'P1'>; }`,
    'services/a/a-bff/src/legacy-ownership.ts':
      `interface ReadModelOwnership { Shared: Projection<'P2'>; }`,
  }, (root) => {
    const { conflicts } = parseRegistry(root);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].typename, 'Shared');
  });
});

test('parseRegistry allows the same typename with the SAME tag in two files', () => {
  withTree({
    'services/a/a-bff/src/read-model-ownership.ts':
      `interface ReadModelOwnership { AdvisoryStatus: Projection<'P3'>; }`,
    'services/b/b-bff/src/read-model-ownership.ts':
      `interface ReadModelOwnership { AdvisoryStatus: Projection<'P3'>; }`,
  }, (root) => {
    const { conflicts, registry } = parseRegistry(root);
    assert.equal(conflicts.length, 0);
    assert.equal(registry['b-bff'].AdvisoryStatus.tag, 'P3');
  });
});

test('parseRegistry keys by (service, typename): same typename, different tag in DIFFERENT services is NOT a conflict', () => {
  withTree({
    'services/advisory/market-intelligence-ctrl/src/read-model-ownership.ts':
      `interface ReadModelOwnership { MarketSnapshot: CommandOwned; }`,
    'services/advisory/decision-workflow-ctrl/src/read-model-ownership.ts':
      `interface ReadModelOwnership { MarketSnapshot: Projection<'P1'>; }`,
  }, (root) => {
    const { conflicts, registry } = parseRegistry(root);
    assert.equal(conflicts.length, 0);
    assert.equal(registry['market-intelligence-ctrl'].MarketSnapshot.tag, 'CommandOwned');
    assert.equal(registry['decision-workflow-ctrl'].MarketSnapshot.tag, 'P1');
  });
});

test('parseRegistry flags a conflicting tag for the same typename WITHIN ONE service', () => {
  withTree({
    'services/a/a-bff/src/read-model-ownership.ts':
      `interface ReadModelOwnership { Shared: Projection<'P1'>; }`,
    'services/a/a-bff/src/other-ownership.ts':
      `interface ReadModelOwnership { Shared: Projection<'P2'>; }`,
  }, (root) => {
    const { conflicts } = parseRegistry(root);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].typename, 'Shared');
  });
});

test('R2 lookup is per-service: a P1 typename in service A does not constrain a project() in service B', () => {
  const { errors } = evalTree({
    'services/advisory/decision-workflow-ctrl/src/read-model-ownership.ts':
      `interface ReadModelOwnership { MarketSnapshot: Projection<'P1'>; }`,
    'services/advisory/decision-workflow-ctrl/src/t.ts':
      `projectVersioned('MarketSnapshot', {}, { version: 1 });`,
    'services/advisory/market-intelligence-ctrl/src/read-model-ownership.ts':
      `interface ReadModelOwnership { MarketSnapshot: CommandOwned; }`,
    'services/advisory/market-intelligence-ctrl/src/u.ts':
      `update('MarketSnapshot', {});`,
  });
  assert.equal(errors.length, 0, JSON.stringify(errors));
});

// ---- Task 2: scans ----

test('scanIntentCalls finds bare factory calls, ignores method/z calls', () => {
  withTree({
    'services/x/x-bff/src/transforms/t.ts':
      `projectVersioned('Foo', {}, { version: 1 });\n` +
      `record('Bar', {});\n` +
      `this.update('NotAFactory', {});\n` +
      `z.record(z.unknown());\n` +
      `createHash('sha256').update('|');\n` +
      `repo.record('AlsoNot', {});\n`,
    'services/x/x-bff/test/t.test.ts': `accumulate('IgnoredInTest', {});`,
  }, (root) => {
    const calls = scanIntentCalls(root);
    const byName = calls.map(c => `${c.factory}:${c.typename}`).sort();
    assert.deepEqual(byName, ['projectVersioned:Foo', 'record:Bar']);
  });
});

test('scanIntentCalls skips factory calls inside // and /* */ comments', () => {
  withTree({
    'services/x/x-bff/src/read-model-ownership.ts':
      `/**\n * Doc: the prior accumulate('AdvisoryStatus') no longer compiles.\n */\n` +
      `// record('Commented', {});\n` +
      `projectVersioned('Real', {}, { version: 1 });\n`,
  }, (root) => {
    const calls = scanIntentCalls(root);
    assert.deepEqual(calls.map(c => `${c.factory}:${c.typename}`), ['projectVersioned:Real']);
  });
});

test('scanCommandWrites finds __typename literals in *.fn.js', () => {
  withTree({
    'services/x/x-bff/src/graphql/js-function/initiate.fn.js':
      `export function request(ctx){ return { operation:'PutItem', attributeValues: { __typename: 'DepositIntent' } }; }`,
  }, (root) => {
    const cmds = scanCommandWrites(root);
    assert.deepEqual(cmds.map(c => c.typename), ['DepositIntent']);
  });
});

// ---- Task 3: the four rules ----

function evalTree(files) {
  return withTree(files, (root) => {
    const { registry, conflicts } = parseRegistry(root);
    const { exclusions } = parseExclusions(root);
    return evaluate(registry, conflicts, scanIntentCalls(root), scanCommandWrites(root), exclusions);
  });
}

test('R1: accumulate on a registered Projection is an error', () => {
  const { errors } = evalTree({
    'services/x/x-bff/src/read-model-ownership.ts': `interface ReadModelOwnership { Foo: Projection<'P1'>; }`,
    'services/x/x-bff/src/t.ts': `accumulate('Foo', {});`,
  });
  assert.equal(errors.filter(e => e.rule === 'accumulate-on-projection').length, 1);
});

test('R2: a P1 typename written by project() (no version guard) is an error', () => {
  const { errors } = evalTree({
    'services/x/x-bff/src/read-model-ownership.ts': `interface ReadModelOwnership { Foo: Projection<'P1'>; }`,
    'services/x/x-bff/src/t.ts': `project('Foo', {});`,
  });
  assert.equal(errors.filter(e => e.rule === 'p1-without-version-guard').length, 1);
});

test('R2: a P1 typename written by projectVersioned() is clean', () => {
  const { errors } = evalTree({
    'services/x/x-bff/src/read-model-ownership.ts': `interface ReadModelOwnership { Foo: Projection<'P1'>; }`,
    'services/x/x-bff/src/t.ts': `projectVersioned('Foo', {}, { version: 2 });`,
  });
  assert.equal(errors.length, 0);
});

test('R3: command + event-ongoing writer on the same typename is an error', () => {
  const { errors } = evalTree({
    'services/x/x-bff/src/graphql/js-function/c.fn.js': `const x = { __typename: 'Foo' };`,
    'services/x/x-bff/src/t.ts': `update('Foo', {});`,
  });
  assert.equal(errors.filter(e => e.rule === 'dual-writer').length, 1);
});

test('R3: command + record-only seed (CommandOwned) is the legit pattern, no error', () => {
  const { errors } = evalTree({
    'services/x/x-bff/src/read-model-ownership.ts': `interface ReadModelOwnership { Notification: CommandOwned; }`,
    'services/x/x-bff/src/graphql/js-function/mark-read.fn.js': `const x = { __typename: 'Notification' };`,
    'services/x/x-bff/src/seed.ts': `record('Notification', {});`,
  });
  assert.equal(errors.length, 0);
});

test('R4: a registry conflict surfaces as an error', () => {
  const { errors } = evalTree({
    'services/a/a-bff/src/read-model-ownership.ts': `interface ReadModelOwnership { Shared: Projection<'P1'>; }`,
    'services/a/a-bff/src/legacy.ts': `interface ReadModelOwnership { Shared: CommandOwned; }`,
  });
  assert.equal(errors.filter(e => e.rule === 'registry-conflict').length, 1);
});

test('R5: an unregistered + unexcluded intent-factory write is a HARD ERROR', () => {
  const { errors } = evalTree({
    'services/x/x-ctrl/src/t.ts': `record('Order', {});`,
  });
  assert.equal(errors.filter(e => e.rule === 'unclassified-write').length, 1);
});

test('R5: an EXCLUDED intent-factory write is clean (no error, no info)', () => {
  const { errors, info } = evalTree({
    'services/x/x-ctrl/src/t.ts': `record('Carrier', {});`,
    'tools/read-model-exclusions.json':
      `{ "exclusions": [ { "service": "x-ctrl", "typename": "Carrier", "reason": "outbox carrier" } ] }`,
  });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.ok(!info.some(i => i.typename === 'Carrier'));
});

test('R5: a REGISTERED intent-factory write is clean (no error)', () => {
  const { errors } = evalTree({
    'services/x/x-ctrl/src/read-model-ownership.ts': `interface ReadModelOwnership { Order: CommandOwned; }`,
    'services/x/x-ctrl/src/t.ts': `record('Order', {});`,
  });
  assert.equal(errors.length, 0, JSON.stringify(errors));
});

test('gate is intent-factory-scoped: an unregistered command-write is INFO, not an error', () => {
  const { errors, info } = evalTree({
    'services/x/x-bff/src/graphql/js-function/c.fn.js': `const x = { __typename: 'FeatureFlag' };`,
  });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.ok(info.some(i => i.typename === 'FeatureFlag'));
});

test('R6: a typename both registered AND excluded is a conflict error', () => {
  const { errors } = evalTree({
    'services/x/x-ctrl/src/read-model-ownership.ts': `interface ReadModelOwnership { Order: CommandOwned; }`,
    'services/x/x-ctrl/src/t.ts': `record('Order', {});`,
    'tools/read-model-exclusions.json':
      `{ "exclusions": [ { "service": "x-ctrl", "typename": "Order", "reason": "dup" } ] }`,
  });
  assert.equal(errors.filter(e => e.rule === 'exclusion-conflict').length, 1);
});

test('parseExclusions returns empty when the file is absent', () => {
  withTree({ 'services/x/x-bff/src/t.ts': `record('A', {});` }, (root) => {
    const { exclusions, entries } = parseExclusions(root);
    assert.equal(exclusions.size, 0);
    assert.equal(entries.length, 0);
  });
});

test('parseExclusions throws on an entry missing service/typename/reason', () => {
  withTree({
    'tools/read-model-exclusions.json': `{ "exclusions": [ { "typename": "A" } ] }`,
  }, (root) => {
    assert.throws(() => parseExclusions(root), /read-model-exclusions\.json/);
  });
});

// ---- CLI exit codes ----

test('CLI exits 0 on a clean registered tree', () => {
  withTree({
    'services/x/x-bff/src/read-model-ownership.ts': `interface ReadModelOwnership { Foo: Projection<'P1'>; }`,
    'services/x/x-bff/src/t.ts': `projectVersioned('Foo', {}, { version: 1 });`,
  }, (root) => {
    const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  });
});

test('CLI exits 1 and names the typename on drift', () => {
  withTree({
    'services/x/x-bff/src/read-model-ownership.ts': `interface ReadModelOwnership { Foo: Projection<'P1'>; }`,
    'services/x/x-bff/src/t.ts': `accumulate('Foo', {});`,
  }, (root) => {
    const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /Foo/);
  });
});

test('CLI exits 1 on an unregistered + unexcluded intent-factory write', () => {
  withTree({
    'services/x/x-ctrl/src/t.ts': `record('Ungoverned', {});`,
  }, (root) => {
    const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 1, `stdout: ${r.stdout}`);
    assert.match(r.stdout + r.stderr, /Ungoverned/);
  });
});

test('CLI exits 0 when the write is excluded', () => {
  withTree({
    'services/x/x-ctrl/src/t.ts': `record('Ungoverned', {});`,
    'tools/read-model-exclusions.json':
      `{ "exclusions": [ { "service": "x-ctrl", "typename": "Ungoverned", "reason": "carrier" } ] }`,
  }, (root) => {
    const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  });
});
