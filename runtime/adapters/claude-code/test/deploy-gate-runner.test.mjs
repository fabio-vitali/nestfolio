// runtime/adapters/claude-code/test/deploy-gate-runner.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDeployGate, dotenvAwsProfile } from '../deploy-gate-runner.mjs';

// fake sh: records commands, returns status per a script map
const fakeSh = (statusFor) => { const ran = []; return { ran, run: (cmd) => { ran.push(cmd); return { status: statusFor(cmd) }; } }; };
// fake shOut: records commands, returns {status, stdout} per a script map
const fakeShOut = (resultFor) => { const ran = []; return { ran, run: (cmd) => { ran.push(cmd); return resultFor(cmd); } }; };
const ENV = { AWS_PROFILE: 'test' };

test('DGR1 no diff → ok, nothing run', async () => {
  const sh = fakeSh(() => 0);
  const r = await runDeployGate({ base: 'origin/main', sh: sh.run, diffOf: () => [], env: ENV });
  assert.equal(r.ok, true);
  assert.deepEqual(sh.ran, []);
});

test('DGR2 code diff, all green → deploy + resolved integration run, ok', async () => {
  const sh = fakeSh(() => 0);
  const shOut = fakeShOut(() => ({ status: 0, stdout: 'svc-a-integration\n' }));
  const r = await runDeployGate({ base: 'origin/main', sh: sh.run, shOut: shOut.run,
    diffOf: () => ['services/a/a-ctrl/src/h.ts'], env: ENV });
  assert.equal(r.ok, true);
  assert.ok(sh.ran.some((c) => c.includes('deploy.sh')));
  assert.ok(shOut.ran.some((c) => c.includes('affected-projects.mjs') && c.includes('--with-target=test-integration')));
  assert.ok(sh.ran.some((c) => c.includes('nx run-many -t test-integration -p svc-a-integration')));
});

test('DGR3 deploy fails → not ok, stage deploy', async () => {
  const sh = fakeSh((c) => (c.includes('deploy.sh') ? 2 : 0));
  const shOut = fakeShOut(() => ({ status: 0, stdout: '' }));
  const r = await runDeployGate({ base: 'origin/main', sh: sh.run, shOut: shOut.run,
    diffOf: () => ['services/a/a-ctrl/src/h.ts'], env: ENV });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'deploy');
});

test('DGR4 resolver crashes → not ok, stage integration-resolve, nx never run (the silent-green regression)', async () => {
  const sh = fakeSh(() => 0);
  const shOut = fakeShOut(() => ({ status: 1, stdout: '' }));
  const r = await runDeployGate({ base: 'origin/main', sh: sh.run, shOut: shOut.run,
    diffOf: () => ['services/a/a-ctrl/src/h.ts'], env: ENV });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'integration-resolve');
  assert.ok(!sh.ran.some((c) => c.includes('nx run-many')));
});

test('DGR5 resolver green but empty list → ok, nx explicitly skipped', async () => {
  const sh = fakeSh(() => 0);
  const shOut = fakeShOut(() => ({ status: 0, stdout: '\n' }));
  const r = await runDeployGate({ base: 'origin/main', sh: sh.run, shOut: shOut.run,
    diffOf: () => ['services/a/a-ctrl/src/h.ts'], env: ENV });
  assert.equal(r.ok, true);
  assert.ok(!sh.ran.some((c) => c.includes('nx run-many')));
});

test('DGR6 integration tests fail → not ok, stage integration, projects joined into -p', async () => {
  const sh = fakeSh((c) => (c.includes('nx run-many') ? 3 : 0));
  const shOut = fakeShOut(() => ({ status: 0, stdout: 'p1\np2\n' }));
  const r = await runDeployGate({ base: 'origin/main', sh: sh.run, shOut: shOut.run,
    diffOf: () => ['services/a/a-ctrl/src/h.ts'], env: ENV });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'integration');
  assert.ok(sh.ran.some((c) => c.includes('-p p1,p2')));
});

test('DGR7 missing AWS creds → warns before deploy; present → silent', async () => {
  const warned = [];
  const sh = fakeSh(() => 0);
  const shOut = fakeShOut(() => ({ status: 0, stdout: '' }));
  await runDeployGate({ base: 'origin/main', sh: sh.run, shOut: shOut.run,
    diffOf: () => ['services/a/a-ctrl/src/h.ts'], env: {}, warn: (m) => warned.push(m) });
  assert.equal(warned.length, 1);
  assert.ok(warned[0].includes('AWS_PROFILE'));
  warned.length = 0;
  await runDeployGate({ base: 'origin/main', sh: sh.run, shOut: shOut.run,
    diffOf: () => ['services/a/a-ctrl/src/h.ts'], env: ENV, warn: (m) => warned.push(m) });
  assert.equal(warned.length, 0);
});

test('DGR8 dotenvAwsProfile reads AWS_PROFILE from .env; absent → null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dgr8-'));
  try {
    writeFileSync(join(dir, '.env'), '# creds\nAWS_PROFILE=nestfolio-dev\nOTHER=x\n');
    assert.equal(dotenvAwsProfile(dir), 'nestfolio-dev');
    const empty = mkdtempSync(join(tmpdir(), 'dgr8-empty-'));
    try { assert.equal(dotenvAwsProfile(empty), null); } finally { rmSync(empty, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
