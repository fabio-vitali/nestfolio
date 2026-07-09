import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(HERE, '..', f), 'utf8');

for (const file of ['preflight.mjs', 'postflight.mjs']) {
  test(`${file} routes backlog validation through backlogGate (the runtime watch gate, not a hardcoded lint.mjs call)`, () => {
    const src = read(file);
    assert.match(src, /import \{ backlogGate \} from '\.\/backlog-gate\.mjs'/, `${file}: missing backlogGate import`);
    assert.match(src, /backlogGate\(\)/, `${file}: does not call backlogGate()`);
    // the old unconditional lint.mjs shell-out must be gone (backlogGate owns the gate command now)
    assert.doesNotMatch(src, /shSafe\(`node "\$\{lintPath\}"`\)/, `${file}: still has the hardcoded lint.mjs call`);
  });
}
