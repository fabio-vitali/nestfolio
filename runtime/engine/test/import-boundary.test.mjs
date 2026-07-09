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

// Rings 1+2 are SELF-CONTAINED: a production engine/** or adapters/** module never imports a path
// that resolves outside runtime/ (scripts/, tools/, .claude/, libs/ …). The runtime ships alone —
// into a sandbox, a fresh repo via `runtime init`, or any host that copies only runtime/ — so an
// escaping relative import crashes every driver main at module load in exactly the environments the
// unit suite (which runs from the repo root, where the target exists) can never see. Ring 3
// (content/) is exempt: it is the PROJECT seam and binds project paths by design (content checks
// delegate into .claude/skills/backlog-lint/lib/rules.mjs etc.). Regression: 2026-07-09 —
// audit-procedures.mjs imported scripts/benchmark-backlog/{runner,judge}.mjs; every run-*.mjs main
// crashed ERR_MODULE_NOT_FOUND inside the parity sandbox, caught only by the final oracle sweep.
const KNOWN_ESCAPES = new Set([
  // Filed ring-2 portability debt (deploy-gate-runner's project bindings belong in ring 3 — see
  // backlog). Allowlisted-and-shrinking: additions fail this test; removals should delete the entry.
  'runtime/adapters/claude-code/deploy-gate-runner.mjs → ../../../.claude/skills/backlog-next/detect-deploy-needed.mjs',
  'runtime/adapters/claude-code/deploy-gate-runner.mjs → ../../../tools/affected-projects.mjs',
]);
test('rings 1+2 (engine/ + adapters/) never import outside the runtime subtree (self-containment)', () => {
  const files = execSync("git ls-files 'runtime/engine/**/*.mjs' 'runtime/adapters/**/*.mjs'", { encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.includes('/test/'));
  assert.ok(files.length > 0, 'guard captured zero files — the glob is wrong');
  const SPECIFIER = /(?:from\s+|^\s*import\s+|import\s*\(\s*)['"]((?:\.\.?\/)[^'"]*)['"]/gm;
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const dir = f.split('/').slice(0, -1).join('/');
    for (const m of src.matchAll(SPECIFIER)) {
      const resolved = [...dir.split('/'), ...m[1].split('/')].reduce((acc, seg) => {
        if (seg === '..') acc.pop(); else if (seg !== '.' && seg !== '') acc.push(seg);
        return acc;
      }, []);
      const edge = `${f} → ${m[1]}`;
      if (resolved[0] !== 'runtime' && !KNOWN_ESCAPES.has(edge)) offenders.push(edge);
    }
  }
  assert.deepEqual(offenders, [], `ring-1/2 self-containment violations:\n${offenders.join('\n')}`);
});
