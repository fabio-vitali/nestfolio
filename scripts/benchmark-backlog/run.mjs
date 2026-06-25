import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Spike correction: the short version was only 2/3 reliable; this 6/6 version is binding.
export const PAUSE_CONVENTION =
  'CRITICAL OUTPUT CONTRACT: You are running headless with no interactive user. You CANNOT ask questions in prose and you CANNOT use AskUserQuestion. Whenever you lack information to proceed, face a user decision, or would otherwise ask the user anything, your ENTIRE final response MUST be exactly one line: `<<HARNESS-PAUSE: brief reason>>` and nothing else. Never phrase a question as prose; always encode it as that sentinel line.';

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export async function runMode(mode, opts, suite) {
  const iterations = opts.iterations ?? 3;
  const runOne = opts.runOne ?? defaultRunOne(suite, opts);
  // `--skill=` narrows to a skill family; `--scenario=id1,id2` narrows to explicit scenario ids
  // (e.g. smoke just the hardened gates before a full sweep). Both compose; both optional.
  const only = opts.scenario ? new Set(String(opts.scenario).split(',').map((s) => s.trim())) : null;
  const scenarios = suite.scenarios.filter(
    (s) => (!opts.skill || s.skill === opts.skill) && (!only || only.has(s.id)),
  );
  // Each scenario is isolated in try/catch: a hard failure (sandbox build, spawn, etc.) is recorded as
  // a failure row and the sweep CONTINUES — one scenario must never abort the whole baseline (a single
  // uncaught judge-parse error once lost ~18 runs of quota). A stderr progress line makes the otherwise
  // print-only-at-end run observable mid-flight.
  const progress = (msg) => process.stderr.write(`[bef] ${msg}\n`);
  if (mode === 'compare') {
    const rows = [];
    for (const s of scenarios) {
      progress(`compare ${s.id} (${opts.refA} vs ${opts.refB}) x${iterations}`);
      try {
        const a = [], b = [];
        // Interleave: A,B,A,B… per iteration so temporal drift is balanced across both variants.
        for (let i = 0; i < iterations; i++) {
          a.push(await runOne(s, opts.refA));
          b.push(await runOne(s, opts.refB));
        }
        rows.push({ id: s.id, a: aggregate(a), b: aggregate(b) });
      } catch (e) {
        progress(`compare ${s.id} ERRORED: ${e?.message ?? e}`);
        rows.push({ id: s.id, error: String(e?.message ?? e) });
      }
    }
    return rows;
  }
  // regression / rebaseline: run each scenario N times
  const rows = [];
  for (const s of scenarios) {
    progress(`regression ${s.id} x${iterations}`);
    try {
      const runs = [];
      for (let i = 0; i < iterations; i++) runs.push(await runOne(s, opts.ref ?? 'HEAD'));
      const row = { id: s.id, ...aggregate(runs) };
      progress(`regression ${s.id} → gatePassRate=${row.gatePassRate} flip=${row.anyGateFlip}`);
      rows.push(row);
    } catch (e) {
      progress(`regression ${s.id} ERRORED: ${e?.message ?? e}`);
      rows.push({ id: s.id, gatePassRate: 0, anyGateFlip: false, error: String(e?.message ?? e) });
    }
  }
  return rows;
}

