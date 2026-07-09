// runtime/eval/e2e/greenfield.test.mjs — the greenfield adoption e2e (the runtime cold-start deliverable).
// A bare repo + runtime/ only: init seeds starter checks → a violation commit is BLOCKED → a check is
// MINTED at the floor (park→fulfil) and has teeth → CURATE retires it → the commit passes. The test
// plays the human via --fulfil. No LLM, no Nestfolio content. Cold-start/portability proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, symlinkSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: join(HERE, '..') }).toString().trim();
const sh = (dir, cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });
const git = (dir, ...a) => sh(dir, 'git', ['-c', 'user.email=gf@x', '-c', 'user.name=gf', ...a]);

function buildGreenfield() {
  const dir = mkdtempSync(join(tmpdir(), 'greenfield-'));
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'package.json'), '{"name":"greenfield","version":"0.0.0","private":true}\n');
  cpSync(join(REPO, 'runtime'), join(dir, 'runtime'), { recursive: true });
  // greenfield = EMPTY content ring; init seeds it. Keep triggers.yaml (cadence config ships with runtime/).
  for (const sub of ['checks', 'lessons']) {
    const p = join(dir, 'runtime/content', sub);
    rmSync(p, { recursive: true, force: true });
    mkdirSync(p, { recursive: true });
  }
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  for (const dep of ['yaml', 'zod']) symlinkSync(join(REPO, 'node_modules', dep), join(dir, 'node_modules', dep));
  // minimal governed store: one parking item + matching index (index-fresh + single-active hold)
  mkdirSync(join(dir, 'docs/backlog'), { recursive: true });
  writeFileSync(join(dir, 'docs/backlog/seed-item.md'), '---\nid: seed-item\nstatus: parking\ntype: bug\n---\n\n# seed-item\n');
  writeFileSync(join(dir, 'docs/BACKLOG.md'), '# BACKLOG\n\n- [seed-item](backlog/seed-item.md)\n');
  writeFileSync(join(dir, '.git/hooks/pre-commit'), '#!/bin/sh\nexec node runtime/adapters/git/pre-commit-gate.mjs\n');
  chmodSync(join(dir, '.git/hooks/pre-commit'), 0o755);
  git(dir, 'add', '-A');
  // Empty registry at this point: the gate loads 0 checks → 0 findings → the baseline commit passes.
  const c = git(dir, 'commit', '-qm', 'greenfield baseline');
  assert.equal(c.status, 0, c.stderr + c.stdout);
  return dir;
}

