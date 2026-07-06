// scripts/parity-oracle/runtime-sandbox.mjs — the runtime-side sandbox (mirror of bef sandbox.mjs).
// Same throwaway-git-repo pattern; seeds runtime/ (ref-aware) instead of .claude/skills. The check
// registry is REPLACED by the starter pack: Nestfolio content checks reference tools/*.mjs and repo
// paths absent in a sandbox — with them the gate would fail closed on evaluator errors, grading the
// sandbox, not the engine. Starter checks are portable by design (that IS the portability claim).
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, chmodSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BEF = join(HERE, '../benchmark-backlog');
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE }).toString().trim();
const git = (cwd, ...a) => execFileSync('git', a, { cwd });

/** Copy runtime/ from the working tree (ref 'HEAD'/null) or an exact git ref (git archive | tar). */
function copyRuntime(ref, destRoot) {
  if (ref === 'HEAD' || ref == null) {
    cpSync(join(REPO, 'runtime'), join(destRoot, 'runtime'), { recursive: true });
  } else {
    const archive = execFileSync('git', ['archive', ref, '--', 'runtime'], { cwd: REPO });
    execFileSync('tar', ['-x', '-C', destRoot], { input: archive });
  }
}

/** Same trimmed CLAUDE.md as the legacy sandbox — identical operating context on both sides. */
function extractSection(md, heading) {
  const start = md.indexOf(heading);
  if (start === -1) return '';
  const end = md.indexOf('\n## ', start + 1);
  return md.slice(start, end === -1 ? undefined : end);
}
function trimmedClaudeMd() {
  const md = readFileSync(join(REPO, 'CLAUDE.md'), 'utf8');
  return [extractSection(md, '## Backlog Discipline'), extractSection(md, '## Pre-authorized actions')].filter(Boolean).join('\n');
}

export async function buildRuntimeSandbox(scenario, ref) {
  const dir = mkdtempSync(join(tmpdir(), `po-${scenario.id}-`));
  const originDir = mkdtempSync(join(tmpdir(), `po-origin-${scenario.id}-`));
  git(originDir, 'init', '--bare', '-q');
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', originDir);
  writeFileSync(join(dir, 'package.json'), '{"name":"po-sandbox","version":"0.0.0","private":true}\n');

  // fixture → docs/ : rtFixture (parity-oracle derived copy) wins over the shared bef fixture
  const fixtureSrc = scenario.rtFixture
    ? join(HERE, 'fixtures/rt', scenario.rtFixture)
    : join(BEF, 'fixtures', scenario.fixture);
  cpSync(fixtureSrc, join(dir, 'docs'), { recursive: true });

  copyRuntime(ref, dir);
  // registry = starter pack only (portable); wipe Nestfolio content checks
  rmSync(join(dir, 'runtime/content/checks'), { recursive: true, force: true });
  mkdirSync(join(dir, 'runtime/content/checks'), { recursive: true });
  for (const f of readdirSync(join(dir, 'runtime/starter/checks')).filter((n) => n.endsWith('.yaml')))
    cpSync(join(dir, 'runtime/starter/checks', f), join(dir, 'runtime/content/checks', f));

  // node_modules: the runtime imports yaml + zod (zero-dep each) — symlink from the main repo
  mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
  for (const dep of ['yaml', 'zod']) {
    const src = join(REPO, 'node_modules', dep);
    if (existsSync(src)) symlinkSync(src, join(dir, 'node_modules', dep));
  }

  // same op stubs as the legacy sandbox — the "work" both engines do is the same work
  mkdirSync(join(dir, 'infrastructure/scripts'), { recursive: true });
  cpSync(join(BEF, 'stubs/deploy.sh'), join(dir, 'infrastructure/scripts/deploy.sh'));
  chmodSync(join(dir, 'infrastructure/scripts/deploy.sh'), 0o755);
  cpSync(join(BEF, 'stubs/nx'), join(dir, 'node_modules/.bin/nx'));
  chmodSync(join(dir, 'node_modules/.bin/nx'), 0o755);
  const binDir = join(dir, '.bin');
  mkdirSync(binDir, { recursive: true });
  cpSync(join(BEF, 'stubs/gh'), join(binDir, 'gh'));
  chmodSync(join(binDir, 'gh'), 0o755);

  writeFileSync(join(dir, 'CLAUDE.md'), trimmedClaudeMd());
  writeFileSync(join(dir, '.gitignore'), 'stubs.log\n');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.email=po@x', '-c', 'user.name=po', 'commit', '-qm', 'sandbox baseline');
  git(dir, 'branch', '-M', 'main');
  git(dir, 'push', '-q', 'origin', 'main');
  if (typeof scenario.setup === 'function') await scenario.setup({ dir, originDir, git, REPO });
  const cleanup = () => { rmSync(dir, { recursive: true, force: true }); rmSync(originDir, { recursive: true, force: true }); };
  return { dir, originDir, cleanup };
}
