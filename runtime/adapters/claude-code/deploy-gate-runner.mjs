#!/usr/bin/env node
// runtime/adapters/claude-code/deploy-gate-runner.mjs — the host runner behind the deploy-gate check's
// cmd: seam (D2). Sequences: diff → resolveDeployServices → deploy.sh → nx test-integration. exit 0 = all
// green (the cmd evaluator returns []), non-zero = a finding. Sandbox-robust: if the skill resolver / nx
// graph is unavailable (parity sandbox seeds only runtime/), falls back to a bare deploy.sh (stub-hit).
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const realSh = (cmd) => spawnSync(cmd, { shell: true, encoding: 'utf8', stdio: 'inherit' });
const realDiff = (base) => { try { return execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } };

export async function runDeployGate({ base = 'origin/main', sh = realSh, diffOf = realDiff } = {}) {
  const changed = diffOf(base);
  if (!changed.length) return { ok: true, ran: [] };

  let deployNeeded = true, services = [];
  try {
    const dd = await import('../../../.claude/skills/backlog-next/detect-deploy-needed.mjs');
    const { loadGraph } = await import('../../../tools/affected-projects.mjs');
    const cls = dd.classifyChanges(changed);
    deployNeeded = cls.deploy;
    if (deployNeeded) { try { services = dd.resolveDeployServices(loadGraph(), cls.seedFiles); } catch { services = cls.services; } }
  } catch { /* sandbox: resolver absent → bare deploy fallback (deployNeeded stays true) */ }

  const ran = [];
  if (deployNeeded) {
    const svc = services.length ? ` --services=${services.join(',')}` : '';
    ran.push('deploy.sh');
    const d = sh(`bash infrastructure/scripts/deploy.sh sandbox --prefix=dev${svc}`);
    if (d.status !== 0) return { ok: false, ran, stage: 'deploy', code: d.status };
    ran.push('nx test-integration');
    const t = sh(`node tools/affected-projects.mjs --base=${base} --with-target=test-integration | paste -sd, - | xargs -r -I{} pnpm nx run-many -t test-integration -p {}`);
    if (t.status !== 0) return { ok: false, ran, stage: 'integration', code: t.status };
  }
  return { ok: true, ran };
}

function main() {
  const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=origin/main').slice(7);
  runDeployGate({ base }).then((r) => { if (!r.ok) console.error(`[deploy-gate] ${r.stage} failed (code ${r.code})`); process.exit(r.ok ? 0 : 1); });
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
