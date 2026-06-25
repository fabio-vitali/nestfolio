import { execFileSync } from 'node:child_process';
import { runScenario } from './runner.mjs';   // reuse the spawn machinery for the judge call

export function buildJudgePrompt(scenario, runResult, backlogDiff) {
  return [
    'CRITICAL OUTPUT CONTRACT: You are grading a backlog-skill run. Your ENTIRE response must be exactly',
    'one fenced json block and nothing else — no preamble, no explanation, no prose before or after.',
    'Format (score each question 1-5, 5=ideal): ```json\n{"scores":{"<question text>":<1-5>},"costUsd":0}\n```',
    'Questions:', ...(scenario.rubric ?? []).map((q) => `- ${q}`),
    'Final assistant output:', runResult.result.slice(0, 4000),
    'Resulting backlog diff:', backlogDiff.slice(0, 4000),
  ].join('\n');
}
// Lenient: prefer a fenced ```json block; else the first balanced-ish {...} object in the text. Throws
// only when neither yields parseable JSON — runJudge catches that and retries rather than aborting.
export function parseJudgeResult(text) {
  const fenced = /```json\s*([\s\S]*?)```/.exec(text);
  let raw = fenced ? fenced[1] : null;
  if (raw == null) {
    const i = (text ?? '').indexOf('{'), j = (text ?? '').lastIndexOf('}');
    raw = i !== -1 && j > i ? text.slice(i, j + 1) : null;
  }
  if (raw == null) throw new Error('judge returned no json block');
  return JSON.parse(raw);
}
// The judge must see the WHOLE outcome the run produced, not just the last commit. `HEAD~1..HEAD`
// showed one commit — for a multi-commit epic run (ship → lint → rebase → resolve) that is an
// unrepresentative slice (or empty for single-commit scenarios), which made the judge score the e8
// resolution 1/5 once for an outcome that was actually correct. Prefer the full delta the run
// introduced since it diverged from the pristine origin/main baseline; fall back for single-commit /
// uncommitted cases.
function outcomeDiff(sandboxDir) {
  const g = (args) => { try { return execFileSync('git', ['-C', sandboxDir, ...args], { cwd: sandboxDir, encoding: 'utf8' }); } catch { return ''; } };
  let diff = g(['diff', 'origin/main...HEAD']);      // full branch delta (multi-commit epic work)
  if (!diff.trim()) diff = g(['diff', 'HEAD~1', 'HEAD']); // single extra commit
  if (!diff.trim()) diff = g(['diff', 'HEAD']);           // uncommitted working-tree changes
  return diff;
}

export async function runJudge(scenario, runResult, sandboxDir) {
  // thin: a fresh headless call with the judge prompt; cost recorded separately by run.mjs
  const diff = outcomeDiff(sandboxDir);
  const prompt = buildJudgePrompt(scenario, runResult, diff);
  let costUsd = 0, lastErr;
  // Retry once: the LLM judge occasionally omits the json block. A single malformed verdict must NOT
  // abort the whole baseline (the prior crash lost ~18 runs of quota to one bad judge response).
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await runScenario({ ...scenario, prompt, denySubskills: [] }, 'HEAD', {
      model: process.env.BEF_JUDGE_MODEL ?? 'claude-sonnet-4-6', cwd: sandboxDir, env: process.env,
      pauseConvention: 'n/a', timeoutMs: 120000,
    });
    costUsd += res.totalCostUsd ?? 0;
    try { return { scores: parseJudgeResult(res.result).scores, costUsd }; }
    catch (e) { lastErr = e; }
  }
  // Unparseable after a retry → surface as an un-scored verdict (rubricGatePasses(null) fails the gate
  // for this iteration) rather than throwing and aborting every other scenario's results.
  return { scores: null, costUsd, parseError: String(lastErr?.message ?? lastErr) };
}
