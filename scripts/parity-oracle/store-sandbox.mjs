// scripts/parity-oracle/store-sandbox.mjs — a minimal store sandbox for the deterministic differential:
// fixture → docs/, working-tree runtime/ with the registry seeded from SEED_CHECKS, the legacy
// backlog-lint skill, yaml+zod symlinks, git init+commit (lint.mjs resolves the repo root at module
// load; scope-gate shells `git diff`).
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE }).toString().trim();

// The differential registry: the starter checks + the two store-content checks. registry-integrity is
// EXCLUDED — the meta-check asserts repo-level surface↔entry wiring a fixture sandbox doesn't carry;
// including it would grade the sandbox, not the store. Tune here if bring-up shows another env-dependent check.
export const SEED_CHECKS = {
  starter: ['single-active.yaml', 'active-item-scope-gate.yaml', 'references-valid.yaml', 'index-fresh.yaml', 'no-unsafe-casts.yaml'],
  content: ['item-store-valid.yaml', 'backlog-id-matches-filename.yaml'],
};

export function buildStoreSandbox({ fixtureDir }) {
  const dir = mkdtempSync(join(tmpdir(), 'po-diff-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), '{"name":"po-diff","version":"0.0.0","private":true}\n');
  cpSync(fixtureDir, join(dir, 'docs'), { recursive: true });
  cpSync(join(REPO, 'runtime'), join(dir, 'runtime'), { recursive: true });
  rmSync(join(dir, 'runtime/content/checks'), { recursive: true, force: true });
  mkdirSync(join(dir, 'runtime/content/checks'), { recursive: true });
  for (const f of SEED_CHECKS.starter) cpSync(join(dir, 'runtime/starter/checks', f), join(dir, 'runtime/content/checks', f));
  for (const f of SEED_CHECKS.content) cpSync(join(REPO, 'runtime/content/checks', f), join(dir, 'runtime/content/checks', f));
  mkdirSync(join(dir, '.claude/skills'), { recursive: true });
  cpSync(join(REPO, '.claude/skills/backlog-lint'), join(dir, '.claude/skills/backlog-lint'), { recursive: true });
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  for (const dep of ['yaml', 'zod']) if (existsSync(join(REPO, 'node_modules', dep))) symlinkSync(join(REPO, 'node_modules', dep), join(dir, 'node_modules', dep));
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=po@x', '-c', 'user.name=po', 'commit', '-qm', 'store'], { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
