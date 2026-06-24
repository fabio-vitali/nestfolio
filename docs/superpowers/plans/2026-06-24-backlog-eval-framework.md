# Backlog Eval Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a headless-`claude`-driven evaluation harness for the backlog skill suite that measures quality / cost / latency of orchestration decisions, with a committed baseline + A/B compare mode, so `backlog-skills-simplification` can be proven to regress no behavior and add value.

**Architecture:** A reusable skill-agnostic core (`run`/`runner`/`cost`/`report`/`suite`) behind `defineSuite({buildSandbox, stubs, grade, scenarios})`, with backlog-specific `sandbox`/`grade`/`stubs`/`scenarios`. Each scenario builds a throwaway git sandbox (fixture backlog + skill files from a git ref + per-op stub seams + isolation), runs the skill via `claude -p --print --verbose --output-format stream-json --setting-sources project`, and grades the OUTCOME in 3 layers (golden files+lint / external-stub call-log + internal-op state + terminal-kind / LLM judge). A **gate-0 spike** verifies the unverified mechanisms before the corpus is authored.

**Tech Stack:** Node ESM `.mjs` (no TS/tsx), `node:test`, the `claude` CLI (headless), reuse of `.claude/skills/backlog-lint/lib/{frontmatter,rules}.mjs`.

## Global Constraints

- **Language/runtime:** plain Node ESM `.mjs`, NODEJS_20_X+ compatible. NO TypeScript, NO `tsx`, NO build step. (Spec §Architecture.)
- **Tests:** `node:test` only; test files live in `scripts/benchmark-backlog/test/*.test.mjs` (repo convention: tests in `test/`, not `src/__tests__/`). Run the **glob form**: `node --test scripts/benchmark-backlog/test/*.test.mjs` (Node does not discover suites from a bare dir).
- **CLI invocation (verified CLI 2.1.187):** every headless run uses `claude -p --print --verbose --output-format stream-json --setting-sources project --strict-mcp-config`. `--verbose` is MANDATORY with `stream-json` (CLI errors otherwise). `--setting-sources project` is MANDATORY for isolation (`--bare` does NOT isolate).
- **Isolation:** spawn `env` strips all `AWS_*` and sets a sandbox `HOME`; `--disallowedTools` denies `WebFetch`,`WebSearch`,`Task`, and the Skill-tool sub-skills enumerated per scenario.
- **Op taxonomy (the comparability invariant):** ONLY the four external stubbed ops (`deploy.sh`, `gh`, `nx`, the `backlog-next` worker) carry call-log (`stubs.log`) invariants. Internal git/worktree/run-state ops are γ-relocated and are asserted via resulting **FS/git state** only — NEVER via trace strings. Enforced by `structural-lint.mjs`.
- **Artifacts:** runtime outputs go to gitignored `benchmarks/backlog/`; `scripts/benchmark-backlog/baseline.json` is COMMITTED.
- **No DDB seeding / no real external calls:** all expensive/irreversible ops are stubbed; no real deploy, e2e, `gh`, AWS, or network.
- **Worktree:** this is CODE work — execute on an isolated worktree per `superpowers:using-git-worktrees`, branch `feat/backlog-eval-framework`. Commit frequently; use `--no-verify` in the worktree and verify each commit landed (repo worktree feedback).

## Shared Interfaces (defined once; tasks reference these exact names)

```js
// runner.mjs
// RunResult shape returned by parseStreamJson() and runScenario():
// {
//   terminalKind: 'pause'|'completed'|'timeout'|'error',
//   pauseReason: string|null,        // text after '<<HARNESS-PAUSE:' if terminalKind==='pause'
//   result: string,                   // final assistant text
//   usage: {input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens},
//   perTurn: Array<usageObj>,         // per-assistant-turn usage, in order
//   totalCostUsd: number, durationMs: number, ttftMs: number, numTurns: number,
//   toolCalls: Array<{name: string, input: object}>,   // every tool_use in order
// }
export function parseStreamJson(lines /* array of parsed JSON event objects */) {}        // → RunResult
export async function runScenario(scenario, skillRef, runnerOpts) {}                       // → RunResult (live claude call)
export function classifyTerminal(resultEvent, lastText) {}                                 // → {terminalKind, pauseReason}

// cost.mjs
export const PRICES;                            // { [modelId]: {input, output, cacheWrite, cacheRead} } USD per token
export function computeCostUSD(perTurn, modelId) {}                                        // → number
export function firstTurnProseTokens(perTurn, skillLoadTurnIndex, floorTokens) {}          // → number

// structural-lint.mjs
export const STUB_BINARIES;                     // ['deploy.sh','gh','nx','backlog-next-worker']
export function lintScenario(scenario) {}                                                  // → string[] violations

// sandbox.mjs
export async function buildSandbox(scenario, skillRef) {}                                  // → {dir, originDir, cleanup}

// stubs/_stubs/worker.mjs (CLI): node worker.mjs <member-id> [--fail-cycles=N]  (state in .worker-state.json)

// grade.mjs
export function gradeGolden(scenario, sandboxDir) {}                                       // → {pass, failures: string[]}
export function gradeInvariants(scenario, runResult, sandboxDir, stubsLog) {}              // → {pass, failures: string[]}
export async function gradeScenario(scenario, runResult, sandboxDir, stubsLog) {}          // → {gatePass, golden, invariants, terminalOk, rubric}

// judge.mjs
export function buildJudgePrompt(scenario, runResult, backlogDiff) {}                      // → string
export function parseJudgeResult(text) {}                                                  // → {scores: object, costUsd: number}

// suite.mjs
export function defineSuite({buildSandbox, stubs, grade, scenarios}) {}                    // → {buildSandbox, stubs, grade, scenarios}

// run.mjs (CLI): node run.mjs <regression|compare <refA> <refB>|rebaseline> [--skill=…] [--iterations=N]
export async function runMode(mode, opts, suite) {}                                        // → results array

// report.mjs
export function renderEvaluation(results) {}                                               // → markdown string
export function renderCompare(resultsA, resultsB) {}                                       // → markdown string
export function flagBands(median, baseline, bandPct) {}                                    // → {flagged: bool, metric deltas}
```

**Scenario object shape** (data, validated by `lintScenario`):
```js
{
  id: string, skill: string, fixture: string,
  prompt: string,
  auto: boolean?,                                  // pass --auto-equivalent context
  runstate: { phase: 'fresh'|'partial'|'pr-open', pr: number? }?,   // INTENT — sandbox shells runstate.mjs
  gh: { prState: 'OPEN'|'MERGED' }?,
  nx: { exitCode: number, collectedCount: number }?,
  worker: { failCycles: number }?,
  denySubskills: string[]?,                         // Skill-tool sub-skills to --disallowedTools
  terminal: 'pause'|'completed',                    // expected terminal kind ('timeout' always fails)
  golden: { frontmatter: {<id>: {<field>: <value>}}, scalarStrings: [{file, field}], lintExit0: bool }?,
  callLog: { called: string[]?, neverCalled: string[]? }?,   // ONLY STUB_BINARIES
  state: { branchExists: string?, branchAbsent: string?, worktreeAbsent: string?,
           runstateAbsent: bool?, runstatePhase: string?, originMainContains: string?,
           epicActive: string?, epicNotActive: string?, memberLoopEntered: bool? }?,
  rubric: string[]?,
}
```

---

## Phase 0 — Gate-0 spike (hard gate; also captures stream-json fixtures)

