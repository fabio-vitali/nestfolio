import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'yaml';
import { driveThemes, applyThemeMutations } from '../run-themes.mjs';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { makeAsk } from '../ask.mjs';
import { makeExecute } from '../execute.mjs';
import { makeFanOut } from '../fan-out.mjs';
import { makeOnTrigger } from '../on-trigger.mjs';
import { makeRunProcedure } from '../run-procedure.mjs';

function tmpBacklog() {
  const root = mkdtempSync(join(tmpdir(), 'nf-themes-'));
  const dir = join(root, 'backlog'); mkdirSync(dir);
  for (const id of ['o1', 'o2']) writeFileSync(join(dir, `${id}.md`), `---\nid: ${id}\ntype: bug\nstatus: parking\n---\n# ${id}\n`, 'utf8');
  const checks = join(root, 'checks'); mkdirSync(checks);
  return { root, dir, checks };
}
const caps = (j) => ({ journal: j, ask: makeAsk({}), execute: makeExecute({}), fanOut: makeFanOut({}), onTrigger: makeOnTrigger({}), runProcedure: makeRunProcedure({}) });

test('applyThemeMutations mints an epic file and repoints an orphan', () => {
  const { root, dir } = tmpBacklog();
  try {
    applyThemeMutations({ backlogDir: dir,
      mints: [{ id: 'shared-cause', type: 'epic', status: 'parking', done_when: 'x', scope: '', out_of_scope: [] }],
      repoints: [{ id: 'o1', epic: 'shared-cause', epic_role: 'core' }] });
    const epic = yaml.parse(readFileSync(join(dir, 'shared-cause.md'), 'utf8').split('---')[1]);
    assert.equal(epic.type, 'epic');
    const o1 = yaml.parse(readFileSync(join(dir, 'o1.md'), 'utf8').split('---')[1]);
    assert.equal(o1.epic, 'shared-cause');
    assert.equal(o1.epic_role, 'core');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('driveThemes parks on the judgment then applies on fulfil', async () => {
  const { root, dir, checks } = tmpBacklog();
  try {
    const j = inMemoryJournal();
    const first = await driveThemes({ backlogDir: dir, checksDir: checks, capabilities: caps(j) });
    assert.equal(first.exit, 3); // parked on execute
    const route = { clusters: [{ themeId: 'shared-cause', action: 'mint', absorbs: ['o1', 'o2'] }] };
    const second = await driveThemes({ backlogDir: dir, checksDir: checks, capabilities: caps(j),
      fulfil: { key: 'execute:themes-2', value: { taskId: 'themes-2', status: 'done', summary: JSON.stringify(route) } } });
    assert.equal(second.exit, 0);
    assert.ok(second.out.written.some((p) => p.endsWith('shared-cause.md')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
