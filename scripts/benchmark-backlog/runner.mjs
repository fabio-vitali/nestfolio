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
  const { model, timeoutMs = 240000, cwd, env, pauseConvention } = runnerOpts;
  const args = ['-p', scenario.prompt, '--print', '--verbose', '--output-format', 'stream-json',
    '--setting-sources', 'project', '--strict-mcp-config', '--model', model,
    '--append-system-prompt', pauseConvention,
    '--allowedTools', ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill'].join(' ')];
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
