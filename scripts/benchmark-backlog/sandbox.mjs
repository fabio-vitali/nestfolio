import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, chmodSync, symlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE }).toString().trim();
const git = (cwd, ...a) => execFileSync('git', a, { cwd });

/**
 * Copy a skill dir from the working tree (skillRef === 'HEAD') or from a git ref
 * into destSkills/<skillName>. For git refs, uses `git archive | tar` so the
 * comparison always reads the skill at the exact ref, not whatever is checked out.
 */
function copySkill(skillRef, skillName, destSkills) {
  const dest = join(destSkills, skillName);
  mkdirSync(dest, { recursive: true });
  const src = join(REPO, '.claude/skills', skillName);
  if (skillRef === 'HEAD' || skillRef == null) {
    // Working-tree copy — dirty changes included, which is what compare-to-HEAD needs.
    cpSync(src, dest, { recursive: true });
  } else {
    // Git-ref copy: `git archive <ref> .claude/skills/<name> | tar -x -C <destSkills>`
    // so A/B mode reads the skill exactly as it existed at that ref.
    const archivePath = `.claude/skills/${skillName}`;
    try {
      const archive = execFileSync('git', ['archive', skillRef, '--', archivePath], { cwd: REPO });
      execFileSync('tar', ['-x', '-C', destSkills, '--strip-components=2'], {
        input: archive,
      });
    } catch (err) {
      throw new Error(`copySkill: cannot read skill "${skillName}" at git ref "${skillRef}" — is the skill present at that ref?`);
    }
  }
}

/**
 * Extract the ## Backlog Discipline section from CLAUDE.md.
 * Provides skill context without the full monorepo-specific content.
 */
function extractBacklogDiscipline() {
  const md = readFileSync(join(REPO, 'CLAUDE.md'), 'utf8');
  const start = md.indexOf('## Backlog Discipline');
  const end = md.indexOf('\n## ', start + 1);
  return md.slice(start, end === -1 ? undefined : end);
}

/**
 * Seed the run-state via the real runstate.mjs helper (relative path from sandbox root).
 * Uses the relative invocation path to avoid the macOS symlink entrypoint-guard trap.
 */
function seedRunState(dir, scenario) {
  const id = scenario.fixture; // fixture dir name == epic id by convention
  const rs = ['.claude/skills/backlog-next-epic/runstate.mjs'];
  execFileSync('node', [
    ...rs, 'init', id,
    `--branch=feat/epic-${id}`,
    `--worktree=.claude/worktrees/epic-${id}`,
  ], { cwd: dir });
  if (scenario.runstate.phase === 'pr-open') {
    execFileSync('node', [...rs, 'set-e8', id, 'PR_OPEN_AWAITING_MERGE'], { cwd: dir });
  }
}

/**
 * Build a throwaway isolated sandbox repo for one eval scenario.
 *
 * @param {object} scenario  - { id, skill, fixture, prompt, terminal, runstate? }
 * @param {string} skillRef  - 'HEAD' (working tree) or a git ref for A/B compare
 * @returns {{ dir: string, originDir: string, cleanup: () => void }}
 */
