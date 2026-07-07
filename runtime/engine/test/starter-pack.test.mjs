import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from '../lib/load-registry.mjs';
import { metaCheck } from '../lib/meta-check.mjs';

test('the 7 starter checks all validate (loadRegistry reports no errors)', () => {   // +deploy-gate (WS-3)
  const reg = loadRegistry({ checksDir: 'runtime/starter/checks' });
  assert.deepEqual(reg.errors, []);
  assert.equal(reg.checks.length, 7);
});

test('B4: the starter pack is cheap-by-construction — no invariant declares a non-cheap tier', () => {
  const reg = loadRegistry({ checksDir: 'runtime/starter/checks' });
  const findings = metaCheck({ registry: reg, env: { resolveGlobs: () => ['x'] } });
  const cheapViolations = findings.filter((f) => f.kind === 'inconsistency' && /cheap|invariant/i.test(f.detail));
  assert.deepEqual(cheapViolations, []);
});

test('the starter pack is SELF-CONTAINED: every evaluator is cmd:node <file under runtime/> and exists', () => {
  const reg = loadRegistry({ checksDir: 'runtime/starter/checks' });
  for (const c of reg.checks) {
    const m = c.evaluator.run.match(/^cmd:node\s+(\S+)/);
    assert.ok(m, `${c.id}: starter evaluator must be cmd:node <file> (got: ${c.evaluator.run})`);
    assert.ok(m[1].startsWith('runtime/'), `${c.id}: evaluator escapes runtime/: ${m[1]}`);
    assert.ok(existsSync(m[1]), `${c.id}: evaluator file missing: ${m[1]}`);
  }
});

// Evaluator unit tests (hermetic temp fixtures) — the 3 generic starter evaluators (redteam item 7).
const EV = (n) => fileURLToPath(new URL(`../../starter/evaluators/${n}`, import.meta.url));

test('no-unsafe-casts evaluator: flags `as any` in scanned root, honors empty RUNTIME_STAGED_PATHS', () => {
  const d = mkdtempSync(join(tmpdir(), 'nuc-'));
  mkdirSync(join(d, 'services'));
  writeFileSync(join(d, 'services', 'x.ts'), 'const a = b as any;\n');
  assert.equal(spawnSync('node', [EV('no-unsafe-casts.mjs')], { cwd: d, encoding: 'utf8' }).status, 1);
  const r0 = spawnSync('node', [EV('no-unsafe-casts.mjs')], { cwd: d, encoding: 'utf8',
    env: { ...process.env, RUNTIME_STAGED_PATHS: '' } });   // presence + empty ⇒ nothing staged ⇒ pass
  assert.equal(r0.status, 0);
});

test('references-valid evaluator: design/spec dangling path → 1; resolving path+anchor → 0; other types not enforced', () => {
  const d = mkdtempSync(join(tmpdir(), 'rv-'));
  mkdirSync(join(d, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(d, 'docs', 'target.md'), '# Real Heading\nbody\n');
  writeFileSync(join(d, 'docs', 'backlog', 'ok.md'), '---\nid: ok\ntype: design\nstatus: queued\nreferences: ["docs/target.md#real-heading"]\n---\n');
  writeFileSync(join(d, 'docs', 'backlog', 'freeform.md'), '---\nid: freeform\ntype: bug\nstatus: queued\nreferences: ["docs/nope.md:12-14"]\n---\n');
  assert.equal(spawnSync('node', [EV('references-valid.mjs')], { cwd: d, encoding: 'utf8' }).status, 0);
  writeFileSync(join(d, 'docs', 'backlog', 'bad.md'), '---\nid: bad\ntype: spec\nstatus: queued\nreferences: ["docs/nope.md"]\n---\n');
  const r = spawnSync('node', [EV('references-valid.mjs')], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /dangling reference/);
});

test('index-fresh evaluator: unlisted live item → 1; listed → 0; dangling index link → 1', () => {
  const d = mkdtempSync(join(tmpdir(), 'if-'));
  mkdirSync(join(d, 'docs', 'backlog'), { recursive: true });
  writeFileSync(join(d, 'docs', 'backlog', 'a.md'), '---\nid: a\nstatus: queued\n---\n');
  writeFileSync(join(d, 'docs', 'BACKLOG.md'), 'nothing here\n');
  assert.equal(spawnSync('node', [EV('index-fresh.mjs')], { cwd: d, encoding: 'utf8' }).status, 1);
  writeFileSync(join(d, 'docs', 'BACKLOG.md'), '- [a](backlog/a.md)\n');
  assert.equal(spawnSync('node', [EV('index-fresh.mjs')], { cwd: d, encoding: 'utf8' }).status, 0);
  writeFileSync(join(d, 'docs', 'BACKLOG.md'), '- [a](backlog/a.md)\n- [ghost](backlog/ghost.md)\n');
  assert.equal(spawnSync('node', [EV('index-fresh.mjs')], { cwd: d, encoding: 'utf8' }).status, 1);
});
