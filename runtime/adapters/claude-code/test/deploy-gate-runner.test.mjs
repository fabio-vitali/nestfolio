// runtime/adapters/claude-code/test/deploy-gate-runner.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDeployGate } from '../deploy-gate-runner.mjs';

// fake sh: records commands, returns status per a script map
const fakeSh = (statusFor) => { const ran = []; return { ran, run: (cmd) => { ran.push(cmd); return { status: statusFor(cmd) }; } }; };

test('DGR1 no diff → ok, nothing run', async () => {
  const sh = fakeSh(() => 0);
  const r = await runDeployGate({ base: 'origin/main', sh: sh.run, diffOf: () => [] });
  assert.equal(r.ok, true);
  assert.deepEqual(sh.ran, []);
});

test('DGR2 code diff, all green → deploy + integration run, ok', async () => {
  const sh = fakeSh(() => 0);
  const r = await runDeployGate({ base: 'origin/main', sh: sh.run,
    diffOf: () => ['services/a/a-ctrl/src/h.ts'] });
  assert.equal(r.ok, true);
  assert.ok(sh.ran.some((c) => c.includes('deploy.sh')));
});

test('DGR3 deploy fails → not ok, stage deploy', async () => {
  const sh = fakeSh((c) => (c.includes('deploy.sh') ? 2 : 0));
  const r = await runDeployGate({ base: 'origin/main', sh: sh.run,
    diffOf: () => ['services/a/a-ctrl/src/h.ts'] });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'deploy');
});
