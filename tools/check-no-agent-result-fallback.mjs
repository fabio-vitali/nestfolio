#!/usr/bin/env node
// check-no-agent-result-fallback.mjs — mints from feedback_no_silent_fallback_in_agent_results (§10).
// drift gate: no `?? {}` / `?? []` fallback in advisory agent services (a missing agent-result key
// means the agent didn't run — throw, don't silently succeed). Scope-narrowing sidecar excludes vetted sites.
import { fileURLToPath } from 'node:url';
import { lineOf, parseRootArg, walkFiles, reportAndExit, parseExclusions } from './lib/text-scan.mjs';

const FALLBACK_RE = /\?\?\s*(\{\s*\}|\[\s*\])/g;
const SIDECAR = 'tools/agent-result-fallback-exclusions.json';

export function findViolations(text, relPath, exclusions = new Set()) {
  if (!relPath.includes('/src/') || exclusions.has(relPath)) return [];
  const v = []; let m; FALLBACK_RE.lastIndex = 0;
  while ((m = FALLBACK_RE.exec(text))) v.push({ rule: 'agent-result-fallback', relPath, line: lineOf(text, m.index), token: m[0] });
  return v;
}

function main() {
  const root = parseRootArg(process.argv);
  const exclusions = parseExclusions(root, SIDECAR);
  const all = [];
  for (const { relPath, text } of walkFiles(root, { includeUnder: ['services/advisory'], ext: ['.ts'], excludeTest: true })) all.push(...findViolations(text, relPath, exclusions));
  reportAndExit('no-agent-result-fallback', all);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
