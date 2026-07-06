import { join } from 'node:path';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineSuite } from './suite.mjs';                 // SPEC 3 H1 — the live reusable suite seam
import { STUB_BINARIES } from './structural-lint.mjs';

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

export function aggregate(runs) {
  const tk = (f) => median(runs.map((r) => perRunTokens(r)[f]));
  const row = {
    gatePassRate: runs.filter((r) => r.gatePass).length / runs.length,
    anyGateFlip: new Set(runs.map((r) => r.gatePass)).size > 1, // any flip = finding
    // Headline efficiency signal: actual token consumption (median across iterations), by component.
    // `tokens.total` is THE value signal — it captures the amortized cache-re-read cost of skill prose
    // (proven by the oracle-teeth value experiment). The old `firstTurnProseTokens` one-time-load proxy
    // was removed; see cost.mjs and docs/backlog/bef-prose-token-proxy-miscalibrated.md.
    tokens: { input: tk('input'), output: tk('output'), cacheRead: tk('cacheRead'), cacheWrite: tk('cacheWrite'), total: tk('total') },
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

export function defaultRunOne(suite, opts) {
  return async (scenario, ref) => {
    const { dir, cleanup } = await suite.buildSandbox(scenario, ref);
    try {
      const { runScenario } = await import('./runner.mjs');
      const { computeCostUSD } = await import('./cost.mjs');
      // Spike correction: do NOT set HOME — a sandbox HOME strips claude's auth credentials → "Not logged in".
      // Keep the real HOME from process.env; only prepend sandbox .bin to PATH.
      const env = {
        ...process.env,
        PATH: `${join(dir, '.bin')}:${process.env.PATH}`,
        NESTFOLIO_MEMORY_DIR: join(dir, '.mem'),
        // Absolute, sandbox-root, git-ignored stub call-log — location-independent (a deploy/gh/worker
        // call from inside a worktree still lands here) and survives 6.8 worktree removal. grade.mjs
        // reads join(dir, 'stubs.log').
        BEF_STUBS_LOG: join(dir, 'stubs.log'),
        BEF_GH_PR_STATE: scenario.gh?.prState ?? 'OPEN',
        BEF_NX_EXIT: String(scenario.nx?.exitCode ?? 0),
        BEF_NX_COLLECTED: String(scenario.nx?.collectedCount ?? 1),
        BEF_WORKER_FAIL_CYCLES: String(scenario.worker?.failCycles ?? 0),
        BEF_WORKER_FORK: scenario.worker?.fork ?? '',
        // When set, the stub worker writes+commits this TIER1 path on member ship → the epic becomes
        // deploy-bearing → E6 must run a real e2e (so a 0-collected result is unambiguously the bug).
        BEF_WORKER_DEPLOY_FILE: scenario.worker?.deployFile ?? '',
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
      // On --keep, persist the transcript next to the retained sandbox so a failing run is
      // diagnosable from artifacts (the tool-call sequence + final text + grading verdict) without
      // re-running. Gated on keep so normal sweeps write nothing extra. Each iteration gets its own
      // fresh sandbox dir (mkdtempSync), so an N-iteration --keep run leaves N transcripts in N dirs
      // — grep them for the failing one (gatePass:false) rather than expecting a single file.
      if (opts.keep) {
        writeFileSync(join(dir, 'transcript.json'), JSON.stringify({
          scenario: scenario.id, terminalKind: rr.terminalKind, pauseReason: rr.pauseReason,
          numTurns: rr.numTurns, gatePass: graded.gatePass,
          golden: graded.golden, invariants: graded.invariants, rubric: graded.rubric,
          result: rr.result, toolCalls: rr.toolCalls, stubsLog,
        }, null, 2));
      }
      return {
        gatePass: graded.gatePass,
        graded,
        costUsd: computeCostUSD(rr.perTurn, opts.model ?? 'claude-opus-4-8'),
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
    // A value-less flag (`--keep`) is a boolean `true`; a `--k=v` flag keeps its string value. Without
    // this, `--keep` parsed to '' (falsy) → cleanup still ran AND no transcript was written (the bare
    // flag silently no-op'd). `--iterations=3` etc. are unaffected (Number(opts.iterations) still coerces).
    rest.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; })
  );
  const suite = defineSuite({ buildSandbox, stubs: STUB_BINARIES, grade: gradeScenario, scenarios });
  if (mode === 'compare') { const pos = rest.filter((a) => !a.startsWith('--')); opts.refA = pos[0]; opts.refB = pos[1]; }
  const rows = await runMode(mode, { ...opts, iterations: Number(opts.iterations ?? 3) }, suite);
  console.log(JSON.stringify(rows, null, 2));
  // Durable report: write the rendered markdown to the gitignored benchmarks/backlog/ folder and
  // print its path (to STDERR, so stdout stays the rows JSON the skill captures / rebaseline redirects).
  // The report is the findable home for results — never a PR comment or the session scratchpad.
  try {
    const { buildReport, writeReport } = await import('./report.mjs');
    const { join } = await import('node:path');
    const generatedAt = new Date().toISOString();
    const scope = [
      opts.skill && `--skill=${opts.skill}`,
      opts.scenario && `--scenario=${opts.scenario}`,
      `--iterations=${Number(opts.iterations ?? 3)}`,
    ].filter(Boolean).join(' ');
    const markdown = buildReport({ mode, rows, refA: opts.refA, refB: opts.refB, scope, model: opts.model, generatedAt });
    const path = writeReport({ markdown, dir: join(process.cwd(), 'benchmarks', 'backlog'), mode, generatedAt });
    console.error(`[bef] report written: ${path}`);
  } catch (e) {
    console.error(`[bef] WARN: failed to write report file: ${e.message}`);
  }
}
