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
