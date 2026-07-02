import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('ring-1 (runtime/engine) never imports an adapter, a skill, or shells claude (seam #1)', () => {
  const files = execSync("git ls-files 'runtime/engine/**/*.mjs'", { encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.includes('/test/'));
  assert.ok(files.length > 0, 'guard captured zero files — the glob is wrong, not that ring-1 is empty');
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (/from ['"][^'"]*\/adapters\//.test(src) || /['"]\.claude\/skills\//.test(src) || /execSync\(\s*['"`]claude/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `ring-1 seam violations: ${offenders.join(', ')}`);
});
