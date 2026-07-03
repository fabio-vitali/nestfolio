#!/usr/bin/env node
// check-no-states-runtime-catch.mjs — mints from feedback_states_runtime_uncatchable (§10). drift gate:
// no SF Catch/Retry whose ErrorEquals/errors includes States.Runtime (it silently never fires).
import { fileURLToPath } from 'node:url';
import { lineOf, parseRootArg, runGate, reportAndExit, parseExclusions } from './lib/text-scan.mjs';

// A States.Runtime literal within ~120 chars after an ErrorEquals/errors/addCatch/addRetry context.
const RE = /(ErrorEquals|errors|addCatch|addRetry)[\s\S]{0,120}?States\.Runtime/g;
const SIDECAR = 'tools/states-runtime-exclusions.json';

export function findViolations(text, relPath, exclusions = new Set()) {
  if (!relPath.includes('/src/') || exclusions.has(relPath)) return [];
  const v = []; let m; RE.lastIndex = 0;
  while ((m = RE.exec(text))) v.push({ rule: 'states-runtime-catch', relPath, line: lineOf(text, m.index), token: 'States.Runtime' });
  return v;
}

function main() {
  const root = parseRootArg(process.argv);
  const exclusions = parseExclusions(root, SIDECAR);
  reportAndExit('no-states-runtime-catch', runGate(root, (text, relPath) => findViolations(text, relPath, exclusions), { includeUnder: ['services', 'libs', 'infrastructure'], ext: ['.ts'], excludeTest: true }));
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
