import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// ring-1 stays project- AND harness-agnostic (SPEC-1 hard constraint): no adapter, no skill, no shelling
// claude (seam #1) AND no runtime/content (seam #2 — content is the Nestfolio-specific ring; the dep
// direction is content→engine only). The content ban closes the gap that let WS-3's first-cut worker
// import classifyLane; the lane→trigger mapping is injected by the adapter instead.
// All three ESM shapes are banned — static `from '…'`, bare side-effect `import '…'`, dynamic
// `import('…')` — a lazy await import of content couples ring-1 exactly like a static one. Only
// string-literal specifiers are statically judgeable: variable-path dynamic imports (e.g.
// resolve-evaluator's `import(pathToFileURL(abs).href)`) stay legal.
const BANNED_RING_IMPORT = /(from\s+|^\s*import\s+|import\s*\(\s*)['"][^'"]*\/(adapters|content)\//m;
const seamViolation = (src) =>
  BANNED_RING_IMPORT.test(src) || /['"]\.claude\/skills\//.test(src) || /execSync\(\s*['"`]claude/.test(src);

test('ring-1 (runtime/engine) never imports an adapter, a skill, project content, or shells claude (seam #1)', () => {
  const files = execSync("git ls-files 'runtime/engine/**/*.mjs'", { encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.includes('/test/'));
  assert.ok(files.length > 0, 'guard captured zero files — the glob is wrong, not that ring-1 is empty');
  const offenders = files.filter((f) => seamViolation(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, [], `ring-1 seam violations: ${offenders.join(', ')}`);
});

test('the seam predicate flags every ESM import shape and spares variable-path dynamic imports', () => {
  const offending = [
    "import { classifyLane } from '../../content/lib/classify-lane.mjs';",
    "export * from '../../adapters/git/ship-recheck.mjs';",
    "const { classifyLane } = await import('../../content/lib/classify-lane.mjs');",
    "import('../adapters/claude-code/index.mjs').then((m) => m.run());",
    "import '../../content/checks/register-side-effects.mjs';",
    "  import '../../adapters/git/hooks.mjs';",
  ];
  for (const src of offending) assert.ok(seamViolation(src), `guard must flag: ${src}`);
  const legal = [
    'const mod = await import(pathToFileURL(abs).href);',
    "import { runWorker } from '../loop/worker.mjs';",
    "const contentDir = join(root, 'runtime', 'content');",
  ];
  for (const src of legal) assert.ok(!seamViolation(src), `guard must NOT flag: ${src}`);
});
