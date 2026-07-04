import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runShipRecheck, readBranchDelta, recordGateClean } from '../ship-recheck.mjs';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';

const trigger = { on: 'commit', contexts: ['invariant', 'gate'], cost_ceiling: 'cheap' };
const registry = { checks: [], byId: new Map(), errors: [] };
const fakeWatch = async ({ changedScope }) => changedScope.some((p) => p.includes('bad'))
  ? [{ id: 'no-x#0', check: 'no-x', kind: 'drift', scope: ['bad.ts'], detail: 'X', raised_at: 't' }] : [];

test('SR1 dirty branch delta → exit 1 with findings', async () => {
  const r = await runShipRecheck({ changedFiles: ['services/x/bad.ts'], registry, trigger, watch: fakeWatch });
  assert.equal(r.exitCode, 1);
  assert.equal(r.findings[0].check, 'no-x');
});

test('SR2 clean delta → exit 0, no findings', async () => {
  const r = await runShipRecheck({ changedFiles: ['services/x/good.ts'], registry, trigger, watch: fakeWatch });
  assert.equal(r.exitCode, 0);
});

test('SR3 recordGateClean stamps sha+base+ts under ship:<item>:gate-clean on runId backward', () => {
  const j = inMemoryJournal();
  recordGateClean({ journal: j, item: 'ws-1', sha: 'deadbeef', base: 'origin/main', ts: 'T' });
  assert.deepEqual(j.read('backward').steps.get('ship:ws-1:gate-clean').value, { sha: 'deadbeef', base: 'origin/main', ts: 'T' });
});

test('SR4 readBranchDelta uses ACMR diff-filter against <base>..HEAD', () => {
  let cmd;
  const out = readBranchDelta('origin/main', (c) => { cmd = c; return 'a.ts\nb.ts\n\n'; });
  assert.deepEqual(out, ['a.ts', 'b.ts']);
  assert.match(cmd, /--diff-filter=ACMR origin\/main\.\.HEAD/);
});
