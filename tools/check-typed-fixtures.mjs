#!/usr/bin/env node
// check-typed-fixtures.mjs — registry-driven regression gate for typed fixtures.
//
// All checks run on a COMMENT-STRIPPED copy (string/template-aware, line-numbers preserved) so a
//   putEvent(...) inside a comment is never matched.
// DYNAMIC-DETAILTYPE CHECK: a putEvent({ ... }) whose detailType is NOT statically resolvable to a
//   literal name (a string literal or an EventTypes.NAME member) is a violation — dynamic detailTypes
//   escape the typed subject:/context: overload (which binds only for a literal K). Unroll to
//   per-event literal calls.
// LEGACY-DETAIL CHECK (registry-driven): a putEvent({ ... detail: ... }) whose detailType's
//   TRAILING NAME is a registered event is a violation (use the typed subject:/context: overload).
// SUBJECT-CAST CHECK: `.subject as <Type>` used as a property value inside a putEvent({ ... }) block.
//
// Exports (for tools/check-typed-fixtures.test.mjs):
//   loadRegistry(root) -> Set<string>
//   scanFile(file, src, registered) -> { violations: string[], notes: string[] }
//   scanTree(root, registered) -> { violations, notes, fileCount }
//
// Usage: node tools/check-typed-fixtures.mjs [--root <dir>]   Exit: 1 if any violations, else 0.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

export function loadRegistry(root = ROOT) {
  const { registeredEvents } = JSON.parse(
    readFileSync(join(root, 'tools/typed-fixture-registered-events.json'), 'utf8'),
  );
  return new Set(registeredEvents);
}

function walk(dir) {
  const out = [];
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) out.push(...walk(p));
      else if (name.endsWith('.test.ts') || name.endsWith('.spec.ts')) out.push(p);
    }
  } catch {
    // directory missing / unreadable — skip
  }
  return out;
}

const SCAN_ROOTS = ['services', 'libs', 'apps/e2e-feature-tests/src'];

const SUBJECT_CAST_IN_BLOCK = /\w[\w.]*\s*:\s*.*\.subject\s+as\b/;
const PUTEVENT_START = /putEvent\s*\(\s*\{/g;
const DETAIL_TYPE_IN_BLOCK = /detailType\s*:\s*([`'"]?)(\w[\w.]*)\1/;
const HAS_DETAIL = /\bdetail\s*:/;

// brace-balanced object block starting at a putEvent match index.
function putEventBlock(src, callStart) {
  let depth = 0;
  let i = src.indexOf('{', callStart);
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.substring(callStart, i + 1); }
    i++;
  }
  return null;
}

// Strip // line and /* */ block comments, string/template-literal-aware, replacing comment
// characters with spaces (newlines preserved) so reported line numbers are unchanged. Content
// inside '...', "...", `...` is copied verbatim (a // inside a string is NOT a comment).
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = i + 1 < n ? src[i + 1] : '';
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\' && i + 1 < n) { out += ch + src[i + 1]; i += 2; continue; }
        out += ch; i++;
        if (ch === quote) break;
      }
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && i + 1 < n && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

export function scanFile(file, rawSrc, registered) {
  const src = stripComments(rawSrc);
  const violations = [];
  const notes = [];

  // detailType check — dynamic (non-literal) is banned outright; registered + detail: is legacy.
  PUTEVENT_START.lastIndex = 0;
  let match;
  while ((match = PUTEVENT_START.exec(src)) !== null) {
    const callStart = match.index;
    const lineNum = src.substring(0, callStart).split('\n').length;
    const block = putEventBlock(src, callStart);
    if (block === null) continue;
    const dtm = DETAIL_TYPE_IN_BLOCK.exec(block);
    if (!dtm) {
      violations.push(`${file}:${lineNum}: dynamic detailType — putEvent requires a literal detailType (a string or an EventTypes.NAME member); unroll to per-event literal calls and use the typed subject:/context: overload`);
      continue;
    }
    const rawName = dtm[2];
    const trailingName = rawName.includes('.') ? rawName.split('.').pop() : rawName;
    if (registered.has(trailingName)) {
      if (HAS_DETAIL.test(block)) {
        violations.push(`${file}:${lineNum}: ${trailingName} — legacy putEvent({ detail: ... }) — use the typed subject:/context: putEvent overload`);
      }
    } else if (rawName.includes('.')) {
      notes.push(`  note: ${file}:${lineNum} — compound detailType '${rawName}' (trailing '${trailingName}' not in registry), skipped`);
    }
  }

  // subject-cast check (first hit per file)
  PUTEVENT_START.lastIndex = 0;
  let castMatch;
  let found = false;
  while (!found && (castMatch = PUTEVENT_START.exec(src)) !== null) {
    const callStart = castMatch.index;
    const block = putEventBlock(src, callStart);
    if (block === null) continue;
    for (const line of block.split('\n')) {
      if (SUBJECT_CAST_IN_BLOCK.test(line)) {
        const lineNum = src.substring(0, callStart).split('\n').length;
        violations.push(`${file}:${lineNum}: '.subject as' cast inside putEvent fixture — fixtures must satisfy the producer schema by type, not cast`);
        found = true;
        break;
      }
    }
  }
  PUTEVENT_START.lastIndex = 0;

  return { violations, notes };
}

export function scanTree(root = ROOT, registered = loadRegistry(root)) {
  const violations = [];
  const notes = [];
  let fileCount = 0;
  for (const sub of SCAN_ROOTS) {
    const abs = join(root, sub);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      fileCount++;
      const r = scanFile(file, readFileSync(file, 'utf8'), registered);
      violations.push(...r.violations);
      notes.push(...r.notes);
    }
  }
  return { violations, notes, fileCount };
}

function parseArgs(argv) {
  const idx = argv.indexOf('--root');
  return { root: idx !== -1 && argv[idx + 1] ? resolve(argv[idx + 1]) : ROOT };
}

function main() {
  const { root } = parseArgs(process.argv);
  const registered = loadRegistry(root);
  const { violations, notes, fileCount } = scanTree(root, registered);
  if (notes.length) {
    process.stderr.write('check-typed-fixtures: dynamic/compound detailType sites (not flagged, verify manually):\n' + notes.join('\n') + '\n');
  }
  if (violations.length) {
    process.stderr.write('check-typed-fixtures: violations found:\n' + violations.map((v) => `  - ${v}`).join('\n') + '\n');
    process.exit(1);
  }
  console.log(`check-typed-fixtures: OK (${fileCount} test file(s) scanned, ${registered.size} registered events)`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
