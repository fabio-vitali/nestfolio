// scripts/parity-oracle/test/runtime-sandbox.test.mjs — the runtime-side sandbox must carry the
// runtime, a clean starter registry, the shared fixture store, and NO legacy skills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildRuntimeSandbox } from '../runtime-sandbox.mjs';
import { loadRegistry } from '../../../runtime/engine/lib/load-registry.mjs';

const scenario = { id: 'sbx-test', fixture: 'active-epic', prompt: 'noop' };

test('runtime sandbox: runtime/ present, starter registry clean, no legacy skills', async () => {
  const { dir, cleanup } = await buildRuntimeSandbox(scenario, 'HEAD');
  try {
    assert.ok(existsSync(join(dir, 'runtime/adapters/claude-code/run-item.mjs')));
    assert.ok(existsSync(join(dir, 'docs/backlog')));
    assert.ok(!existsSync(join(dir, '.claude/skills')), 'no legacy skills in the runtime sandbox');
    const reg = loadRegistry({ checksDir: join(dir, 'runtime/content/checks') });
    assert.equal(reg.errors.length, 0, JSON.stringify(reg.errors));
    const starter = readdirSync(join(dir, 'runtime/starter/checks')).filter((f) => f.endsWith('.yaml')).sort();
    const seeded = readdirSync(join(dir, 'runtime/content/checks')).filter((f) => f.endsWith('.yaml')).sort();
    assert.deepEqual(seeded, starter);
    for (const dep of ['yaml', 'zod']) assert.ok(existsSync(join(dir, 'node_modules', dep)), dep);
    const log = execFileSync('git', ['-C', dir, 'log', 'origin/main', '--oneline'], { encoding: 'utf8' });
    assert.ok(log.includes('sandbox baseline'));
  } finally { cleanup(); }
});

test('rtFixture override wins over the shared bef fixture', async () => {
  const { dir, cleanup } = await buildRuntimeSandbox({ ...scenario, rtFixture: 'rt-smoke' }, 'HEAD');
  try { assert.ok(existsSync(join(dir, 'docs/backlog/rt-smoke-item.md'))); } finally { cleanup(); }
});