> Each spike task is **accept/reject**. If any item REJECTS, STOP — do not proceed to Phase 1; return to the spec (`docs/superpowers/specs/2026-06-24-backlog-eval-framework-design.md` §Gate-0 spike) and revise the design. Spike runs use a throwaway temp dir, NOT a sandbox builder (which doesn't exist yet).

### Task 0.1: Headless baseline + `--verbose` + isolation + capture the event shape

**Files:**
- Create: `scripts/benchmark-backlog/spike/findings.md` (running log of accept/reject + captured shapes)
- Create: `scripts/benchmark-backlog/test/fixtures/stream-events/completed.jsonl` (captured event stream — reused by Phase 1 parser tests)

- [ ] **Step 1: Run a minimal isolated headless call and capture the stream**

```bash
mkdir -p /tmp/bef-spike && cd /tmp/bef-spike && git init -q
claude -p "reply with the single word OK" --print --verbose --output-format stream-json \
  --setting-sources project --strict-mcp-config --model claude-haiku-4-5-20251001 \
  > /tmp/bef-spike/stream.jsonl 2>/tmp/bef-spike/err.txt; echo "exit=$?"
```

- [ ] **Step 2: Verify isolation + capture shapes**

Inspect `/tmp/bef-spike/stream.jsonl`. ACCEPT criteria (record each in `findings.md`):
- The `system`/`init` event shows `mcp_servers: []`, no `plugins`, no SessionStart hook, `permissionMode` not `auto`.
- A final `result` event exists with keys `usage`, `total_cost_usd`, `duration_ms`, `ttft_ms`, `num_turns`, `subtype`, `type`.
- No `AWS_*` influence (run is offline).
If the init event still shows MCP/plugins/hook → REJECT (isolation flag insufficient) → STOP.

- [ ] **Step 3: Save the captured stream as a parser fixture + commit**

```bash
mkdir -p scripts/benchmark-backlog/test/fixtures/stream-events
cp /tmp/bef-spike/stream.jsonl scripts/benchmark-backlog/test/fixtures/stream-events/completed.jsonl
git add scripts/benchmark-backlog/spike/findings.md scripts/benchmark-backlog/test/fixtures/stream-events/completed.jsonl
git commit -m "spike: headless baseline + isolation verified; captured completed stream" --no-verify
```

### Task 0.2: Worker / Skill-tool interception seam (THE riskiest gate)

**Files:**
- Create: `/tmp/bef-spike2/.claude/skills/backlog-next/SKILL.md` (throwaway stub skill)
- Create: `/tmp/bef-spike2/.claude/skills/_stubs/worker.mjs` (throwaway)
- Modify: `scripts/benchmark-backlog/spike/findings.md`

- [ ] **Step 1: Build a throwaway sandbox with a stub `backlog-next` skill**

```bash
mkdir -p /tmp/bef-spike2/.claude/skills/backlog-next /tmp/bef-spike2/.claude/skills/_stubs
cd /tmp/bef-spike2 && git init -q
cat > .claude/skills/backlog-next/SKILL.md <<'EOF'
---
name: backlog-next
description: STUB worker for eval harness — ship the named member deterministically.
---
Run exactly: `node .claude/skills/_stubs/worker.mjs MEMBER-ID` then stop.
EOF
cat > .claude/skills/_stubs/worker.mjs <<'EOF'
import { appendFileSync } from 'node:fs';
appendFileSync('stubs.log', `backlog-next-worker ${process.argv[2] ?? ''}\n`);
console.log('worker ran');
EOF
```

- [ ] **Step 2: Invoke the skill headlessly and check the seam fired**

```bash
cd /tmp/bef-spike2
claude -p "Use the backlog-next skill to ship member acme-1." --print --verbose \
  --output-format stream-json --setting-sources project --strict-mcp-config \
  --model claude-haiku-4-5-20251001 > stream2.jsonl 2>&1; echo "exit=$?"
test -f stubs.log && cat stubs.log
```

ACCEPT: `stubs.log` contains `backlog-next-worker …` (the Skill tool discovered the sandbox-cwd project skill and ran the deterministic worker). Record in `findings.md` whether discovery worked via cwd `.claude/skills/`.
If NOT discovered → try `--plugin-dir` packaging; record which mechanism works. If NEITHER works → REJECT → STOP (the bne corpus is infeasible as designed; escalate to spec).

- [ ] **Step 3: Record the confirmed seam mechanism + commit findings**

```bash
cd "$(git -C . rev-parse --show-toplevel 2>/dev/null)" || cd -   # back to repo
git add scripts/benchmark-backlog/spike/findings.md
git commit -m "spike: worker Skill-tool seam confirmed (record mechanism)" --no-verify
```

### Task 0.3: Per-op stub seams (deploy.sh / nx / gh)

- [ ] **Step 1: Confirm each op's real invocation hits its stub**

In a throwaway dir, create `infrastructure/scripts/deploy.sh` (chmod +x, echoes to stubs.log), `node_modules/.bin/nx` (chmod +x, echoes + honors a `BEF_NX_EXIT`/`BEF_NX_COLLECTED` env), and a PATH `gh` shim. Then verify:
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev ; tail -1 stubs.log   # expect deploy.sh line
pnpm nx run x:y 2>/dev/null ; tail -1 stubs.log                                  # expect nx line (pnpm resolved local bin)
PATH="$PWD/.binshim:$PATH" gh pr view 1 ; tail -1 stubs.log                      # expect gh line
```
ACCEPT: all three lines appear. If `pnpm nx` does NOT resolve `node_modules/.bin/nx` → record the working alternative (shim `pnpm`); REJECT only if no mechanism works.

- [ ] **Step 2: Record + commit findings** (`--no-verify`).

### Task 0.4: Pause sentinel via `--append-system-prompt`

- [ ] **Step 1: Force a decision and confirm the sentinel fires**

```bash
cd /tmp/bef-spike && claude -p "You must choose between option A and option B but you lack the info to decide. Follow the harness pause convention." \
  --print --verbose --output-format stream-json --setting-sources project --strict-mcp-config \
  --append-system-prompt 'When you would call AskUserQuestion or otherwise pause for a user decision, emit a single final line exactly of the form `<<HARNESS-PAUSE: reason>>` and then stop. Do not ask in prose.' \
  --model claude-haiku-4-5-20251001 | tail -3
```

ACCEPT: the final assistant text contains `<<HARNESS-PAUSE:`. Record reliability across 3 runs in `findings.md`. If the model does not honor it reliably → record a stronger convention (e.g. a tool-free required prefix) before REJECT.

- [ ] **Step 2: Commit findings** (`--no-verify`).

### Task 0.5: Run-state seed + local origin (resume feasibility)

- [ ] **Step 1: Confirm helper-seeded run-state + origin operations work**

In a throwaway repo with a local bare `origin` and the real backlog-next-epic helpers copied in:
```bash
node .claude/skills/backlog-next-epic/runstate.mjs init acme --branch=feat/epic-acme --worktree=.claude/worktrees/epic-acme
echo '{ "commands":["x"],"outcome":"green","sha":"deadbeef" }' | node .claude/skills/backlog-next-epic/runstate.mjs set-e2e acme
node .claude/skills/backlog-next-epic/runstate.mjs set-e8 acme PR_OPEN_AWAITING_MERGE
node .claude/skills/backlog-next-epic/runstate.mjs get acme ; echo "get-exit=$?"   # expect 0 + JSON, not FRESH
git fetch origin main && git worktree add .claude/worktrees/epic-acme origin/main && echo "worktree ok"
```
ACCEPT: `get` returns the seeded JSON (exit 0) and the worktree/fetch succeed. Record the exact seed command sequence (it becomes `buildSandbox`'s run-state seeding). REJECT if the closed schema rejects the seed → escalate.

- [ ] **Step 2: Commit findings** (`--no-verify`).

### Task 0.6: Spike gate

- [ ] **Step 1: Confirm all of 0.1–0.5 ACCEPTED**

Read `scripts/benchmark-backlog/spike/findings.md`. If every item is ACCEPT, write a one-line "GATE PASSED" + the confirmed mechanisms (worker seam, pause convention, nx resolution, isolation flags) at the top of `findings.md`. If any REJECT, STOP and revise the spec.

- [ ] **Step 2: Commit the gate verdict** (`--no-verify`).

---

## Phase 1 — Deterministic core (TDD against captured fixtures)

### Task 1: `cost.mjs` — deterministic cache-aware cost

**Files:**
- Create: `scripts/benchmark-backlog/cost.mjs`
- Test: `scripts/benchmark-backlog/test/cost.test.mjs`

**Interfaces:**
- Produces: `PRICES`, `computeCostUSD(perTurn, modelId)`, `firstTurnProseTokens(perTurn, skillLoadTurnIndex, floorTokens)`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCostUSD, firstTurnProseTokens, PRICES } from '../cost.mjs';

const M = 'claude-haiku-4-5-20251001';
test('computeCostUSD sums per-turn tokens × price with cache multipliers', () => {
  const perTurn = [{ input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 200 }];
  const p = PRICES[M];
  const expected = 100 * p.input + 1000 * p.cacheWrite + 5000 * p.cacheRead + 200 * p.output;
  assert.equal(computeCostUSD(perTurn, M), expected);
});
test('firstTurnProseTokens = cache-inclusive sum at skill-load turn minus floor', () => {
  const perTurn = [ { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 9000, output_tokens: 5 },
                    { input_tokens: 20, cache_creation_input_tokens: 8000, cache_read_input_tokens: 1000, output_tokens: 50 } ];
  // skill loads on turn index 1; floor = 5000
  assert.equal(firstTurnProseTokens(perTurn, 1, 5000), 20 + 8000 + 1000 - 5000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/benchmark-backlog/test/cost.test.mjs`
Expected: FAIL ("Cannot find module '../cost.mjs'").

- [ ] **Step 3: Implement `cost.mjs`**

```js
// us-east-1 on-demand, USD per token. cacheWrite=5m write (~1.25× input), cacheRead (~0.1× input).
export const PRICES = {
  'claude-haiku-4-5-20251001': { input: 1.0e-6, output: 5.0e-6, cacheWrite: 1.25e-6, cacheRead: 0.1e-6 },
  // backlog skills normally run on Opus; pin the measured model in run.mjs and add its row here from cost.mjs PRICES.
  'claude-opus-4-8': { input: 15e-6, output: 75e-6, cacheWrite: 18.75e-6, cacheRead: 1.5e-6 },
};
export function computeCostUSD(perTurn, modelId) {
  const p = PRICES[modelId];
  if (!p) throw new Error(`no price row for ${modelId} — add it to cost.mjs PRICES`);
  return perTurn.reduce((s, u) =>
    s + (u.input_tokens ?? 0) * p.input + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite
      + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.output_tokens ?? 0) * p.output, 0);
}
export function firstTurnProseTokens(perTurn, skillLoadTurnIndex, floorTokens) {
  const u = perTurn[skillLoadTurnIndex];
  if (!u) throw new Error(`no turn at index ${skillLoadTurnIndex}`);
  return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) - floorTokens;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/benchmark-backlog/test/cost.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-backlog/cost.mjs scripts/benchmark-backlog/test/cost.test.mjs
git commit -m "feat(bef): deterministic cache-aware cost + prose-token proxy" --no-verify
```

### Task 2: `runner.mjs` stream-json parser + terminal classification

**Files:**
- Create: `scripts/benchmark-backlog/runner.mjs`
- Test: `scripts/benchmark-backlog/test/parse.test.mjs`
- Uses: `scripts/benchmark-backlog/test/fixtures/stream-events/completed.jsonl` (from Task 0.1)

**Interfaces:**
- Produces: `parseStreamJson(lines)`, `classifyTerminal(resultEvent, lastText)`, `runScenario(scenario, skillRef, runnerOpts)`.

- [ ] **Step 1: Write the failing test (parser + terminal classification)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStreamJson, classifyTerminal } from '../runner.mjs';

