#!/usr/bin/env node
// check-no-ddb-scan.mjs — mints from feedback_no_scan_no_filter (SPEC 2 §10). drift gate.
// No ScanCommand/.scan(/scanAll under services/**/src, no FilterExpression on a GSI KEY attr.
import { fileURLToPath } from 'node:url';
import { lineOf, parseRootArg, runGate, reportAndExit } from './lib/text-scan.mjs';

const SCAN_TOKENS = [/\bScanCommand\b/g, /(?<![.\w])\.scan\s*\(/g, /\bscanAll\b/g];
const KEY_ATTRS = ['__typename', 'tenantId', 'timestamp'];

export function findViolations(text, relPath) {
  if (!relPath.includes('/src/')) return [];
  const v = [];
  for (const re of SCAN_TOKENS) { re.lastIndex = 0; let m; while ((m = re.exec(text))) v.push({ rule: 'ddb-scan', relPath, line: lineOf(text, m.index), token: m[0].trim() }); }
  const feRe = /FilterExpression/g; let m;
  while ((m = feRe.exec(text))) {
    const hit = KEY_ATTRS.find((a) => text.slice(m.index, m.index + 240).includes(a));
    if (hit) v.push({ rule: 'filter-on-key-attr', relPath, line: lineOf(text, m.index), token: hit });
  }
  return v;
}

function main() { reportAndExit('no-ddb-scan', runGate(parseRootArg(process.argv), findViolations, { includeUnder: ['services'], ext: ['.ts'], excludeTest: true })); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