test('greenfield: init → violation blocked → mint has teeth → curate → pass', () => {
  const dir = buildGreenfield();

  // 1. init seeds the starter registry
  const init = sh(dir, 'node', ['runtime/cli.mjs', 'init']);
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /seeded \d+ starter checks/);
  const reg = sh(dir, 'node', ['runtime/engine/lib/load-registry.mjs', '--checks-dir', 'runtime/content/checks']);
  assert.equal(reg.status, 0, reg.stdout + reg.stderr);
  git(dir, 'add', '-A');
  assert.equal(git(dir, 'commit', '-qm', 'init starter pack').status, 0);

  // 2. a starter-check violation is BLOCKED at commit (no-unsafe-casts scans services/**)
  mkdirSync(join(dir, 'services/demo/api/src'), { recursive: true });
  writeFileSync(join(dir, 'services/demo/api/src/bad.ts'), 'export const x = (1 as unknown as string);\n');
  git(dir, 'add', '-A');
  const blocked = git(dir, 'commit', '-qm', 'violation');
  assert.notEqual(blocked.status, 0, 'gate must block the unsafe-cast commit');
  assert.match(blocked.stderr + blocked.stdout, /no-unsafe-casts/);
  git(dir, 'reset', '-q');
  rmSync(join(dir, 'services'), { recursive: true, force: true });

  // 3. mint a NEW check at the floor (park → fulfil ratify)
  mkdirSync(join(dir, 'eval-checks'), { recursive: true });
  writeFileSync(join(dir, 'eval-checks/no-forbidden-todo.mjs'),
    `#!/usr/bin/env node\nimport { execSync } from 'node:child_process';\nlet out = '';\ntry { out = execSync("grep -rn 'TODO-FORBIDDEN' src services 2>/dev/null || true", { encoding: 'utf8' }); } catch {}\nif (out.trim()) { console.log(out.trim()); process.exit(1); }\nprocess.exit(0);\n`);
  // the dossier needs frontmatter — registerRatified writes the mints: pointer into it
  writeFileSync(join(dir, 'lesson.md'), '---\nname: lesson\ndescription: forbidden TODO markers rotted in prod\n---\n\n# lesson: forbidden TODO markers\nTODO-FORBIDDEN markers rotted in prod.\n');
  // Flat CandidateDraft fields + the §8 three-gate test — provenance is assembled by draftCandidate
  // (minted_by = the item id, lesson = the mirrored dossier name).
  const proposal = {
    id: 'no-forbidden-todo', property: 'no TODO-FORBIDDEN markers in source', kind: 'drift',
    evaluator: { type: 'deterministic', run: 'cmd:node eval-checks/no-forbidden-todo.mjs' },
    cost_tier: 'cheap', contexts: ['invariant', 'gate'], scope: { paths: ['src/**', 'services/**'] },
    gates: { mechanizable: true, recurring: true, stillIntended: true },
    eval_scenario: { path: 'runtime/eval/scenarios/no-forbidden-todo.scenario.mjs', fixtures: { good: ['src/ok.ts'], bad: ['src/bad.ts'] }, target_pass_rate: 1 },
    rationale: 'mechanizable, recurring, still intended (greenfield proof)',
  };
  writeFileSync(join(dir, 'proposal.json'), JSON.stringify(proposal, null, 2));
  git(dir, 'add', '-A');
  assert.equal(git(dir, 'commit', '-qm', 'mint inputs').status, 0);

  const rb = 'runtime/adapters/claude-code/run-backward.mjs';
  const mint1 = sh(dir, 'node', [rb, 'mint', '--item', 'seed-item', '--lesson', 'lesson.md', '--proposal', 'proposal.json']);
  assert.equal(mint1.status, 3, `expected park, got ${mint1.status}: ${mint1.stdout} ${mint1.stderr}`);
  const pending = JSON.parse(mint1.stdout).pending;
  const mintKey = pending.find((p) => p.key.startsWith('mint-no-forbidden-todo')).key;
  const mint2 = sh(dir, 'node', [rb, 'mint', '--item', 'seed-item', '--lesson', 'lesson.md', '--proposal', 'proposal.json',
    '--fulfil', mintKey, '--value', JSON.stringify({ decisionId: mintKey, value: 'ratify' })]);
  assert.equal(mint2.status, 0, mint2.stdout + mint2.stderr);
  const minted = parse(readFileSync(join(dir, 'runtime/content/checks/no-forbidden-todo.yaml'), 'utf8'));
  assert.equal(minted.status, 'active');
  assert.ok(minted.provenance.ratified, 'ratify stamps provenance.ratified');
  assert.ok(existsSync(join(dir, 'runtime/eval/scenarios/no-forbidden-todo.scenario.mjs')), 'eval scenario landed');
  git(dir, 'add', '-A');
  assert.equal(git(dir, 'commit', '-qm', 'minted check').status, 0, 'post-mint commit must pass the gate');

  // 4. the minted check has TEETH
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/todo.ts'), '// TODO-FORBIDDEN: fix later\n');
  git(dir, 'add', '-A');
  const blocked2 = git(dir, 'commit', '-qm', 'todo violation');
  assert.notEqual(blocked2.status, 0, 'minted check must block');
  assert.match(blocked2.stderr + blocked2.stdout, /no-forbidden-todo/);

  // 5. curate: retire at the floor → the same commit now passes
  const cur1 = sh(dir, 'node', [rb, 'curate', '--check', 'no-forbidden-todo', '--trigger', 'ship-gate', '--reason', 'greenfield retire']);
  assert.equal(cur1.status, 3, cur1.stdout + cur1.stderr);
  const curKey = JSON.parse(cur1.stdout).pending.find((p) => p.key.startsWith('curate-no-forbidden-todo')).key;
  const cur2 = sh(dir, 'node', [rb, 'curate', '--check', 'no-forbidden-todo', '--trigger', 'ship-gate', '--reason', 'greenfield retire',
    '--fulfil', curKey, '--value', JSON.stringify({ decisionId: curKey, value: 'retire' })]);
  assert.equal(cur2.status, 0, cur2.stdout + cur2.stderr);
  assert.equal(parse(readFileSync(join(dir, 'runtime/content/checks/no-forbidden-todo.yaml'), 'utf8')).status, 'retired');
  const pass = git(dir, 'commit', '-qm', 'todo violation now permitted');
  assert.equal(pass.status, 0, pass.stderr + pass.stdout);

  // 6. journal evidence on the shared backward ledger
  const steps = readFileSync(join(dir, '.git/journal/backward/steps.ndjson'), 'utf8');
  assert.match(steps, /mint-no-forbidden-todo/);
  assert.match(steps, /curate-no-forbidden-todo/);

  rmSync(dir, { recursive: true, force: true });
});
