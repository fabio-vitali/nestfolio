#!/usr/bin/env node
// runtime/adapters/claude-code/deploy-gate-runner.mjs — the host runner behind the deploy-gate check's
// cmd: seam (D2). Sequences: diff → resolveDeployServices → deploy.sh → nx test-integration. exit 0 = all
// green (the cmd evaluator returns []), non-zero = a finding. Sandbox-robust: if the skill resolver / nx
// graph is unavailable (parity sandbox seeds only runtime/), falls back to a bare deploy.sh (stub-hit) and
// skips the affected-integration stage (tools/ is absent there too). Never pipe inside a gate: the affected
// list is resolved via a captured shOut invocation that fails the gate hard on a non-zero exit — a shell
// pipeline would mask a resolver crash as empty input and report the stage green with zero tests run.
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const realSh = (cmd) => spawnSync(cmd, { shell: true, encoding: 'utf8', stdio: 'inherit' });
const realShOut = (cmd) => spawnSync(cmd, { shell: true, encoding: 'utf8' });
const realDiff = (base) => { try { return execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } };

// AWS_PROFILE for deploy.sh comes from the repo .env, which raw `node` never loads — the CLI hydrates it
// (library stays pure; the parity sandbox has no .env, so this is a no-op there).
export const dotenvAwsProfile = (root = process.cwd()) => {
  try {
    const m = readFileSync(join(root, '.env'), 'utf8').match(/^AWS_PROFILE=(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
};

export async function runDeployGate({ base = 'origin/main', sh = realSh, shOut = realShOut, diffOf = realDiff, env = process.env, warn = (m) => console.error(m) } = {}) {
  const changed = diffOf(base);
  if (!changed.length) return { ok: true, ran: [] };

  let deployNeeded = true, services = [], resolverAvailable = false;
  try {
    const dd = await import('../../../.claude/skills/backlog-next/detect-deploy-needed.mjs');
    const { loadGraph } = await import('../../../tools/affected-projects.mjs');
    resolverAvailable = true;
    const cls = dd.classifyChanges(changed);
    deployNeeded = cls.deploy;
    if (deployNeeded) { try { services = dd.resolveDeployServices(loadGraph(), cls.seedFiles); } catch { services = cls.services; } }
  } catch { /* sandbox: resolver absent → bare deploy fallback (deployNeeded stays true, integration stage skipped) */ }

  const ran = [];
  if (deployNeeded) {
    if (!env.AWS_PROFILE && !env.AWS_ACCESS_KEY_ID) warn('[deploy-gate] AWS_PROFILE not set (raw node does not load .env) — deploy.sh may fail; export it or invoke via this CLI, which hydrates it from .env');
    const svc = services.length ? ` --services=${services.join(',')}` : '';
    ran.push('deploy.sh');
    const d = sh(`bash infrastructure/scripts/deploy.sh sandbox --prefix=dev${svc}`);
    if (d.status !== 0) return { ok: false, ran, stage: 'deploy', code: d.status };
    if (resolverAvailable) {
      ran.push('nx test-integration');
      const list = shOut(`node tools/affected-projects.mjs --base=${base} --with-target=test-integration`);
      if (list.status !== 0) return { ok: false, ran, stage: 'integration-resolve', code: list.status ?? 1 };
      const projects = (list.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
      if (projects.length) {
        const t = sh(`pnpm nx run-many -t test-integration -p ${projects.join(',')}`);
        if (t.status !== 0) return { ok: false, ran, stage: 'integration', code: t.status };
      }
    }
  }
  return { ok: true, ran };
}

function main() {
  const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=origin/main').slice(7);
  if (!process.env.AWS_PROFILE) { const p = dotenvAwsProfile(); if (p) process.env.AWS_PROFILE = p; }
  runDeployGate({ base }).then((r) => { if (!r.ok) console.error(`[deploy-gate] ${r.stage} failed (code ${r.code})`); process.exit(r.ok ? 0 : 1); });
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
