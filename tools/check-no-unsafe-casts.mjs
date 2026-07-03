#!/usr/bin/env node
// check-no-unsafe-casts.mjs — mints from feedback_prefer_libraries_over_casts (§10). drift gate:
// no `as unknown as`, `as any`, or eslint-disable in production source (services/libs/apps **/src, not test/**).
import { fileURLToPath } from 'node:url';
import { lineOf, parseRootArg, walkFiles, reportAndExit, parseExclusions } from './lib/text-scan.mjs';

const TOKENS = [/\bas\s+unknown\s+as\b/g, /\bas\s+any\b/g, /eslint-disable/g];
const SIDECAR = 'tools/unsafe-cast-exclusions.json';

export function findViolations(text, relPath, exclusions = new Set()) {
  if (!relPath.includes('/src/') || /(^|\/)test\//.test(relPath) || exclusions.has(relPath)) return [];
  const v = [];
  for (const re of TOKENS) { re.lastIndex = 0; let m; while ((m = re.exec(text))) v.push({ rule: 'unsafe-cast', relPath, line: lineOf(text, m.index), token: m[0].replace(/\s+/g, ' ') }); }
  return v;
}

function main() {
  const root = parseRootArg(process.argv);
  const exclusions = parseExclusions(root, SIDECAR);
  const all = [];
  for (const { relPath, text } of walkFiles(root, { includeUnder: ['services', 'libs', 'apps'], ext: ['.ts'], excludeTest: true })) all.push(...findViolations(text, relPath, exclusions));
  reportAndExit('no-unsafe-casts', all);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