// Per-run token totals summed over every turn (same basis as cost.mjs), so the breakdown is consistent
// with the weighted aggregate. Token consumption is the REAL subscription-quota signal; these runs
// authenticate via the CLI subscription (no ANTHROPIC_API_KEY), so they spend quota, not dollars.
function perRunTokens(r) {
  const pt = r.rr?.perTurn ?? [];
  const sum = (f) => pt.reduce((s, u) => s + (u[f] ?? 0), 0);
  const input = sum('input_tokens'), output = sum('output_tokens');
  const cacheRead = sum('cache_read_input_tokens'), cacheWrite = sum('cache_creation_input_tokens');
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

function aggregate(runs) {
  const tk = (f) => median(runs.map((r) => perRunTokens(r)[f]));
  const row = {
    gatePassRate: runs.filter((r) => r.gatePass).length / runs.length,
    anyGateFlip: new Set(runs.map((r) => r.gatePass)).size > 1, // any flip = finding
    // Headline efficiency signal: actual token consumption (median across iterations), by component.
    tokens: { input: tk('input'), output: tk('output'), cacheRead: tk('cacheRead'), cacheWrite: tk('cacheWrite'), total: tk('total') },
    firstTurnProseTokens: median(runs.map((r) => r.firstTurnProseTokens)),
    numTurns: median(runs.map((r) => r.numTurns)),
    // weighted-token-units (API-equivalent): cost.mjs price-weighting (output ~5x input, cache-read
    // ~0.1x) as ONE comparable number for cross-model normalization — NOT a Max-subscription bill.
    costUsd: median(runs.map((r) => r.costUsd)),
  };
  // Debug aid: when a run failed, surface WHY the first failing run didn't gate-pass (per-layer
  // breakdown + judge scores) so a failure is diagnosable from the JSON without re-running or sandbox
  // spelunking. Omitted entirely when all runs pass, keeping a committed baseline clean.
  const failing = runs.find((r) => !r.gatePass);
  if (failing?.graded) {
    row.diagnostics = {
      terminalOk: failing.graded.terminalOk,
      goldenFailures: failing.graded.golden?.failures ?? [],
      invariantFailures: failing.graded.invariants?.failures ?? [],
      rubricScores: failing.graded.rubric?.scores ?? null,
    };
  }
  return row;
}

function defaultRunOne(suite, opts) {
  return async (scenario, ref) => {
    const { dir, cleanup } = await suite.buildSandbox(scenario, ref);
    try {
      const { runScenario } = await import('./runner.mjs');
      const { computeCostUSD, firstTurnProseTokens } = await import('./cost.mjs');
      // Spike correction: do NOT set HOME — a sandbox HOME strips claude's auth credentials → "Not logged in".
      // Keep the real HOME from process.env; only prepend sandbox .bin to PATH.
      const env = {
        ...process.env,
        PATH: `${join(dir, '.bin')}:${process.env.PATH}`,
        NESTFOLIO_MEMORY_DIR: join(dir, '.mem'),
        BEF_GH_PR_STATE: scenario.gh?.prState ?? 'OPEN',
        BEF_NX_EXIT: String(scenario.nx?.exitCode ?? 0),
        BEF_NX_COLLECTED: String(scenario.nx?.collectedCount ?? 1),
        BEF_WORKER_FAIL_CYCLES: String(scenario.worker?.failCycles ?? 0),
        BEF_WORKER_FORK: scenario.worker?.fork ?? '',
      };
      // Strip AWS credentials so sandbox runs don't incur real AWS calls.
      for (const k of Object.keys(env)) if (k.startsWith('AWS_')) delete env[k];
      const rr = await runScenario(scenario, ref, {
        model: opts.model ?? 'claude-opus-4-8',
        cwd: dir,
        env,
        pauseConvention: PAUSE_CONVENTION,
        // 600s default: the full epic-orchestration path (ship → rebase → resolve, 20+ turns) overran
        // the old 300s ceiling ~1/3 of the time → spurious terminal=timeout flips. Per-scenario
        // `timeoutMs` override lets a heavy scenario ask for more without inflating the cheap ones.
        timeoutMs: scenario.timeoutMs ?? opts.timeoutMs ?? 600000,
      });
      const stubsLog = existsSync(join(dir, 'stubs.log'))
        ? readFileSync(join(dir, 'stubs.log'), 'utf8')
        : '';
      const graded = await suite.grade(scenario, rr, dir, stubsLog);
      return {
        gatePass: graded.gatePass,
        graded,
        costUsd: computeCostUSD(rr.perTurn, opts.model ?? 'claude-opus-4-8'),
        firstTurnProseTokens: rr.perTurn.length
          ? firstTurnProseTokens(rr.perTurn, Math.min(1, rr.perTurn.length - 1), opts.floorTokens ?? 0)
          : 0,
        numTurns: rr.numTurns,
        rr,
      };
    } finally {
      if (!opts.keep) cleanup();
    }
  };
}

// CLI entrypoint (Task 13). Dynamic imports keep module-import side-effect-free for tests.
// Usage: node run.mjs <regression|compare <refA> <refB>|rebaseline> [--skill=…] [--scenario=id1,id2] [--iterations=N] [--model=…]
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const { buildSandbox } = await import('./sandbox.mjs');
  const { gradeScenario } = await import('./grade.mjs');
  const { readdirSync } = await import('node:fs');
  const scenDir = new URL('./scenarios/', import.meta.url);
  const scenarios = [];
  for (const f of readdirSync(scenDir).filter((x) => x.endsWith('.scenario.mjs'))) {
    scenarios.push((await import(new URL(f, scenDir))).default);
  }
  const [mode, ...rest] = process.argv.slice(2);
  const opts = Object.fromEntries(
    rest.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; })
  );
  const suite = { buildSandbox, grade: gradeScenario, scenarios };
  if (mode === 'compare') { const pos = rest.filter((a) => !a.startsWith('--')); opts.refA = pos[0]; opts.refB = pos[1]; }
  const rows = await runMode(mode, { ...opts, iterations: Number(opts.iterations ?? 3) }, suite);
  console.log(JSON.stringify(rows, null, 2));
}
