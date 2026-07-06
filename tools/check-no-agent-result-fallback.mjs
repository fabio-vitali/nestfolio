#!/usr/bin/env node
// check-no-agent-result-fallback.mjs — mints from feedback_no_silent_fallback_in_agent_results (§10).
// drift gate: no `?? {}` / `?? []` fallback in advisory agent services (a missing agent-result key
// means the agent didn't run — throw, don't silently succeed). Scope-narrowing sidecar excludes vetted sites.
import { fileURLToPath } from 'node:url';
import { lineOf, parseRootArg, walkFiles, reportAndExit, parseExclusions } from './lib/text-scan.mjs';
import { exclusionsFile } from './lib/exclusions-root.mjs';

// An invocation-result fallback: `?? {}` / `?? []` where the LHS expression names an agent/orchestrator
// result (invoke/invocation/orchestrator/agent*/structured/output) — NOT every nullish-coalesce (the
// over-broad v1 flagged 38 sites incl. plain DB reads; see no-agent-result-fallback-check-overbroad).
const FALLBACK_RE = /([A-Za-z0-9_$.\)\]\?!]+)\s*\?\?\s*(\{\s*\}|\[\s*\])/g;
const AGENTISH_LHS = /\b(invoke|invocation|orchestrat\w*|agent\w*|structured\w*|\.output\b)/i;
const SIDECAR = exclusionsFile('agent-result-fallback');

export function findViolations(text, relPath, exclusions = new Set()) {
  if (!relPath.includes('/src/') || exclusions.has(relPath)) return [];
  const v = []; let m; FALLBACK_RE.lastIndex = 0;
  while ((m = FALLBACK_RE.exec(text))) {
    if (!AGENTISH_LHS.test(m[1])) continue;                    // plain nullish-coalesce (DB read etc.) — legitimate
    v.push({ rule: 'agent-result-fallback', relPath, line: lineOf(text, m.index), token: m[0] });
  }
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
