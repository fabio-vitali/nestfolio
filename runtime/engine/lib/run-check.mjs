#!/usr/bin/env node
// run-check.mjs — runCheck(): enforce the honesty rule (a check never runs in a context it did not
// declare, §6), else resolve+run the evaluator and tag findings with check.kind. CLI: 0 clean, 1 findings, 2 usage.
import { fileURLToPath } from 'node:url';
import { resolveEvaluator } from './resolve-evaluator.mjs';

export async function runCheck({ check, context }) {
  if (!check.contexts.includes(context)) {
    return { findings: [], ran: false, skippedReason: 'context-not-declared' };
  }
  const { invoke } = resolveEvaluator({ check });
  const findings = await invoke();
  return { findings: findings.map((f) => ({ ...f, kind: check.kind })), ran: true };
}

function main() {
  const id = process.argv[2];
  const ctxArg = process.argv.indexOf('--context');
  const context = ctxArg >= 0 ? process.argv[ctxArg + 1] : undefined;
  if (!id || !context) { console.error('usage: run-check.mjs <check-id> --context <gate|audit|invariant>'); process.exit(2); }
  // Ring-1 CLI stub: turning <check-id> into a CheckEntry needs a loaded registry (SPEC 3's watch engine).
  console.error('run-check.mjs CLI requires a loaded registry; use via the watch engine (SPEC 3).');
  process.exit(2);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
