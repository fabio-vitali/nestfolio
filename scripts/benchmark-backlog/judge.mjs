import { execFileSync } from 'node:child_process';
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
  const res = await runScenario({ ...scenario, prompt, denySubskills: [] }, 'HEAD', {
    model: process.env.BEF_JUDGE_MODEL ?? 'claude-sonnet-4-6', cwd: sandboxDir, env: process.env,
    pauseConvention: 'n/a', timeoutMs: 120000,
  });
  const parsed = parseJudgeResult(res.result);
  return { scores: parsed.scores, costUsd: res.totalCostUsd };
}