const lines = readFileSync(new URL('./fixtures/stream-events/completed.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

test('parseStreamJson extracts usage/cost/turns/terminalKind from a real completed stream', () => {
  const r = parseStreamJson(lines);
  assert.equal(r.terminalKind, 'completed');
  assert.ok(r.perTurn.length >= 1);
  assert.ok(typeof r.totalCostUsd === 'number');
  assert.ok(typeof r.numTurns === 'number');
});
test('classifyTerminal detects the pause sentinel', () => {
  const t = classifyTerminal({ subtype: 'success' }, 'blah\n<<HARNESS-PAUSE: need user choice>>');
  assert.equal(t.terminalKind, 'pause');
  assert.equal(t.pauseReason, 'need user choice');
});
test('classifyTerminal maps a clean finish to completed', () => {
  assert.equal(classifyTerminal({ subtype: 'success' }, 'done').terminalKind, 'completed');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/benchmark-backlog/test/parse.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Implement `runner.mjs`** (parser + classifier; live `runScenario` wraps spawn)

```js
import { spawn } from 'node:child_process';

const PAUSE_RE = /<<HARNESS-PAUSE:\s*([^>]*)>>/;

export function classifyTerminal(resultEvent, lastText) {
  const m = PAUSE_RE.exec(lastText ?? '');
  if (m) return { terminalKind: 'pause', pauseReason: m[1].trim() };
  if (resultEvent?.subtype && resultEvent.subtype !== 'success') return { terminalKind: 'error', pauseReason: null };
  return { terminalKind: 'completed', pauseReason: null };
}

export function parseStreamJson(lines) {
  const perTurn = [], toolCalls = [];
  let resultEvent = null, lastText = '';
  for (const ev of lines) {
    if (ev.type === 'assistant' && ev.message) {
      if (ev.message.usage) perTurn.push(ev.message.usage);
      for (const block of ev.message.content ?? []) {
        if (block.type === 'tool_use') toolCalls.push({ name: block.name, input: block.input ?? {} });
        if (block.type === 'text') lastText = block.text;
      }
    }
    if (ev.type === 'result') resultEvent = ev;
  }
  const { terminalKind, pauseReason } = classifyTerminal(resultEvent, resultEvent?.result ?? lastText);
  return {
    terminalKind, pauseReason, result: resultEvent?.result ?? lastText,
    usage: resultEvent?.usage ?? perTurn[perTurn.length - 1] ?? {},
    perTurn,
    totalCostUsd: resultEvent?.total_cost_usd ?? 0,
    durationMs: resultEvent?.duration_ms ?? 0, ttftMs: resultEvent?.ttft_ms ?? 0,
    numTurns: resultEvent?.num_turns ?? perTurn.length,
    toolCalls,
  };
}

// Live invocation. Uses the flags confirmed in Task 0.1/0.4. timeoutMs → terminalKind:'timeout'.
export async function runScenario(scenario, skillRef, runnerOpts) {
  const { model, timeoutMs = 240000, cwd, env, pauseConvention, disallow = [] } = runnerOpts;
  const args = ['-p', scenario.prompt, '--print', '--verbose', '--output-format', 'stream-json',
    '--setting-sources', 'project', '--strict-mcp-config', '--model', model,
    '--append-system-prompt', pauseConvention,
    '--disallowedTools', ['WebFetch', 'WebSearch', 'Task', ...(scenario.denySubskills ?? []), ...disallow].join(' ')];
  return await new Promise((resolve) => {
    const lines = []; let timedOut = false;
    const child = spawn('claude', args, { cwd, env });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString(); const parts = buf.split('\n'); buf = parts.pop();
      for (const p of parts) if (p.trim()) try { lines.push(JSON.parse(p)); } catch {}
    });
    child.on('close', () => {
      clearTimeout(timer);
      if (timedOut) return resolve({ terminalKind: 'timeout', pauseReason: null, result: '', usage: {}, perTurn: [], totalCostUsd: 0, durationMs: timeoutMs, ttftMs: 0, numTurns: 0, toolCalls: [] });
      resolve(parseStreamJson(lines));
    });
  });
}
```

> NOTE for the implementer: if Task 0.1's captured `assistant` event nests `usage`/`content` differently than `ev.message.*`, adjust the field paths in `parseStreamJson` to match the captured fixture, then re-run the test. The fixture is ground truth.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/benchmark-backlog/test/parse.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-backlog/runner.mjs scripts/benchmark-backlog/test/parse.test.mjs
git commit -m "feat(bef): stream-json parser + terminal-kind classification + live runScenario" --no-verify
```

### Task 3: `structural-lint.mjs` — the procedure-coupling guard

**Files:**
- Create: `scripts/benchmark-backlog/structural-lint.mjs`
- Test: `scripts/benchmark-backlog/test/structural-lint.test.mjs`

**Interfaces:**
- Produces: `STUB_BINARIES`, `lintScenario(scenario)`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintScenario } from '../structural-lint.mjs';

const base = { id: 'x', skill: 'backlog-add', fixture: 'f', prompt: 'p', terminal: 'completed' };
test('rejects a call-log entry that is not a stub binary', () => {
  const v = lintScenario({ ...base, callLog: { called: ['git checkout main'] } });
  assert.ok(v.some((m) => /not a stub binary/i.test(m)));
});
test('accepts call-log entries over stub binaries only', () => {
  assert.deepEqual(lintScenario({ ...base, callLog: { neverCalled: ['gh pr merge'] } }), []);
});
test('rejects a procedure step-name in any assertion', () => {
  const v = lintScenario({ ...base, rubric: ['Did it run E1 then E2?'] });
  assert.ok(v.some((m) => /procedure step-name/i.test(m)));
});
test('rejects a raw run-state schema seed (must be intent)', () => {
  const v = lintScenario({ ...base, runstate: { epic: 'x', branch: 'b', worktree: 'w', auto: false, decisions: [], e2e: null } });
  assert.ok(v.some((m) => /helper-intent/i.test(m)));
});
```

- [ ] **Step 2: Run to verify it fails** → `node --test scripts/benchmark-backlog/test/structural-lint.test.mjs` → FAIL.

- [ ] **Step 3: Implement `structural-lint.mjs`**

```js
export const STUB_BINARIES = ['deploy.sh', 'gh', 'nx', 'backlog-next-worker'];
const STEP_NAME_RE = /\b(E\d(\.\d)?|runstate\.mjs|epic-members\.mjs)\b/;   // procedure-internal refs
const INTENT_KEYS = new Set(['phase', 'pr']);

export function lintScenario(s) {
  const v = [];
  const entries = [...(s.callLog?.called ?? []), ...(s.callLog?.neverCalled ?? [])];
  for (const e of entries) {
    if (!STUB_BINARIES.some((b) => e.includes(b))) v.push(`call-log entry "${e}" is not a stub binary (use STUB_BINARIES; internal git/worktree → assert via state)`);
  }
  if (s.runstate && !Object.keys(s.runstate).every((k) => INTENT_KEYS.has(k))) {
    v.push(`runstate seed must be helper-intent ({phase,pr}), not raw closed-schema keys`);
  }
  for (const r of s.rubric ?? []) if (STEP_NAME_RE.test(r)) v.push(`rubric references a procedure step-name — assert outcomes only: "${r}"`);
  if (!['pause', 'completed'].includes(s.terminal)) v.push(`terminal must be 'pause' or 'completed'`);
  return v;
}
```

- [ ] **Step 4: Run to verify it passes** → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-backlog/structural-lint.mjs scripts/benchmark-backlog/test/structural-lint.test.mjs
git commit -m "feat(bef): structural lint enforcing the op-taxonomy / no-procedure-coupling rules" --no-verify
```

---

## Phase 2 — Stubs + sandbox

### Task 4: Stub binaries (deploy.sh / gh / nx / worker)

**Files:**
- Create: `scripts/benchmark-backlog/stubs/deploy.sh`, `scripts/benchmark-backlog/stubs/gh`, `scripts/benchmark-backlog/stubs/nx`
- Create: `scripts/benchmark-backlog/stubs/backlog-next/SKILL.md`, `scripts/benchmark-backlog/stubs/_stubs/worker.mjs`
- Test: `scripts/benchmark-backlog/test/worker.test.mjs`

**Interfaces:**
- Produces: `worker.mjs` CLI `node worker.mjs <member-id> [--fail-cycles=N]`; appends `backlog-next-worker <id>` to `stubs.log`; on `failCycles>0` it writes a failing member integration state for the first N invocations (tracked in `.worker-state.json`), then ships.

- [ ] **Step 1: Write the failing test for the worker**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORKER = new URL('../stubs/_stubs/worker.mjs', import.meta.url).pathname;
function setup() {
  const d = mkdtempSync(join(tmpdir(), 'bef-w-'));
  writeFileSync(join(d, 'm1.md'), '---\nid: m1\nstatus: active\nepic: e\nepic_role: core\n---\n# M1\n');
  return d;
}
test('worker ships the member + logs to stubs.log', () => {
  const d = setup();
  execFileSync('node', [WORKER, 'm1'], { cwd: d });
  assert.match(readFileSync(join(d, 'm1.md'), 'utf8'), /status: shipped/);
  assert.match(readFileSync(join(d, 'stubs.log'), 'utf8'), /backlog-next-worker m1/);
});
test('worker honors --fail-cycles=2 (fails twice, ships on 3rd)', () => {
  const d = setup();
  let failed = 0;
  for (let i = 0; i < 3; i++) {
    try { execFileSync('node', [WORKER, 'm1', '--fail-cycles=2'], { cwd: d }); }
    catch { failed++; }
  }
  assert.equal(failed, 2);
  assert.match(readFileSync(join(d, 'm1.md'), 'utf8'), /status: shipped/);
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (worker missing).

- [ ] **Step 3: Implement the worker + the other stubs**

`stubs/_stubs/worker.mjs`:
```js
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const id = process.argv[2];
const failCycles = Number((process.argv.find((a) => a.startsWith('--fail-cycles=')) ?? '=0').split('=')[1]);
appendFileSync('stubs.log', `backlog-next-worker ${id}\n`);
const statePath = '.worker-state.json';
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
state[id] = (state[id] ?? 0) + 1;
writeFileSync(statePath, JSON.stringify(state));
if (state[id] <= failCycles) { console.error(`member ${id} integration FAILED (cycle ${state[id]})`); process.exit(1); }
const f = join(process.cwd(), `${id}.md`);
writeFileSync(f, readFileSync(f, 'utf8').replace(/status: active/, 'status: shipped'));
console.log(`shipped ${id}`);
```

`stubs/deploy.sh`:
```bash
#!/usr/bin/env bash
echo "deploy.sh $*" >> stubs.log
```
`stubs/gh`:
```bash
#!/usr/bin/env bash
echo "gh $*" >> stubs.log
# emit canned state from env so scenarios can drive PR state
case "$*" in
  *"pr view"*"--json state"*) echo "${BEF_GH_PR_STATE:-OPEN}" ;;
  *"pr create"*) echo "https://github.com/x/y/pull/${BEF_GH_PR_NUM:-1}" ;;
esac
```
`stubs/nx`:
```bash
#!/usr/bin/env bash
echo "nx $*" >> stubs.log
echo "Tests: ${BEF_NX_COLLECTED:-1} collected"
exit "${BEF_NX_EXIT:-0}"
```
`stubs/backlog-next/SKILL.md`:
```markdown
---
name: backlog-next
description: STUB worker (eval harness) — ship the named member deterministically and stop.
---
You are a STUB. For the member id given in the prompt, run exactly:
`node .claude/skills/_stubs/worker.mjs <member-id>` (add `--fail-cycles=N` only if the prompt context sets it).
If the worker exits non-zero, report the failure and stop. Then stop. Do nothing else.
```

```bash
chmod +x scripts/benchmark-backlog/stubs/deploy.sh scripts/benchmark-backlog/stubs/gh scripts/benchmark-backlog/stubs/nx
```

- [ ] **Step 4: Run to verify it passes** → `node --test scripts/benchmark-backlog/test/worker.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-backlog/stubs scripts/benchmark-backlog/test/worker.test.mjs
git commit -m "feat(bef): op stubs (deploy.sh/gh/nx/worker) with stubs.log + failCycles" --no-verify
```

### Task 5: `sandbox.mjs` — build the throwaway repo

**Files:**
- Create: `scripts/benchmark-backlog/sandbox.mjs`
- Test: `scripts/benchmark-backlog/test/sandbox.test.mjs`

**Interfaces:**
- Consumes: stub files from Task 4; the run-state seed sequence confirmed in Task 0.5.
- Produces: `buildSandbox(scenario, skillRef)` → `{dir, originDir, cleanup}`. Builds: temp repo + local bare `origin`; copies fixture `docs/backlog/` + skill files from `skillRef` (git ref or dir) into `.claude/skills/`; installs stubs (worker SKILL.md + `_stubs/`, in-repo `infrastructure/scripts/deploy.sh`, `node_modules/.bin/nx`, `gh` into a `.bin/` placed on the run's PATH); trimmed `CLAUDE.md`; seeds run-state via the real helper when `scenario.runstate` is set; commits + pushes baseline.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildSandbox } from '../sandbox.mjs';

test('buildSandbox produces an isolated resumable repo with skills + stubs', async () => {
  const scenario = { id: 's', skill: 'backlog-add', fixture: 'clean', prompt: 'p', terminal: 'completed' };
  const { dir, cleanup } = await buildSandbox(scenario, 'HEAD');
  try {
    assert.ok(existsSync(join(dir, '.claude/skills/backlog-add/SKILL.md')), 'real skill copied');
    assert.ok(existsSync(join(dir, '.claude/skills/backlog-next/SKILL.md')), 'stub worker skill installed');
    assert.ok(existsSync(join(dir, 'infrastructure/scripts/deploy.sh')), 'in-repo deploy stub');
    assert.ok(existsSync(join(dir, 'node_modules/.bin/nx')), 'nx stub');
    assert.ok(existsSync(join(dir, 'docs/backlog')), 'fixture backlog');
    // resumable: a local origin exists
    const remotes = execFileSync('git', ['remote'], { cwd: dir }).toString();
    assert.match(remotes, /origin/);
  } finally { cleanup(); }
});

test('buildSandbox seeds run-state via the real helper when requested', async () => {
  const scenario = { id: 's2', skill: 'backlog-next-epic', fixture: 'epic-pr-open', prompt: 'p', terminal: 'completed', runstate: { phase: 'pr-open', pr: 7 } };
  const { dir, cleanup } = await buildSandbox(scenario, 'HEAD');
  try {
    const out = execFileSync('node', ['.claude/skills/backlog-next-epic/runstate.mjs', 'get', 'epic-pr-open'], { cwd: dir }).toString();
    assert.match(out, /PR_OPEN_AWAITING_MERGE/);
  } finally { cleanup(); }
});
```

> The implementer must create the `fixtures/clean/` and `fixtures/epic-pr-open/` dirs (Task 11 covers fixtures; for this test create minimal ones first or land Task 11 before Task 5's test run).

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement `sandbox.mjs`**

```js
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE }).toString().trim();
const git = (cwd, ...a) => execFileSync('git', a, { cwd });

function copySkill(repoRef, skillName, destSkills) {
  // copy a skill dir from a git ref (or working tree if ref==='HEAD' with dirty allowed) into destSkills/<skillName>
  const dest = join(destSkills, skillName);
  mkdirSync(dest, { recursive: true });
  const src = join(REPO, '.claude/skills', skillName);
  cpSync(src, dest, { recursive: true });   // for non-HEAD refs, `git archive <ref> .claude/skills/<name> | tar -x` instead
}

export async function buildSandbox(scenario, skillRef) {
  const dir = mkdtempSync(join(tmpdir(), `bef-${scenario.id}-`));
  const originDir = mkdtempSync(join(tmpdir(), `bef-origin-${scenario.id}-`));
  git(originDir, 'init', '--bare', '-q');
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', originDir);
  // fixture backlog
  cpSync(join(HERE, 'fixtures', scenario.fixture), join(dir, 'docs'), { recursive: true });
  // skills under test (real) + dependencies + stub worker
  const destSkills = join(dir, '.claude/skills'); mkdirSync(destSkills, { recursive: true });
  for (const s of ['backlog-add', 'backlog-next', 'backlog-next-epic', 'backlog-themes', 'backlog-lint']) {
    if (s === scenario.skill || s === 'backlog-lint') copySkill(skillRef, s, destSkills);
  }
  copySkill(skillRef, scenario.skill, destSkills);
  // stub worker skill OVERRIDES backlog-next when the skill under test is the epic orchestrator
  if (scenario.skill === 'backlog-next-epic') {
    cpSync(join(HERE, 'stubs/backlog-next'), join(destSkills, 'backlog-next'), { recursive: true });
    cpSync(join(HERE, 'stubs/_stubs'), join(destSkills, '_stubs'), { recursive: true });
  }
  // op stubs
  mkdirSync(join(dir, 'infrastructure/scripts'), { recursive: true });
  cpSync(join(HERE, 'stubs/deploy.sh'), join(dir, 'infrastructure/scripts/deploy.sh')); chmodSync(join(dir, 'infrastructure/scripts/deploy.sh'), 0o755);
  mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
  cpSync(join(HERE, 'stubs/nx'), join(dir, 'node_modules/.bin/nx')); chmodSync(join(dir, 'node_modules/.bin/nx'), 0o755);
  const binDir = join(dir, '.bin'); mkdirSync(binDir, { recursive: true });
  cpSync(join(HERE, 'stubs/gh'), join(binDir, 'gh')); chmodSync(join(binDir, 'gh'), 0o755);
  // trimmed CLAUDE.md (Backlog Discipline section only)
  writeFileSync(join(dir, 'CLAUDE.md'), extractBacklogDiscipline());
  // baseline commit + push so origin/main exists
  git(dir, 'add', '-A'); git(dir, '-c', 'user.email=bef@x', '-c', 'user.name=bef', 'commit', '-qm', 'sandbox baseline');
  git(dir, 'branch', '-M', 'main'); git(dir, 'push', '-q', 'origin', 'main');
  // run-state seed (helper-derived) — uses the sequence confirmed in spike Task 0.5
  if (scenario.runstate) seedRunState(dir, scenario);
  const cleanup = () => { rmSync(dir, { recursive: true, force: true }); rmSync(originDir, { recursive: true, force: true }); };
  return { dir, originDir, cleanup };
}

function seedRunState(dir, s) {
  const id = s.fixture; // fixture dir name == epic id by convention
  const rs = ['.claude/skills/backlog-next-epic/runstate.mjs'];
  execFileSync('node', [...rs, 'init', id, `--branch=feat/epic-${id}`, `--worktree=.claude/worktrees/epic-${id}`], { cwd: dir });
  if (s.runstate.phase === 'pr-open') execFileSync('node', [...rs, 'set-e8', id, 'PR_OPEN_AWAITING_MERGE'], { cwd: dir });
}

function extractBacklogDiscipline() {
  const md = execFileSync('cat', [join(REPO, 'CLAUDE.md')]).toString();
  const start = md.indexOf('## Backlog Discipline');
  const end = md.indexOf('\n## ', start + 1);
  return md.slice(start, end === -1 ? undefined : end);
}
```

> Implementer note: for `skillRef !== 'HEAD'`, replace `copySkill`'s `cpSync` with `git archive <ref> .claude/skills/<name> | tar -x -C <destParent>` so the A/B knob reads the skill at that ref. Confirm the worker-seam packaging (cwd vs `--plugin-dir`) from spike Task 0.2 and wire it here.

- [ ] **Step 4: Run to verify it passes** → PASS (after Task 11 fixtures exist).

- [ ] **Step 5: Commit**

```bash
git add scripts/benchmark-backlog/sandbox.mjs scripts/benchmark-backlog/test/sandbox.test.mjs
git commit -m "feat(bef): sandbox builder (isolated resumable repo + skills + stubs + run-state seed)" --no-verify
```

---

## Phase 3 — Grader

### Task 6: `grade.mjs` layer 1 — golden (frontmatter + scalar types + lint)

**Files:**
- Create: `scripts/benchmark-backlog/grade.mjs` (golden first)
- Test: `scripts/benchmark-backlog/test/grade-golden.test.mjs`

**Interfaces:**
- Consumes: `.claude/skills/backlog-lint/lib/frontmatter.mjs` (`loadBacklogFiles`) for parsing.
- Produces: `gradeGolden(scenario, sandboxDir)` → `{pass, failures}`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gradeGolden } from '../grade.mjs';

function sb(files) {
  const d = mkdtempSync(join(tmpdir(), 'bef-g-')); mkdirSync(join(d, 'docs/backlog'), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, 'docs/backlog', name), body);
  return d;
}
test('passes when frontmatter matches golden', () => {
  const d = sb({ 'foo.md': '---\nid: foo\nstatus: parking\ntype: bug\nepic: e\nepic_role: captured\nnotes: "x"\n---\n# Foo\n' });
  const r = gradeGolden({ golden: { frontmatter: { foo: { epic: 'e', epic_role: 'captured' } } } }, d);
  assert.equal(r.pass, true, r.failures.join('; '));
});
test('fails when a golden field mismatches', () => {
  const d = sb({ 'foo.md': '---\nid: foo\nstatus: parking\ntype: bug\nepic: e\nepic_role: core\nnotes: "x"\n---\n# Foo\n' });
  const r = gradeGolden({ golden: { frontmatter: { foo: { epic_role: 'captured' } } } }, d);
  assert.equal(r.pass, false);
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement `gradeGolden` in `grade.mjs`**

```js
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBacklogFiles } from '../../.claude/skills/backlog-lint/lib/frontmatter.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function gradeGolden(scenario, sandboxDir) {
  const failures = [];
  const g = scenario.golden ?? {};
  const files = loadBacklogFiles(join(sandboxDir, 'docs/backlog'));
  const byId = Object.fromEntries(files.map((f) => [f.id, f]));
  for (const [id, fields] of Object.entries(g.frontmatter ?? {})) {
    const f = byId[id];
    if (!f) { failures.push(`expected backlog file "${id}" not found`); continue; }
    for (const [k, v] of Object.entries(fields)) {
      if (JSON.stringify(f.frontmatter[k]) !== JSON.stringify(v))
        failures.push(`${id}.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(f.frontmatter[k])}`);
    }
  }
  for (const { file, field } of g.scalarStrings ?? []) {
    const f = byId[file];
    if (f && typeof f.frontmatter[field] !== 'string') failures.push(`${file}.${field} must be a YAML string scalar`);
  }
  if (g.lintExit0) {
    try { execFileSync('node', [join(sandboxDir, '.claude/skills/backlog-lint/lint.mjs')], { cwd: sandboxDir, env: { ...process.env, NESTFOLIO_MEMORY_DIR: join(sandboxDir, '.mem') } }); }
    catch (e) { failures.push(`lint did not exit 0: ${e.stdout ?? e.message}`); }
  }
  return { pass: failures.length === 0, failures };
}
```

- [ ] **Step 4: Run to verify it passes** → PASS.

- [ ] **Step 5: Commit** (`--no-verify`, message `feat(bef): grade layer 1 golden`).

### Task 7: `grade.mjs` layer 2 — invariants (call-log + state + terminal)

**Files:**
- Modify: `scripts/benchmark-backlog/grade.mjs`
- Test: `scripts/benchmark-backlog/test/grade-invariants.test.mjs`

**Interfaces:**
- Produces: `gradeInvariants(scenario, runResult, sandboxDir, stubsLog)` → `{pass, failures}`; `gradeScenario(...)` aggregator.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gradeInvariants } from '../grade.mjs';

function repo() {
  const d = mkdtempSync(join(tmpdir(), 'bef-i-')); execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'x', '-c', 'user.email=a@b', '-c', 'user.name=a'], { cwd: d });
  return d;
}
test('neverCalled passes when the binary is absent from stubs.log', () => {
  const r = gradeInvariants({ callLog: { neverCalled: ['gh pr merge'] } }, {}, repo(), 'gh pr create x\ndeploy.sh y\n');
  assert.equal(r.pass, true, r.failures.join('; '));
});
test('neverCalled fails when present', () => {
  const r = gradeInvariants({ callLog: { neverCalled: ['gh pr merge'] } }, {}, repo(), 'gh pr merge 7\n');
  assert.equal(r.pass, false);
});
test('state.branchAbsent passes when branch does not exist', () => {
  const r = gradeInvariants({ state: { branchAbsent: 'feat/epic-x' } }, {}, repo(), '');
  assert.equal(r.pass, true);
});
test('terminal mismatch fails', () => {
  const r = gradeInvariants({ terminal: 'pause' }, { terminalKind: 'completed' }, repo(), '');
  assert.ok(r.failures.some((f) => /terminal/i.test(f)));
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement `gradeInvariants` + `gradeScenario`**

```js
import { existsSync } from 'node:fs';

function branchExists(dir, name) {
  try { execFileSync('git', ['rev-parse', '--verify', '--quiet', name], { cwd: dir }); return true; } catch { return false; }
}

export function gradeInvariants(scenario, runResult, sandboxDir, stubsLog) {
  const failures = [];
  const cl = scenario.callLog ?? {};
  for (const c of cl.called ?? []) if (!stubsLog.includes(c)) failures.push(`expected call-log "${c}" not found`);
  for (const c of cl.neverCalled ?? []) if (stubsLog.includes(c)) failures.push(`forbidden call-log "${c}" present`);
  const st = scenario.state ?? {};
  if (st.branchExists && !branchExists(sandboxDir, st.branchExists)) failures.push(`branch ${st.branchExists} should exist`);
  if (st.branchAbsent && branchExists(sandboxDir, st.branchAbsent)) failures.push(`branch ${st.branchAbsent} should be gone`);
  if (st.worktreeAbsent && existsSync(join(sandboxDir, st.worktreeAbsent))) failures.push(`worktree ${st.worktreeAbsent} should be removed`);
  if (st.runstateAbsent != null) {
    let present = true; try { execFileSync('node', [join(sandboxDir, '.claude/skills/backlog-next-epic/runstate.mjs'), 'get', scenario.fixture], { cwd: sandboxDir }); } catch { present = false; }
    if (st.runstateAbsent === present) failures.push(`runstate present=${present}, expected absent=${st.runstateAbsent}`);
  }
  if (st.originMainContains) {
    const log = execFileSync('git', ['-C', sandboxDir, 'log', 'origin/main', '--oneline'], { cwd: sandboxDir }).toString();
    if (!log.includes(st.originMainContains)) failures.push(`origin/main missing commit "${st.originMainContains}"`);
  }
  if (st.memberLoopEntered != null) {
    const entered = stubsLog.includes('backlog-next-worker');
    if (entered !== st.memberLoopEntered) failures.push(`memberLoopEntered=${entered}, expected ${st.memberLoopEntered}`);
  }
  if (scenario.terminal && runResult.terminalKind !== scenario.terminal) failures.push(`terminal=${runResult.terminalKind}, expected ${scenario.terminal}`);
  if (runResult.terminalKind === 'timeout') failures.push('run timed out');
  return { pass: failures.length === 0, failures };
}

export async function gradeScenario(scenario, runResult, sandboxDir, stubsLog) {
  const golden = gradeGolden(scenario, sandboxDir);
  const invariants = gradeInvariants(scenario, runResult, sandboxDir, stubsLog);
  const rubric = scenario.rubric?.length ? await (await import('./judge.mjs')).runJudge(scenario, runResult, sandboxDir) : null;
  const gatePass = golden.pass && invariants.pass;
  return { gatePass, golden, invariants, terminalOk: runResult.terminalKind === scenario.terminal, rubric };
}
```

- [ ] **Step 4: Run to verify it passes** → PASS.

- [ ] **Step 5: Commit** (`feat(bef): grade layer 2 invariants + gradeScenario aggregator`).

### Task 8: `judge.mjs` layer 3 — LLM rubric (prompt + parse; live call thin)

**Files:**
- Create: `scripts/benchmark-backlog/judge.mjs`
- Test: `scripts/benchmark-backlog/test/judge.test.mjs`

**Interfaces:**
- Produces: `buildJudgePrompt(scenario, runResult, backlogDiff)`, `parseJudgeResult(text)`, `runJudge(scenario, runResult, sandboxDir)` (live `claude -p`, cost tracked separately).

- [ ] **Step 1: Write the failing test (prompt + parser only — no live call)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJudgePrompt, parseJudgeResult } from '../judge.mjs';

test('buildJudgePrompt includes each rubric question', () => {
  const p = buildJudgePrompt({ rubric: ['Q1?', 'Q2?'] }, { result: 'r' }, 'diff');
  assert.match(p, /Q1\?/); assert.match(p, /Q2\?/);
});
test('parseJudgeResult extracts the JSON scores block', () => {
  const r = parseJudgeResult('blah\n```json\n{"scores":{"Q1?":4},"costUsd":0}\n```\n');
  assert.equal(r.scores['Q1?'], 4);
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement `judge.mjs`**

```js
import { runScenario } from './runner.mjs';   // reuse the spawn machinery for the judge call

export function buildJudgePrompt(scenario, runResult, backlogDiff) {
  return [
    'You are grading a backlog-skill run. Score each question 1-5 (5=ideal). Return ONLY a json block: {"scores":{"<question>":<1-5>},"costUsd":0}.',
    'Questions:', ...(scenario.rubric ?? []).map((q) => `- ${q}`),
    'Final assistant output:', runResult.result.slice(0, 4000),
    'Resulting backlog diff:', backlogDiff.slice(0, 4000),
  ].join('\n');
}
export function parseJudgeResult(text) {
  const m = /```json\s*([\s\S]*?)```/.exec(text);
  if (!m) throw new Error('judge returned no json block');
  return JSON.parse(m[1]);
}
export async function runJudge(scenario, runResult, sandboxDir) {
  // thin: a fresh headless call with the judge prompt; cost recorded separately by run.mjs
  const { execFileSync } = await import('node:child_process');
  let diff = ''; try { diff = execFileSync('git', ['-C', sandboxDir, 'diff', 'HEAD~1', 'HEAD'], { cwd: sandboxDir }).toString(); } catch {}
  const prompt = buildJudgePrompt(scenario, runResult, diff);
  const res = await runScenario({ ...scenario, prompt, denySubskills: [] }, 'HEAD', {
    model: process.env.BEF_JUDGE_MODEL ?? 'claude-sonnet-4-6', cwd: sandboxDir, env: process.env,
    pauseConvention: 'n/a', timeoutMs: 120000,
  });
  const parsed = parseJudgeResult(res.result);
  return { scores: parsed.scores, costUsd: res.totalCostUsd };
}
```

- [ ] **Step 4: Run to verify it passes** → PASS.

- [ ] **Step 5: Commit** (`feat(bef): grade layer 3 judge (prompt+parse+thin live call)`).

---

## Phase 4 — Suite seam + run loop + report

### Task 9: `suite.mjs` + `run.mjs` (modes, interleave, escalation)

**Files:**
- Create: `scripts/benchmark-backlog/suite.mjs`, `scripts/benchmark-backlog/run.mjs`
- Test: `scripts/benchmark-backlog/test/run-loop.test.mjs`

**Interfaces:**
- Produces: `defineSuite({...})`; `runMode(mode, opts, suite)` with an injectable `runOne` for testing; `compare` interleaves variants per iteration.

- [ ] **Step 1: Write the failing test (loop logic with a fake runner)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMode } from '../run.mjs';

const fakeSuite = { scenarios: [{ id: 'a', skill: 'backlog-add' }, { id: 'b', skill: 'backlog-add' }] };
test('regression runs each scenario N times', async () => {
  const calls = [];
  const out = await runMode('regression', { iterations: 2, runOne: async (s) => { calls.push(s.id); return { gatePass: true, costUsd: 1, firstTurnProseTokens: 10, numTurns: 1 }; } }, fakeSuite);
  assert.equal(calls.length, 4);
  assert.equal(out.length, 2);
});
test('compare interleaves variants per iteration (A,B,A,B…)', async () => {
  const order = [];
  await runMode('compare', { iterations: 2, refA: 'main', refB: 'feat', runOne: async (s, ref) => { order.push(ref); return { gatePass: true, costUsd: 1, firstTurnProseTokens: 10, numTurns: 1 }; } }, { scenarios: [{ id: 'a', skill: 'backlog-add' }] });
  assert.deepEqual(order, ['main', 'feat', 'main', 'feat']);
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement `suite.mjs` + `run.mjs`**

`suite.mjs`:
```js
export function defineSuite({ buildSandbox, stubs, grade, scenarios }) {
  return { buildSandbox, stubs, grade, scenarios };
}
```
`run.mjs`:
```js
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export async function runMode(mode, opts, suite) {
  const iterations = opts.iterations ?? 3;
  const runOne = opts.runOne ?? defaultRunOne(suite, opts);
  const scenarios = suite.scenarios.filter((s) => !opts.skill || s.skill === opts.skill);
  if (mode === 'compare') {
    const rows = [];
    for (const s of scenarios) {
      const a = [], b = [];
      for (let i = 0; i < iterations; i++) { a.push(await runOne(s, opts.refA)); b.push(await runOne(s, opts.refB)); }
      rows.push({ id: s.id, a: aggregate(a), b: aggregate(b) });
    }
    return rows;
  }
  // regression / rebaseline
  const rows = [];
  for (const s of scenarios) {
    const runs = [];
    for (let i = 0; i < iterations; i++) runs.push(await runOne(s, opts.ref ?? 'HEAD'));
    rows.push({ id: s.id, ...aggregate(runs) });
  }
  return rows;
}

function aggregate(runs) {
  return {
    gatePassRate: runs.filter((r) => r.gatePass).length / runs.length,
    anyGateFlip: new Set(runs.map((r) => r.gatePass)).size > 1,    // quality contract: any flip = finding
    costUsd: median(runs.map((r) => r.costUsd)),
    firstTurnProseTokens: median(runs.map((r) => r.firstTurnProseTokens)),
    numTurns: median(runs.map((r) => r.numTurns)),
  };
}

function defaultRunOne(suite, opts) {
  return async (scenario, ref) => {
    const { dir, cleanup } = await suite.buildSandbox(scenario, ref);
    try {
      const { runScenario } = await import('./runner.mjs');
      const { computeCostUSD, firstTurnProseTokens } = await import('./cost.mjs');
      const { readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const env = { ...process.env, HOME: dir, PATH: `${join(dir, '.bin')}:${process.env.PATH}`, NESTFOLIO_MEMORY_DIR: join(dir, '.mem'),
        BEF_GH_PR_STATE: scenario.gh?.prState ?? 'OPEN', BEF_NX_EXIT: String(scenario.nx?.exitCode ?? 0), BEF_NX_COLLECTED: String(scenario.nx?.collectedCount ?? 1) };
      for (const k of Object.keys(env)) if (k.startsWith('AWS_')) delete env[k];
      const rr = await runScenario(scenario, ref, { model: opts.model ?? 'claude-opus-4-8', cwd: dir, env, pauseConvention: PAUSE_CONVENTION, timeoutMs: opts.timeoutMs ?? 300000 });
      const stubsLog = existsSync(join(dir, 'stubs.log')) ? readFileSync(join(dir, 'stubs.log'), 'utf8') : '';
      const graded = await suite.grade(scenario, rr, dir, stubsLog);
      return { gatePass: graded.gatePass, graded, costUsd: computeCostUSD(rr.perTurn, opts.model ?? 'claude-opus-4-8'),
        firstTurnProseTokens: rr.perTurn.length ? firstTurnProseTokens(rr.perTurn, Math.min(1, rr.perTurn.length - 1), opts.floorTokens ?? 0) : 0,
        numTurns: rr.numTurns, rr };
    } finally { if (!opts.keep) cleanup(); }
  };
}

export const PAUSE_CONVENTION = 'When you would call AskUserQuestion or otherwise pause for a user decision, emit a single final line exactly of the form `<<HARNESS-PAUSE: reason>>` and then stop. Do not ask in prose.';
```

- [ ] **Step 4: Run to verify it passes** → PASS.

- [ ] **Step 5: Commit** (`feat(bef): suite seam + mode loop (regression/compare interleaved/rebaseline)`).

### Task 10: `report.mjs` — render + noise bands

**Files:**
- Create: `scripts/benchmark-backlog/report.mjs`
- Test: `scripts/benchmark-backlog/test/report.test.mjs`

**Interfaces:**
- Produces: `renderEvaluation(results)`, `renderCompare(rows)`, `flagBands(median, baseline, bandPct)`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagBands, renderCompare } from '../report.mjs';

test('flagBands flags a delta beyond the band', () => {
  assert.equal(flagBands(150, 100, 0.3).flagged, true);
  assert.equal(flagBands(120, 100, 0.3).flagged, false);
});
test('renderCompare marks a gate-pass-rate drop', () => {
  const md = renderCompare([{ id: 'a', a: { gatePassRate: 1, costUsd: 10 }, b: { gatePassRate: 0.66, costUsd: 8 } }]);
  assert.match(md, /REGRESSION/);
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement `report.mjs`**

```js
export function flagBands(value, baseline, bandPct) {
  const delta = (value - baseline) / (baseline || 1);
  return { flagged: Math.abs(delta) > bandPct, deltaPct: delta };
}
export function renderEvaluation(rows) {
  const head = '| scenario | gatePassRate | cost$ | proseTok | turns |\n|---|---|---|---|---|';
  return [head, ...rows.map((r) => `| ${r.id} | ${r.gatePassRate} | ${r.costUsd} | ${r.firstTurnProseTokens} | ${r.numTurns} |`)].join('\n');
}
export function renderCompare(rows) {
  const head = '| scenario | gate A→B | cost$ A→B | proseTok A→B | verdict |\n|---|---|---|---|---|';
  const body = rows.map((r) => {
    const regressed = r.b.gatePassRate < r.a.gatePassRate;
    const verdict = regressed ? '**REGRESSION**' : (r.b.costUsd < r.a.costUsd ? 'value↑' : 'flat');
    return `| ${r.id} | ${r.a.gatePassRate}→${r.b.gatePassRate} | ${r.a.costUsd}→${r.b.costUsd} | ${r.a.firstTurnProseTokens}→${r.b.firstTurnProseTokens} | ${verdict} |`;
  });
  return [head, ...body].join('\n');
}
```

- [ ] **Step 4: Run to verify it passes** → PASS.

- [ ] **Step 5: Commit** (`feat(bef): report rendering + noise-band flagging`).

---

## Phase 5 — Fixtures, exemplar scenarios, proof run, validation teeth

### Task 11: Fixtures (synthetic backlog states)

**Files:**
- Create: `scripts/benchmark-backlog/fixtures/clean/backlog/` (+ `BACKLOG.md`) — empty-ish backlog with one active epic absent
- Create: `scripts/benchmark-backlog/fixtures/active-epic/backlog/` — 1 active epic + 3 members (1 active, others queued)
- Create: `scripts/benchmark-backlog/fixtures/epic-3members-2shipped/backlog/`
- Create: `scripts/benchmark-backlog/fixtures/epic-pr-open/backlog/`
- Create: `scripts/benchmark-backlog/fixtures/e8-conflict/backlog/` (+ a `main`-side divergence note)
- Create: `scripts/benchmark-backlog/fixtures/parking-cluster/backlog/` (orphans sharing a root cause + 1 decoy singleton)

- [ ] **Step 1: Author each fixture as a set of valid backlog `.md` files**

Each fixture's `backlog/` must `lint` clean on its own. Example `fixtures/active-epic/backlog/acme-epic.md`:
```markdown
---
id: acme-epic
status: active
type: epic
notes: "demo epic"
done_when: "all core members shipped"
scope: "the acme surface"
out_of_scope: ["unrelated"]
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---
# Acme epic
```
…plus `acme-1.md` (`status: active`, `epic: acme-epic`, `epic_role: core`), `acme-2.md`/`acme-3.md` (`status: queued`, `rank`, `epic: acme-epic`, `epic_role: core`), and a generated `BACKLOG.md`. Generate each `BACKLOG.md` by running `lint --fix` in a temp repo over the fixture, then copy it in. (Fixtures named by the epic id so `sandbox.seedRunState` resolves the id from the fixture name.)

- [ ] **Step 2: Validate every fixture lints clean**

```bash
for f in scripts/benchmark-backlog/fixtures/*/; do
  echo "== $f =="; ( cd "$f" && cp -r . /tmp/lintchk && cd /tmp/lintchk && git init -q && mkdir -p docs && mv backlog docs/ && node "$OLDPWD/.claude/skills/backlog-lint/lint.mjs" --fix && echo OK ); rm -rf /tmp/lintchk; done
```
Expected: each prints `OK`.

- [ ] **Step 3: Commit** (`test(bef): synthetic backlog fixtures`).

### Task 12: Exemplar scenarios (one per skill + highest-value bne)

**Files:**
- Create: `scripts/benchmark-backlog/scenarios/add-fold-captured.scenario.mjs`
- Create: `scripts/benchmark-backlog/scenarios/next-lane-complex.scenario.mjs`
- Create: `scripts/benchmark-backlog/scenarios/bne-resume-merged-tail-only.scenario.mjs`
- Create: `scripts/benchmark-backlog/scenarios/bne-e8-conflict-resolution.scenario.mjs`
- Create: `scripts/benchmark-backlog/scenarios/bne-auto-design-pause.scenario.mjs`
- Create: `scripts/benchmark-backlog/scenarios/themes-discrimination.scenario.mjs`
- Test: `scripts/benchmark-backlog/test/scenarios-lint.test.mjs`

- [ ] **Step 1: Write the failing test (every scenario passes structural-lint)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { lintScenario } from '../structural-lint.mjs';

const dir = new URL('../scenarios/', import.meta.url);
test('every scenario passes the structural lint', async () => {
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.scenario.mjs'))) {
    const s = (await import(new URL(f, dir))).default;
    assert.deepEqual(lintScenario(s), [], `${f}: ${lintScenario(s).join('; ')}`);
  }
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (no scenarios yet).

- [ ] **Step 3: Author the exemplar scenarios** (full data; outcomes-only)

`bne-resume-merged-tail-only.scenario.mjs`:
```js
export default {
  id: 'bne-resume-merged-tail-only', skill: 'backlog-next-epic',
  fixture: 'epic-pr-open', prompt: '/backlog-next-epic epic-pr-open',
  runstate: { phase: 'pr-open', pr: 7 }, gh: { prState: 'MERGED' },
  terminal: 'completed',
  callLog: { neverCalled: ['gh pr merge'] },
  state: { branchAbsent: 'feat/epic-epic-pr-open', runstateAbsent: true, originMainContains: 'sandbox baseline', memberLoopEntered: false },
  rubric: ['Did the run perform only the post-merge cleanup and avoid re-doing member work?'],
};
```
`bne-e8-conflict-resolution.scenario.mjs`:
```js
export default {
  id: 'bne-e8-conflict-resolution', skill: 'backlog-next-epic',
  fixture: 'e8-conflict', prompt: '/backlog-next-epic e8-conflict',
  terminal: 'pause',   // E8 stops at the open PR after resolving the conflict
  callLog: { called: ['gh'], neverCalled: ['gh pr merge'] },
  golden: { frontmatter: { 'e8-conflict': { status: 'shipped' } }, scalarStrings: [{ file: 'e8-conflict', field: 'validation_gate' }], lintExit0: true },
  state: { epicNotActive: 'e8-conflict' },
  rubric: ['Was the docs/backlog conflict resolved to the shipped (branch) frontmatter, leaving lint clean and the epic closed?'],
};
```
`bne-auto-design-pause.scenario.mjs`:
```js
export default {
  id: 'bne-auto-design-pause', skill: 'backlog-next-epic',
  fixture: 'active-epic', prompt: '/backlog-next-epic acme-epic --auto', auto: true,
  terminal: 'pause',
  callLog: { neverCalled: ['gh pr create', 'deploy.sh'] },
  rubric: ['Did --auto correctly PAUSE for a type:design member instead of auto-approving the design?'],
};
```
`add-fold-captured.scenario.mjs`:
```js
export default {
  id: 'add-fold-captured', skill: 'backlog-add',
  fixture: 'active-epic',
  prompt: 'Use backlog-add to file this finding: a stray TODO comment in an unrelated module, orthogonal to the acme epic\'s done_when. Title: "stray TODO in foo".',
  terminal: 'completed',
  golden: { frontmatter: { 'stray-todo-in-foo': { epic: 'acme-epic', epic_role: 'captured' } }, scalarStrings: [{ file: 'stray-todo-in-foo', field: 'notes' }], lintExit0: true },
  rubric: ['Given the finding is orthogonal to the epic done_when, is captured (not core) the correct role?'],
};
```
`next-lane-complex.scenario.mjs`:
```js
export default {
  id: 'next-lane-complex', skill: 'backlog-next',
  fixture: 'active-epic', prompt: '/backlog-next acme-1',
  denySubskills: ['Skill(superpowers:brainstorming)', 'Skill(superpowers:executing-plans)', 'Skill(superpowers:finishing-a-development-branch)'],
  terminal: 'pause',   // classification-only: stop at the lane verdict
  rubric: ['Did it classify a public-interface-changing member as the Complex lane?'],
};
```
`themes-discrimination.scenario.mjs`:
```js
export default {
  id: 'themes-discrimination', skill: 'backlog-themes',
  fixture: 'parking-cluster', prompt: '/backlog-themes',
  terminal: 'pause',   // proposes a cluster, awaits confirm
  rubric: ['Did it aggregate ONLY the genuine root-cause cluster and leave the decoy singleton un-clustered?'],
};
```

- [ ] **Step 4: Run to verify it passes** → `node --test scripts/benchmark-backlog/test/scenarios-lint.test.mjs` → PASS.

- [ ] **Step 5: Commit** (`test(bef): exemplar scenarios (one per skill + highest-value bne)`).

### Task 13: Proof run (first live end-to-end) + exemplar baseline

**Files:**
- Create: `scripts/benchmark-backlog/baseline.json` (exemplar entries)
- Modify: `.gitignore` (add `benchmarks/backlog/`)

- [ ] **Step 1: Wire `run.mjs` as a CLI + the backlog suite**

Add to `run.mjs` bottom:
```js
import { buildSandbox } from './sandbox.mjs';
import { gradeScenario } from './grade.mjs';
import { readdirSync } from 'node:fs';
async function loadScenarios() {
  const d = new URL('./scenarios/', import.meta.url);
  const out = [];
  for (const f of readdirSync(d).filter((f) => f.endsWith('.scenario.mjs'))) out.push((await import(new URL(f, d))).default);
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, ...rest] = process.argv.slice(2);
  const opts = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=')));
  const suite = { buildSandbox, grade: gradeScenario, scenarios: await loadScenarios() };
  if (mode === 'compare') { opts.refA = rest[0]; opts.refB = rest[1]; }
  const rows = await runMode(mode, { ...opts, iterations: Number(opts.iterations ?? 3) }, suite);
  console.log(JSON.stringify(rows, null, 2));
}
```

- [ ] **Step 2: Run the proof (regression over exemplars on current HEAD)**

```bash
node scripts/benchmark-backlog/run.mjs regression --iterations=1 | tee /tmp/bef-proof.json
```
Expected: every exemplar row shows `gatePassRate: 1`. If any is `< 1`, route to `superpowers:systematic-debugging` — the harness or scenario is wrong (do NOT lower expectations).

- [ ] **Step 3: Write the exemplar baseline + gitignore**

```bash
node scripts/benchmark-backlog/run.mjs regression --iterations=3 > scripts/benchmark-backlog/baseline.json
printf '\nbenchmarks/backlog/\n' >> .gitignore
```

- [ ] **Step 4: Commit** (`feat(bef): proof run green on exemplars + committed baseline`).

### Task 14: Validation teeth (quality + value oracles, self-consistency)

**Files:**
- Create: `scripts/benchmark-backlog/test/oracle-teeth.md` (records the experiments + outcomes)

- [ ] **Step 1: Quality-oracle teeth (prose-only mutation)**

Copy the `backlog-next-epic` skill to a scratch ref, **delete only the E8 "never `gh pr merge`" guard line** (`SKILL.md:234`), and run the merge-ownership exemplar against it:
```bash
node scripts/benchmark-backlog/run.mjs compare HEAD <mutated-ref> --iterations=2 --skill=backlog-next-epic
```
Expected: the mutated variant's gate-pass-rate DROPS on `bne-resume-merged-tail-only` / a merge-ownership scenario (the `neverCalled:['gh pr merge']` invariant flips). Record. ACCEPT criterion: the oracle has teeth AND `lint` alone does not catch the mutation.

- [ ] **Step 2: Value-oracle teeth (known token injection)**

Copy a skill to a scratch ref, inject a known ~2,000-token comment block, run `compare`. Expected: `firstTurnProseTokens` rises ≈2,000 and clears the band; `gatePassRate` unchanged. Record the minimum detectable effect.

- [ ] **Step 3: Self-consistency**

```bash
node scripts/benchmark-backlog/run.mjs regression --iterations=3
```
Expected: zero `anyGateFlip: true`, every metric within band of `baseline.json`. Record.

- [ ] **Step 4: Commit** (`test(bef): oracle teeth + self-consistency recorded`).

---

## Phase 6 — Skill surface + full corpus

### Task 15: `/benchmark-backlog` skill + deterministic-suite hook

**Files:**
- Create: `.claude/skills/benchmark-backlog/SKILL.md`

- [ ] **Step 1: Author the skill** (user-triggered; `disable-model-invocation: true`; documents the three modes + cost-conscious gate; also runs the existing `node --test .claude/skills/backlog-*/test/*.test.mjs` deterministic suites and reports both layers). Mirror `benchmark-agents`' procedure shape (preflight model/iteration parse → run → report paths). Reference `scripts/benchmark-backlog/run.mjs`.

- [ ] **Step 2: Smoke** `/benchmark-backlog regression --iterations=1 --skill=backlog-add` runs green.

- [ ] **Step 3: Commit** (`feat(bef): /benchmark-backlog skill surface`).

### Task 16: Author the full corpus (the remaining ~45 scenarios)

**Files:**
- Create: the remaining `scripts/benchmark-backlog/scenarios/*.scenario.mjs` enumerated in the spec §Scenario corpus (bne resume×5, selection×5, rule-11×3, auto×6, member-loop×4, ship×4, E6 false-green×1, merge-ownership×2 + sub-gaps; backlog-add ×9; backlog-next ×6; backlog-themes ×2). Plus any new fixtures they need.

- [ ] **Step 1: Author each scenario** following the Task-12 template, outcomes-only, with the right `fixture`/`runstate`/`gh`/`nx`/`worker` knobs per the spec's corpus bullets. Each MUST pass `structural-lint`. (Repeat the Task-12 template shape — do NOT invent new assertion kinds; if a scenario needs one, add it to the schema + structural-lint + grade first.)

- [ ] **Step 2: Run the structural-lint test** → all scenarios pass.

- [ ] **Step 3: Run the full regression on HEAD** → every scenario `gatePassRate: 1`. Debug any failure via `superpowers:systematic-debugging` (the harness/scenario is the bug, never lower the bar).

- [ ] **Step 4: Commit incrementally** (one commit per scenario group; `--no-verify`).

### Task 17: Full baseline + finalize

**Files:**
- Modify: `scripts/benchmark-backlog/baseline.json`

- [ ] **Step 1: Baseline the full corpus on current `main`**

```bash
node scripts/benchmark-backlog/run.mjs regression --iterations=3 > scripts/benchmark-backlog/baseline.json
```

- [ ] **Step 2: Run the whole unit suite** → `node --test scripts/benchmark-backlog/test/*.test.mjs` all green.

- [ ] **Step 3: Commit** (`feat(bef): full-corpus baseline on main`) and proceed to `superpowers:finishing-a-development-branch`.

---

## Self-Review (completed by plan author)

**Spec coverage:** Gate-0 spike → Phase 0 (Tasks 0.1–0.6). Op taxonomy / call-log-vs-state → Tasks 3,7 + structural-lint. Pause contract → Tasks 0.4,2. Measurement (cache-aware cost, prose proxy, latency split) → Tasks 1,9. Isolation → Tasks 0.1,5,9. Worker/sub-skill seams → Tasks 0.2,4,5,12. Resume/run-state seed + local origin → Tasks 0.5,5. Merge-conflict scenario (M6) → Task 12 (`bne-e8-conflict-resolution`). bne coverage gaps (M7) + other-skill coverage (M8) → Task 16. Reusable seam → Task 9 (`defineSuite`). Modes + baseline → Tasks 9,13,17. Validation teeth (mutation + value + self-consistency) → Task 14. Skill surface + deterministic-suite hook → Task 15. Non-goals (no real deploy/e2e, no schedule/CI) respected.

**Placeholder scan:** Task 16 authors enumerated-but-not-inlined scenario *data* — legitimate (it follows the fully-inlined Task-12 template + the spec's explicit list; scenarios are data, not novel code), and is gated by the structural lint + green regression. All code tasks contain complete code.

**Type consistency:** `parseStreamJson`/`runScenario`/`classifyTerminal` (runner), `computeCostUSD`/`firstTurnProseTokens`/`PRICES` (cost), `lintScenario`/`STUB_BINARIES` (structural-lint), `buildSandbox` (sandbox), `gradeGolden`/`gradeInvariants`/`gradeScenario` (grade), `runJudge`/`buildJudgePrompt`/`parseJudgeResult` (judge), `defineSuite`/`runMode`/`PAUSE_CONVENTION` (suite/run), `renderEvaluation`/`renderCompare`/`flagBands` (report) — names match across all consuming tasks and the Shared Interfaces block.
