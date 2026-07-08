// runtime/adapters/claude-code/test/run-epic.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { driveEpic } from '../run-epic.mjs';

function sandbox({ otherEpicActive = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nf-re-'));
  const bd = join(root, 'docs', 'backlog'); mkdirSync(bd, { recursive: true });
  const item = (id, fm) => writeFileSync(join(bd, `${id}.md`), `---\nid: ${id}\n${fm}\n---\nbody\n`, 'utf8');
  item('e', 'type: epic\nstatus: active\ndone_when: members shipped');
  item('m1', 'type: refactor\nstatus: active\nepic: e\nepic_role: core\nscope: docs/**\nout_of_scope: [x]');
  if (otherEpicActive) item('e2', 'type: epic\nstatus: active\ndone_when: x');
  const cd = join(root, 'checks'); mkdirSync(cd, { recursive: true });
  return { root, bd, cd };
}

test('RE1 epic drives its core member, parks at the member execute floor (exit 3), records path:runtime', async () => {
  const { root, bd, cd } = sandbox();
  try {
    const j = inMemoryJournal();
    const capabilities = { journal: j,
      execute: async (t) => ({ taskId: t.id, status: 'paused', summary: 'awaits session executor',
        decision: { id: `execute:${t.id}`, question: 'q', options: [{ label: 'F', value: 'fulfil', recommended: true }] } }),
      ask: async () => ({ value: '<<HARNESS-PAUSE>>' }),
      runProcedure: async () => ({ status: 'done', findings: [] }) };
    const { exit, out } = await driveEpic({ epicId: 'e', backlogDir: bd, checksDir: cd, capabilities, headSha: 'S1' });
    assert.equal(exit, 3);                                   // parked at the first member's execute floor
    assert.equal(out.result.status, 'paused');
    assert.equal(out.result.decision.id, 'execute:m1');
    const prov = j.read('epic-e').steps.get('path:runtime');
    assert.equal(prov.value.path, 'runtime');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('RE2 unknown epic → exit 2', async () => {
  const { root, bd, cd } = sandbox();
  try {
    const { exit } = await driveEpic({ epicId: 'nope', backlogDir: bd, checksDir: cd,
      capabilities: { journal: inMemoryJournal() }, headSha: 'S1' });
    assert.equal(exit, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('RE3 non-epic id → exit 2 (use run-next for non-epic items)', async () => {
  const { root, bd, cd } = sandbox();
  try {
    const { exit } = await driveEpic({ epicId: 'm1', backlogDir: bd, checksDir: cd,
      capabilities: { journal: inMemoryJournal() }, headSha: 'S1' });
    assert.equal(exit, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('RE5 fulfil by the DECISION id (execute:m1) advances the member parked under member.m1', async () => {
  const { root, bd, cd } = sandbox();
  try {
    const j = inMemoryJournal();
    const capabilities = { journal: j,
      execute: async (t) => ({ taskId: t.id, status: 'paused', summary: 'awaits session executor',
        decision: { id: `execute:${t.id}`, question: 'q', options: [{ label: 'F', value: 'fulfil', recommended: true }] } }),
      ask: async () => ({ value: '<<HARNESS-PAUSE>>' }),
      runProcedure: async () => ({ status: 'done', findings: [] }) };
    const first = await driveEpic({ epicId: 'e', backlogDir: bd, checksDir: cd, capabilities, headSha: 'S1' });
    assert.equal(first.exit, 3);
    assert.equal(first.out.pending[0].key, 'member.m1');       // parked under the STEP key…
    assert.equal(first.out.pending[0].decision.id, 'execute:m1'); // …printing the coinciding decision id
    const second = await driveEpic({ epicId: 'e', backlogDir: bd, checksDir: cd, capabilities, headSha: 'S1',
      fulfil: { key: 'execute:m1', value: { taskId: 'm1', status: 'done', summary: 'worked in-session' } } });
    assert.equal(j.read('epic-e').steps.get('member.m1').status, 'complete');   // translated — no orphan step
    assert.equal(second.exit, 3);                              // advanced past the member to the merge floor
    assert.equal(second.out.result.decision.id, 'merge-e');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('RE4 rule-11: a DIFFERENT active epic → refuse (exit 2), spine not driven', async () => {
  const { root, bd, cd } = sandbox({ otherEpicActive: true });
  try {
    let executed = false;
    const capabilities = { journal: inMemoryJournal(),
      execute: async (t) => { executed = true; return { taskId: t.id, status: 'done', summary: 'ok' }; },
      ask: async () => ({ value: 'merge' }), runProcedure: async () => ({ status: 'done', findings: [] }) };
    const { exit, out } = await driveEpic({ epicId: 'e', backlogDir: bd, checksDir: cd, capabilities, headSha: 'S1' });
    assert.equal(exit, 2);
    assert.match(out.error, /rule-11|single active epic|e2/);
    assert.equal(executed, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
