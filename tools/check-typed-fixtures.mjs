#!/usr/bin/env node
// check-typed-fixtures.mjs — registry-driven regression gate for typed fixtures.
//
// LEGACY-DETAIL CHECK (registry-driven): a putEvent({ ... detail: ... }) whose detailType's
//   TRAILING NAME is a registered event is a violation (use the typed subject:/context: overload).
// SUBJECT-CAST CHECK: `.subject as <Type>` used as a property value inside a putEvent({ ... }) block.
//
// Exports (for tools/check-typed-fixtures.test.mjs):
//   loadRegistry(root) -> Set<string>
//   scanFile(file, src, registered) -> { violations: string[], notes: string[] }
//   scanTree(root, registered) -> { violations, notes, fileCount }
//
// Usage: node tools/check-typed-fixtures.mjs   Exit: 1 if any violations, else 0.

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

export function scanFile(file, src, registered) {
  const violations = [];
  const notes = [];

  // legacy-detail check
  PUTEVENT_START.lastIndex = 0;
  let match;
  while ((match = PUTEVENT_START.exec(src)) !== null) {
    const callStart = match.index;
    const lineNum = src.substring(0, callStart).split('\n').length;
    const block = putEventBlock(src, callStart);
    if (block === null) continue;
    if (!HAS_DETAIL.test(block)) continue; // typed form → skip
    const dtm = DETAIL_TYPE_IN_BLOCK.exec(block);
    if (!dtm) {
      notes.push(`  note: ${file}:${lineNum} — dynamic detailType (no literal name resolvable), skipped`);
      continue;
    }
    const rawName = dtm[2];
    const trailingName = rawName.includes('.') ? rawName.split('.').pop() : rawName;
    if (registered.has(trailingName)) {
      violations.push(`${file}:${lineNum}: ${trailingName} — legacy putEvent({ detail: ... }) — use the typed subject:/context: putEvent overload`);
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

function main() {
  const registered = loadRegistry();
  const { violations, notes, fileCount } = scanTree(ROOT, registered);
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
