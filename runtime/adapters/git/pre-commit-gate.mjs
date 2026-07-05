// runtime/adapters/git/pre-commit-gate.mjs — ring-2 git→runtime binding (runtime-make-it-fire).
// Runs the content-ring commit-trigger checks over the STAGED set via ring-1 runWatch and blocks the
// commit on findings. Fail-closed: any crash → exit 2. Escape hatch: RUNTIME_GATE_SKIP.
// Invoked by scripts/verify-structure.sh (== .git/hooks/pre-commit). Ring-2: git awareness stays out of ring-1.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadRegistry, registryErrorLines } from '../../engine/lib/load-registry.mjs';
import { runWatch, loadTriggers } from '../../engine/lib/run-watch.mjs';
import { makeJournal, gitHeadSha } from '../../engine/lib/journal.mjs';

// Pure core: given the staged set + a loaded registry + the commit trigger, run the watch and map to an
// exit code. `watch` is injectable so the unit test stays hermetic (no real check execution).
export async function runPreCommitGate({ stagedFiles, registry, trigger, watch = runWatch }) {
  const findings = await watch({ registry, trigger, changedScope: stagedFiles, stagedFiles });
  return { exitCode: findings.length ? 1 : 0, findings };
}

export function shouldSkip(env) { return Boolean(env.RUNTIME_GATE_SKIP); }

export function readStaged(exec = (c) => execSync(c, { encoding: 'utf8' })) {
  return exec('git diff --cached --name-only --diff-filter=ACM').split('\n').filter(Boolean);
}

export const CURATE_CMD = (check) =>
  `node runtime/adapters/claude-code/run-backward.mjs curate --check ${check} --trigger ship-gate`;

/** §3.2 block message: curate is the sanctioned path; the skip hatch is a journaled last resort. */
export function formatBlockLines(findings) {
  const lines = [];
  for (const f of findings) {
    lines.push(`  ✖ ${f.check}  ${(f.scope ?? []).join(',')}  ${f.detail}`);
    lines.push(`      deliberate property change? → ${CURATE_CMD(f.check)}`);
  }
  lines.push(`runtime gate: ${findings.length} finding(s) — commit blocked. Fix the code, or curate the check at the floor (commands above).`);
  lines.push('  last resort: RUNTIME_GATE_SKIP=1 — the skip is journaled and adjudicated at ship (ship-recheck must pass before the item closes).');
  return lines;
}

/** §3.2 skip ledger — throws on append failure; the caller must then NOT honor the skip (exit 2). */
export function journalSkip({ journal, sha, staged, ts }) {
  journal.begin('gate-skips', { runId: 'gate-skips', auto: false });
  journal.record('gate-skips', `skip:${ts}`, { sha, staged, ts });
}

async function main() {
  try {
    if (shouldSkip(process.env)) {
      try {
        journalSkip({ journal: makeJournal({}), sha: gitHeadSha(), staged: readStaged(), ts: new Date().toISOString() });
      } catch (e) {
        console.error(`runtime gate: RUNTIME_GATE_SKIP requested but the skip ledger append FAILED — skip NOT honored (fail-closed): ${e.message}`);
        process.exit(2);
      }
      console.error('runtime gate: skipped (RUNTIME_GATE_SKIP) — journaled for ship adjudication');
      process.exit(0);
    }
    const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
    const registry = loadRegistry({ checksDir: cfg.checksDir });
    const errLines = registryErrorLines(registry);
    if (errLines) {
      console.error('runtime gate: check registry corrupt — blocking commit (fail-closed):');
      for (const line of errLines) console.error(line);
      process.exit(2);
    }
    const trigger = loadTriggers(cfg.triggersFile).find((t) => t.on === 'commit');
    if (!trigger) { console.error('runtime gate: no "commit" trigger in triggers.yaml'); process.exit(2); }
    const { exitCode, findings } = await runPreCommitGate({ stagedFiles: readStaged(), registry, trigger });
    if (findings.length) for (const line of formatBlockLines(findings)) console.error(line);
    process.exit(exitCode);
  } catch (e) {
    console.error(`runtime gate: crashed, blocking commit (fail-closed): ${e.message}`);
    process.exit(2);
  }
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