export async function buildSandbox(scenario, skillRef) {
  const dir = mkdtempSync(join(tmpdir(), `bef-${scenario.id}-`));
  const originDir = mkdtempSync(join(tmpdir(), `bef-origin-${scenario.id}-`));

  // bare origin for push/resume resumability
  git(originDir, 'init', '--bare', '-q');
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', originDir);

  // minimal package.json required by pnpm nx (ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND)
  writeFileSync(join(dir, 'package.json'), '{"name":"bef-sandbox","version":"0.0.0","private":true}\n');

  // fixture backlog (fixture/<name>/ maps to docs/)
  cpSync(join(HERE, 'fixtures', scenario.fixture), join(dir, 'docs'), { recursive: true });

  // skills: always copy backlog-lint (dependency) + the skill under test
  const destSkills = join(dir, '.claude/skills');
  mkdirSync(destSkills, { recursive: true });
  const skillsToCopy = new Set(['backlog-lint', scenario.skill]);
  // additional transitive skills that backlog-next-epic depends on
  for (const s of ['backlog-add', 'backlog-next', 'backlog-next-epic', 'backlog-themes']) {
    skillsToCopy.add(s);
  }
  for (const s of skillsToCopy) {
    copySkill(skillRef, s, destSkills);
  }

  // stub worker skill OVERRIDES the real backlog-next when exercising the epic orchestrator
  if (scenario.skill === 'backlog-next-epic') {
    cpSync(join(HERE, 'stubs/backlog-next'), join(destSkills, 'backlog-next'), { recursive: true });
    cpSync(join(HERE, 'stubs/_stubs'), join(destSkills, '_stubs'), { recursive: true });
  }

  // op stubs: in-repo deploy.sh
  mkdirSync(join(dir, 'infrastructure/scripts'), { recursive: true });
  cpSync(join(HERE, 'stubs/deploy.sh'), join(dir, 'infrastructure/scripts/deploy.sh'));
  chmodSync(join(dir, 'infrastructure/scripts/deploy.sh'), 0o755);

  // nx stub via node_modules/.bin/
  mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
  cpSync(join(HERE, 'stubs/nx'), join(dir, 'node_modules/.bin/nx'));
  chmodSync(join(dir, 'node_modules/.bin/nx'), 0o755);

  // tools/affected-projects.mjs — the true-affected resolver. A drive-to-ship scenario's worker reaches
  // the closing phase, where detect-deploy-needed.mjs STATICALLY imports this at module load (and the
  // 6.2/6.4 `nx run-many` commands shell out to it). Without it, `node detect-deploy-needed.mjs` throws
  // ERR_MODULE_NOT_FOUND before main() runs → the deploy gate never fires (a crash, not exit 0/10).
  // loadGraph() still fails inside the sandbox (no real nx graph) but that's try/caught → path-extracted
  // services. It's harness scaffolding (node-builtin imports only), copied ref-agnostically like the
  // stubs — only the skill-under-test is copied ref-aware. Classification-only scenarios stop before
  // the closing phase and never touch it.
  mkdirSync(join(dir, 'tools'), { recursive: true });
  cpSync(join(REPO, 'tools/affected-projects.mjs'), join(dir, 'tools/affected-projects.mjs'));

  // The backlog skills' only npm dependency is `yaml` (zero-dep), used by backlog-lint to parse
  // frontmatter. Symlink it from the main repo so the skill's `lint --fix` resolves `import 'yaml'`
  // via node_modules traversal — without a full node_modules symlink (which would shadow the nx stub)
  // or a mid-run `npm install` (slow/fragile/network). Add more symlinks here only if a skill grows
  // a new npm import (grep: `from '<pkg>'` excluding node:/relative).
  const yamlSrc = join(REPO, 'node_modules/yaml');
  if (existsSync(yamlSrc)) symlinkSync(yamlSrc, join(dir, 'node_modules/yaml'));

  // gh stub in .bin/ (PATH-prepended by the runner in Task 9)
  const binDir = join(dir, '.bin');
  mkdirSync(binDir, { recursive: true });
  cpSync(join(HERE, 'stubs/gh'), join(binDir, 'gh'));
  chmodSync(join(binDir, 'gh'), 0o755);

  // trimmed CLAUDE.md — Backlog Discipline section only, keeps skills oriented
  writeFileSync(join(dir, 'CLAUDE.md'), extractBacklogDiscipline());

  // baseline commit + push so origin/main exists (enables resume)
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.email=bef@x', '-c', 'user.name=bef', 'commit', '-qm', 'sandbox baseline');
  git(dir, 'branch', '-M', 'main');
  git(dir, 'push', '-q', 'origin', 'main');

  // run-state seed (helper-derived) using relative path from sandbox root
  if (scenario.runstate) seedRunState(dir, scenario);

  // per-scenario setup hook — runs after seeding, before returning to the caller
  if (typeof scenario.setup === 'function') await scenario.setup({ dir, originDir, git, REPO });

  const cleanup = () => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(originDir, { recursive: true, force: true });
  };
  return { dir, originDir, cleanup };
}
