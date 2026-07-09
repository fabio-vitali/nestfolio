// runtime/adapters/claude-code/headless-run.mjs — the headless Claude Code invocation binding
// (ring-2). Spawns `claude -p` with stream-json output, parses the transcript, classifies the
// terminal (pause convention / error / completed), and extracts fenced-JSON payloads. This is host
// machinery: anything in runtime/ that needs a nested headless session (judged audit procedures,
// future judge bindings) binds through here — never through repo tooling outside runtime/ (the
// 2026-07-09 self-containment regression: importing scripts/benchmark-backlog crashed every driver
// main in any tree that ships runtime/ alone).
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

// Pure arg builder (unit-tested without a live `claude`) — kept separate from the spawn so the
// flag list is verifiable on its own.
export function buildClaudeArgs(scenario, runnerOpts) {
  const { model, pauseConvention,
    allowedTools = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill'] } = runnerOpts;
  const args = ['-p', scenario.prompt, '--print', '--verbose', '--output-format', 'stream-json',
    '--setting-sources', 'project', '--strict-mcp-config', '--model', model,
    '--append-system-prompt', pauseConvention,
    '--allowedTools', allowedTools.join(' ')];
  // Per-scenario subskill denial → --disallowedTools (deny precedes allow in Claude Code permissions,
  // so a specific Skill(name) deny overrides the general Skill allow above). One space-joined arg
  // mirrors --allowedTools.
  if (scenario.denySubskills?.length) args.push('--disallowedTools', scenario.denySubskills.join(' '));
  return args;
}

// Live invocation. timeoutMs → terminalKind:'timeout'.
export async function runScenario(scenario, skillRef, runnerOpts) {
  const { timeoutMs = 240000, cwd, env } = runnerOpts;
  const args = buildClaudeArgs(scenario, runnerOpts);
  return await new Promise((resolve) => {
    const lines = []; let timedOut = false; let errBuf = '';
    const child = spawn('claude', args, { cwd, env });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString(); const parts = buf.split('\n'); buf = parts.pop();
      for (const p of parts) if (p.trim()) try { lines.push(JSON.parse(p)); } catch {}
    });
    // Surface claude's stderr (flag rejections, auth failures, crashes) only when the run is
    // problematic — keeps healthy-run output pristine while preserving live-run diagnosability.
    child.stderr.on('data', (d) => { errBuf += d.toString(); });
    child.on('close', () => {
      clearTimeout(timer);
      if (timedOut) {
        if (errBuf) process.stderr.write(`[runScenario timeout] claude stderr:\n${errBuf}`);
        return resolve({ terminalKind: 'timeout', pauseReason: null, result: '', usage: {}, perTurn: [], totalCostUsd: 0, durationMs: timeoutMs, ttftMs: 0, numTurns: 0, toolCalls: [] });
      }
      if (lines.length === 0 && errBuf) process.stderr.write(`[runScenario no-output] claude stderr:\n${errBuf}`);
      resolve(parseStreamJson(lines));
    });
  });
}

// Lenient fenced-JSON extraction: prefer a ```json block; else the first balanced-ish {...} object.
// Throws only when neither yields parseable JSON — callers catch and retry rather than abort.
export function parseFencedJson(text) {
  const fenced = /```json\s*([\s\S]*?)```/.exec(text);
  let raw = fenced ? fenced[1] : null;
  if (raw == null) {
    const i = (text ?? '').indexOf('{'), j = (text ?? '').lastIndexOf('}');
    raw = i !== -1 && j > i ? text.slice(i, j + 1) : null;
  }
  if (raw == null) throw new Error('no json block in response');
  return JSON.parse(raw);
}
