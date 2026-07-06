import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts/check-service-structure.sh');

function svc(root, name, { project = true, stack = true, testdir = true } = {}) {
  const dir = join(root, 'services/demo', name);
  mkdirSync(join(dir, 'src'), { recursive: true });
  if (project) writeFileSync(join(dir, 'project.json'), '{}');
  if (stack) writeFileSync(join(dir, 'src/service.stack.ts'), 'export {}');
  if (testdir) mkdirSync(join(dir, 'test'), { recursive: true });
}
const run = (cwd, staged) =>
  spawnSync('bash', [SCRIPT], { cwd, encoding: 'utf8',
    env: { ...process.env, RUNTIME_STAGED_PATHS: staged } });

test('well-formed service → exit 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'svc-'));
  svc(root, 'demo-ctrl');
  const r = run(root, 'services/demo/demo-ctrl/project.json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('missing project.json → exit 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'svc-'));
  svc(root, 'demo-ctrl', { project: false });
  const r = run(root, 'services/demo/demo-ctrl/src/service.stack.ts');
  assert.equal(r.status, 1);
});

test('bad name suffix → exit 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'svc-'));
  svc(root, 'demo-widget');
  const r = run(root, 'services/demo/demo-widget/project.json');
  assert.equal(r.status, 1);
});
