#!/usr/bin/env node
// check-no-ddb-seed-in-integration.mjs — mints from feedback_no_seeder_fixtures (§10). drift gate:
// integration fixtures populate state via events/mutations, never DdbSeedFixture / direct DDB writes.
import { fileURLToPath } from 'node:url';
import { lineOf, parseRootArg, walkFiles, reportAndExit, parseExclusions } from './lib/text-scan.mjs';

// NOTE: `.put(` intentionally has NO leading lookbehind — we WANT to match `doc.put({` (a method call);
// a `(?<![.\w])` lookbehind would reject exactly that (the char before `.` is a word char).
const TOKENS = [/\bDdbSeedFixture\b/g, /\bAccountSeedingFixture\b/g, /\bPutItem\b/g, /\bBatchWrite(Item)?\b/g, /\.put\s*\(\s*\{/g];
const SIDECAR = 'tools/ddb-seed-exclusions.json';
const isIntegration = (rel) => /\/test\/integration\//.test(rel);

export function findViolations(text, relPath, exclusions = new Set()) {
  if (!isIntegration(relPath) || exclusions.has(relPath)) return [];
  const v = [];
  for (const re of TOKENS) { re.lastIndex = 0; let m; while ((m = re.exec(text))) v.push({ rule: 'ddb-seed-in-integration', relPath, line: lineOf(text, m.index), token: m[0].trim() }); }
  return v;
}

function main() {
  const root = parseRootArg(process.argv);
  const exclusions = parseExclusions(root, SIDECAR);
  const all = [];
  for (const { relPath, text } of walkFiles(root, { includeUnder: ['services'], ext: ['.ts'] })) all.push(...findViolations(text, relPath, exclusions));
  reportAndExit('no-ddb-seed-in-integration', all);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
