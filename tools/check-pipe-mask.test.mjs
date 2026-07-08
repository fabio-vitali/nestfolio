import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findViolations } from './check-pipe-mask.mjs';

const FX = 'runtime/eval/scenarios/fixtures/no-pipe-exit-masking';
const SCRIPT = join(process.cwd(), 'tools/check-pipe-mask.mjs');
// A cmd check receives the WHOLE staged set and self-scopes to scripts/**|infrastructure/scripts/** *.sh,
// so the golden-gate synthetic path must be an in-scope one for the fixture to be evaluated at all.
const rel = (f) => `scripts/${f}`;

test('PM1 golden gate: every GOOD fixture → 0 violations', () => {
  for (const f of readdirSync(`${FX}/good`)) assert.equal(findViolations(readFileSync(`${FX}/good/${f}`, 'utf8'), rel(f)).length, 0, f);
});
test('PM2 golden gate: every BAD fixture → ≥1 violation', () => {
  for (const f of readdirSync(`${FX}/bad`)) assert.ok(findViolations(readFileSync(`${FX}/bad/${f}`, 'utf8'), rel(f)).length >= 1, f);
});
test('PM3 a .sh outside scripts/ or infrastructure/scripts/ is ignored', () => {
  assert.equal(findViolations('npm test | tee /tmp/x.log', 'services/x/deploy.sh').length, 0);
});
test('PM4 a non-.sh file is ignored', () => {
  assert.equal(findViolations('npm test | tee /tmp/x.log', 'scripts/build.ts').length, 0);
});
test('PM5 pipefail OR PIPESTATUS both count as guarded', () => {
  assert.equal(findViolations('cmd | tee out; test ${PIPESTATUS[0]} -eq 0', 'scripts/a.sh').length, 0);
  assert.equal(findViolations('set -o pipefail\ncmd | tail -1', 'scripts/b.sh').length, 0);
});
test('PM8 JS sh-string pipeline (execSync/spawnSync/sh seam) → violation (the deploy-gate false-green class)', () => {
  const text = 'const t = sh(`node tools/affected-projects.mjs --base=x | paste -sd, - | xargs -r -I{} pnpm nx run-many -p {}`);';
  assert.equal(findViolations(text, 'runtime/adapters/claude-code/deploy-gate-runner.mjs').length, 1);
  assert.equal(findViolations('execSync(`git log | head -5`)', 'tools/x.mjs').length, 1);
  assert.equal(findViolations("spawnSync('a | tee out', {shell:true})", '.claude/skills/backlog-next/x.mjs').length, 1);
});
test('PM9 JS sh-string pipeline guarded by pipefail/PIPESTATUS → clean', () => {
  assert.equal(findViolations('sh(`set -o pipefail; a | b`)', 'runtime/adapters/x.mjs').length, 0);
});
test('PM10 JS pipeline in test files or eval fixtures → ignored (bad examples live there)', () => {
  const text = 'sh(`a | b`)';
  assert.equal(findViolations(text, 'runtime/adapters/claude-code/test/deploy-gate-runner.test.mjs').length, 0);
  assert.equal(findViolations(text, 'runtime/eval/scenarios/fixtures/no-pipe-exit-masking/bad/x.mjs').length, 0);
});
test('PM11 JS without an exec-seam call or without a pipeline → clean; non-JS-root ignored', () => {
  assert.equal(findViolations('const shOut = (cmd) => spawnSync(cmd, { shell: true });', 'runtime/adapters/x.mjs').length, 0);
  assert.equal(findViolations('const re = /a \\| b/; sh(`node run.mjs --flag`)', 'tools/y.mjs').length, 0);
  assert.equal(findViolations('sh(`a | b`)', 'apps/investor-web/src/x.mjs').length, 0);
});
test('PM12 CLI exits 1 on a staged JS sh-string pipeline', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-pm-'));
  try {
    mkdirSync(join(root, 'runtime/adapters'), { recursive: true });
    writeFileSync(join(root, 'runtime/adapters/gate.mjs'), 'sh(`node resolve.mjs | xargs -r run`)', 'utf8');
    const r = spawnSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', env: { ...process.env, RUNTIME_STAGED_PATHS: 'runtime/adapters/gate.mjs' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /runtime\/adapters\/gate\.mjs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('PM6 CLI exits 1 and names the file on a masked pipe (staged scope)', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-pm-'));
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts/a.sh'), '#!/bin/bash\nnpm test | tee out.log', 'utf8');
    const r = spawnSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', env: { ...process.env, RUNTIME_STAGED_PATHS: 'scripts/a.sh' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /scripts\/a\.sh/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('PM7 CLI exits 0 when the pipe is guarded (staged scope)', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-pm-'));
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts/a.sh'), '#!/bin/bash\nset -o pipefail\nnpm test | tee out.log', 'utf8');
    const r = spawnSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', env: { ...process.env, RUNTIME_STAGED_PATHS: 'scripts/a.sh' } });
    assert.equal(r.status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
