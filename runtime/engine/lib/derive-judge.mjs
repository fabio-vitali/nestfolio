// runtime/engine/lib/derive-judge.mjs — the judgment seam derived from the DECLARED runProcedure
// capability (re-freeze 2026-07-03): no seventh capability. A `skill:<name>` evaluator runs as
// runProcedure(name, { check }) and the findings return in TaskResult.findings.
import { fileURLToPath } from 'node:url';
import { parseRun } from '../schema/check.schema.ts';

/** @returns a judge fn for resolveEvaluator, or undefined when the host declares no runProcedure. */
export function deriveJudge(runProcedure) {
  if (!runProcedure) return undefined;
  return async function judge(check) {
    const parsed = parseRun(check.evaluator.run);
    const res = await runProcedure(parsed.target, { check });
    if (res.status !== 'done') throw new Error(`judge procedure ${parsed.target}: ${res.summary}`);
    return res.findings ?? [];
  };
}

function main() { console.error('derive-judge.mjs is a library; import deriveJudge'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
