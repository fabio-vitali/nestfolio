import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
const id = process.argv[2];
// failCycles: CLI arg wins, else env BEF_WORKER_FAIL_CYCLES (so a scenario can drive it via
// worker.{failCycles} without baking it into the prompt narrative).
const argCycles = process.argv.find((a) => a.startsWith('--fail-cycles='));
const failCycles = Number(argCycles ? argCycles.split('=')[1] : (process.env.BEF_WORKER_FAIL_CYCLES ?? 0));
// fork: CLI arg (--fork=<symbol>) wins, else env BEF_WORKER_FORK. When set, the member surfaces an
// in-member architectural fork on <symbol> on its FIRST cycle instead of shipping — the orchestrator
// must decide it (run its blast-radius gate over <symbol>). The worker exits 0 WITHOUT shipping; if the
// orchestrator auto-resolves and re-drives the member, the 2nd cycle ships normally.
const argFork = process.argv.find((a) => a.startsWith('--fork='));
const fork = argFork ? argFork.split('=')[1] : (process.env.BEF_WORKER_FORK ?? '');
// BEF_STUBS_LOG (absolute, sandbox-root) so a member-loop call from inside the epic worktree is visible
// to the grader and survives worktree removal; relative fallback for the unit suite.
appendFileSync(process.env.BEF_STUBS_LOG ?? 'stubs.log', `backlog-next-worker ${id}\n`);
const statePath = '.worker-state.json';
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
state[id] = (state[id] ?? 0) + 1;
writeFileSync(statePath, JSON.stringify(state));
if (state[id] <= failCycles) { console.error(`member ${id} integration FAILED (cycle ${state[id]})`); process.exit(1); }
if (fork && state[id] === 1) { console.log(`<<MEMBER-FORK: symbol=${fork}>>`); process.exit(0); }
// A scenario can make a member's ship touch deployable code by setting BEF_WORKER_DEPLOY_FILE to a TIER1
// path (e.g. services/<domain>/<svc>/src/...). The worker writes it AND commits it on the epic branch
// itself, so it is deterministically in HEAD for E6's deploy detector (origin/main...HEAD) rather than
// relying on the orchestrator's git-add. Used by bne-e6-zero-tests-red to make the epic deploy-bearing,
// so a 0-collected e2e is unambiguously the false-green bug (not a legit no-code no-op). Default: unset.
const deployFile = process.env.BEF_WORKER_DEPLOY_FILE;
if (deployFile) {
  mkdirSync(dirname(deployFile), { recursive: true });
  writeFileSync(deployFile, `// eval: deployable change shipped by member ${id}\nexport const handler = async () => ({ ok: true });\n`);
  try {
    execFileSync('git', ['add', deployFile], { cwd: process.cwd() });
    execFileSync('git', ['-c', 'user.email=bef@x', '-c', 'user.name=bef', 'commit', '-q', '-m', `feat(${id}): deployable change (eval)`], { cwd: process.cwd() });
  } catch { /* idempotent re-run (already committed) or nothing staged — fine */ }
}
const f = join(process.cwd(), `${id}.md`);
writeFileSync(f, readFileSync(f, 'utf8').replace(/status: active/, 'status: shipped'));
console.log(`shipped ${id}`);
