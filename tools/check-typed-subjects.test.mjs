// node:test sibling for check-typed-subjects.mjs.
// Verifies the typed-subject gate: per-rule detection, the cross-domain-import rule,
// the exclusion registry, platform-seam path exclusion, and CLI exit codes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  scanTree, scanFile, scanCrossDomainImports, buildServiceDomains, parseExclusions, evaluate,
} from './check-typed-subjects.mjs';

const SCRIPT = join(process.cwd(), 'tools/check-typed-subjects.mjs');

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'nf-tsubj-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }
  return root;
}
function withTree(files, fn) {
  const root = makeTree(files);
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('C1: flags `.subject as Record<string,unknown>`', () => {
  const hits = scanFile('services/x/x-ctrl/src/handlers/h.ts',
    `const s = payload.subject as Record<string, unknown>;`);
  assert.equal(hits.filter(h => h.rule === 'subject-cast').length, 1);
});

test('C1: flags `(event.subject ?? event) as Record` and a bare `subject as Record`', () => {
  const a = scanFile('services/x/x-ctrl/src/agent-service.ts',
    `const subject = (event.subject ?? event) as Record<string, unknown>;`);
  assert.equal(a.filter(h => h.rule === 'subject-cast').length, 1);
  const b = scanFile('services/x/x-ctrl/src/handlers/kb.ts',
    `buildFeedContent(t, subject as Record<string, unknown>);`);
  assert.equal(b.filter(h => h.rule === 'subject-cast').length, 1);
});

test('C1: does NOT flag parseSubject or a non-subject (.payload) read', () => {
  const hits = scanFile('services/x/x-ctrl/src/handlers/h.ts',
    `const s = parseSubject(uow, FooSchema);\nconst p = entry.payload as Record<string, unknown>;`);
  assert.equal(hits.filter(h => h.rule === 'subject-cast').length, 0);
});

test('C2: flags cross-domain /contracts; not intra-domain or *-adpt/domain', () => {
  const sd = { 'ledger-ctrl': 'ledger', 'dashboard-bff': 'investor', 'investor-bff': 'investor', 'ledger-adpt': 'ledger' };
  const cross = scanCrossDomainImports('services/investor/dashboard-bff/src/t.ts',
    `import { X } from '@nestfolio/ledger-ctrl/contracts';`, sd);
  assert.equal(cross.length, 1);
  assert.equal(cross[0].rule, 'cross-domain-import');
  const intra = scanCrossDomainImports('services/investor/dashboard-bff/src/t.ts',
    `import { X } from '@nestfolio/investor-bff/contracts';`, sd);
  assert.equal(intra.length, 0);
  const adapter = scanCrossDomainImports('services/investor/dashboard-bff/src/t.ts',
    `import { X } from '@nestfolio/ledger-adpt/domain';`, sd);
  assert.equal(adapter.length, 0);
  const events = scanCrossDomainImports('services/advisory/decision-workflow-ctrl/src/t.ts',
    `import { Y } from '@nestfolio/ledger-ctrl/events';`, { 'ledger-ctrl': 'ledger', 'decision-workflow-ctrl': 'advisory' });
  assert.equal(events.length, 1);
});

test('C2: buildServiceDomains maps service->domain from the layout', () => {
  withTree({
    'services/ledger/ledger-ctrl/project.json': '{}',
    'services/investor/dashboard-bff/project.json': '{}',
  }, (root) => {
    const sd = buildServiceDomains(root);
    assert.equal(sd['ledger-ctrl'], 'ledger');
    assert.equal(sd['dashboard-bff'], 'investor');
  });
});

test('C4: flags a Subject-suffixed contract name in a contracts file', () => {
  const hits = scanFile('services/x/x-ctrl/src/domain/contracts.ts',
    `export const FooSubjectSchema = z.object({});\nexport type FooSubject = z.infer<typeof FooSubjectSchema>;`);
  assert.equal(hits.filter(h => h.rule === 'subject-suffix').length, 2);
});

test('C4: does NOT flag a clean contract name', () => {
  const hits = scanFile('services/x/x-ctrl/src/domain/contracts.ts',
    `export const FooSchema = z.object({});\nexport type Foo = z.infer<typeof FooSchema>;`);
  assert.equal(hits.filter(h => h.rule === 'subject-suffix').length, 0);
});

test('OPAQUE: flags a reintroduced opaqueSubject', () => {
  const hits = scanFile('services/x/x-ctrl/src/handlers/h.ts', `const s = opaqueSubject(payload);`);
  assert.equal(hits.filter(h => h.rule === 'opaque-subject').length, 1);
});

test('C3: flags an inline pk/sk/__typename row; not a TableEntry row', () => {
  const inlineHits = scanFile('services/x/x-ctrl/src/domain/models.ts',
    `export interface FooRow {\n  pk: string;\n  sk: string;\n  __typename: 'Foo';\n  value: number;\n}`);
  assert.equal(inlineHits.filter(h => h.rule === 'inline-row').length, 1);
  const tableEntryHits = scanFile('services/x/x-ctrl/src/domain/models.ts',
    `export type FooRow = TableEntry<Foo, RequestContext> & {\n  pk: string;\n  sk: string;\n  __typename: 'Foo';\n};`);
  assert.equal(tableEntryHits.filter(h => h.rule === 'inline-row').length, 0);
});

test('evaluate: platform seam C1 hits are path-excluded', () => {
  const hits = scanFile('libs/event-processor/src/util/to-uow.ts',
    `subject: payload.subject as Record<string, unknown>,`);
  assert.equal(hits.filter(h => h.rule === 'subject-cast').length, 1);
  assert.equal(evaluate(hits, new Set()).length, 0);
});

test('evaluate: a registry-excluded file suppresses its rule', () => {
  const hits = scanFile('services/x/x-ctrl/src/handlers/kb.ts',
    `const c = thing.subject as Record<string, unknown>;`);
  const ex = new Set(['subject-cast::services/x/x-ctrl/src/handlers/kb.ts']);
  assert.equal(evaluate(hits, ex).length, 0);
});

test('parseExclusions rejects an entry missing reason', () => {
  withTree({ 'tools/typed-subject-exclusions.json':
    JSON.stringify({ exclusions: [{ rule: 'subject-cast', file: 'a.ts' }] }) }, (root) => {
    assert.throws(() => parseExclusions(root), /needs non-empty/);
  });
});

test('CLI: exit 0 on a clean tree, exit 1 on a violation', () => {
  const clean = makeTree({ 'services/x/x-ctrl/src/h.ts': `const s = parseSubject(u, S);` });
  try {
    const ok = spawnSync('node', [SCRIPT, '--root', clean], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  } finally { rmSync(clean, { recursive: true, force: true }); }

  const bad = makeTree({ 'services/x/x-ctrl/src/h.ts': `const s = payload.subject as Record<string, unknown>;` });
  try {
    const fail = spawnSync('node', [SCRIPT, '--root', bad], { encoding: 'utf8' });
    assert.equal(fail.status, 1, fail.stdout + fail.stderr);
    assert.match(fail.stderr, /subject-cast/);
  } finally { rmSync(bad, { recursive: true, force: true }); }
});
