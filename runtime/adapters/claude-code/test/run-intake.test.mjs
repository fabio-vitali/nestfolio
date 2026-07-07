// runtime/adapters/claude-code/test/run-intake.test.mjs — driveIntake park/fulfil semantics: the
// selectRoute judgment parks via the journal-stepped execute; a fulfilled TaskResult (summary = route
// JSON) replays through selectRoute; the driver writes the shaped items deterministically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { driveIntake } from '../run-intake.mjs';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { makeExecute } from '../execute.mjs';

const finding = { id: 'f1', check: 'demo-check', kind: 'gap', scope: ['docs/**'], detail: 'demo gap finding' };

function caps() { return { execute: makeExecute({}), journal: inMemoryJournal() }; }

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'run-intake-'));
  mkdirSync(join(dir, 'backlog'), { recursive: true });
  mkdirSync(join(dir, 'checks'), { recursive: true });
  writeFileSync(join(dir, 'checks/demo.yaml'),
    'id: demo-check\nproperty: "demo"\nkind: gap\nevaluator: { type: deterministic, run: "cmd:true" }\ncost_tier: cheap\ncontexts: [audit]\nscope: { paths: ["docs/**"] }\nstatus: active\nprovenance: { minted_by: "test" }\n');
  return dir;
}

test('first invocation parks on the intake execute (exit 3, pending key by construction)', async () => {
  const dir = tmpStore();
  const r = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: caps() });
  assert.equal(r.exit, 3);
  assert.equal(r.out.pending[0].key, 'execute:intake-f1');
});

test('fulfilled route JSON → items written with epic/epic_role; journal filed record (exit 0)', async () => {
  const dir = tmpStore();
  const c = caps();
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: c });
  const taskResult = { taskId: 'intake-f1', status: 'done', summary: JSON.stringify({ route: 'fold', epic: 'acme-epic', epicRole: 'core' }) };
  const r2 = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: taskResult }, capabilities: c, regenIndex: () => {} });
  assert.equal(r2.exit, 0, JSON.stringify(r2.out));
  const file = join(dir, 'backlog/from-demo-check.md');
  assert.ok(existsSync(file));
  const text = readFileSync(file, 'utf8');
  assert.match(text, /epic: acme-epic/);
  assert.match(text, /epic_role: core/);
  assert.match(text, /from_finding: f1/);
  const filed = c.journal.read('intake-f1').steps.get('intake:f1:filed');
  assert.equal(filed.value.route, 'fold');
});

test('malformed route JSON in the fulfilled summary → exit 1, not a crash', async () => {
  const dir = tmpStore();
  const c = caps();
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: c });
  const r2 = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: { taskId: 'intake-f1', status: 'done', summary: 'not json' } }, capabilities: c });
  assert.equal(r2.exit, 1);
  assert.ok(String(r2.out.error).length > 0);
});

test('a driven intake journals a path:runtime provenance record', async () => {
  const dir = tmpStore();
  const c = caps();
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: c });
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: { taskId: 'intake-f1', status: 'done', summary: JSON.stringify({ route: 'orphan' }) } }, capabilities: c, regenIndex: () => {} });
  const step = c.journal.read('intake-f1').steps.get('path:runtime');
  assert.equal(step?.value?.path, 'runtime');
  assert.equal(step.value.workstream, 'f1');
});

test('after writing items, the lint --fix index-regen side-car runs once', async () => {
  const dir = tmpStore();
  const c = caps();
  let calls = 0;
  const regenIndex = () => { calls += 1; };
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: c, regenIndex });
  const r2 = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: { taskId: 'intake-f1', status: 'done', summary: JSON.stringify({ route: 'orphan' }) } }, capabilities: c, regenIndex });
  assert.equal(r2.exit, 0, JSON.stringify(r2.out));
  assert.equal(calls, 1);
});

test('a discard route writes nothing, so the side-car does NOT run', async () => {
  const dir = tmpStore();
  const c = caps();
  let calls = 0;
  const regenIndex = () => { calls += 1; };
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: c, regenIndex });
  const r2 = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: { taskId: 'intake-f1', status: 'done', summary: JSON.stringify({ route: 'discard' }) } }, capabilities: c, regenIndex });
  assert.equal(r2.exit, 0);
  assert.equal(calls, 0);
});

test('a side-car failure surfaces as exit 1 (not swallowed)', async () => {
  const dir = tmpStore();
  const c = caps();
  const regenIndex = () => { throw new Error('lint rule 9 violated'); };
  await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'), capabilities: c, regenIndex });
  const r2 = await driveIntake({ finding, backlogDir: join(dir, 'backlog'), checksDir: join(dir, 'checks'),
    fulfil: { key: 'execute:intake-f1', value: { taskId: 'intake-f1', status: 'done', summary: JSON.stringify({ route: 'orphan' }) } }, capabilities: c, regenIndex });
  assert.equal(r2.exit, 1);
  assert.match(String(r2.out.error), /lint rule 9/);
});
