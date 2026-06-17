#!/usr/bin/env node
// check-typed-fixtures.mjs — registry-driven regression gate for typed fixtures.
//
// LEGACY-DETAIL CHECK (registry-driven):
//   For every *.test.ts / *.spec.ts under services/**/test, libs/**/test, and
//   apps/e2e-feature-tests/src: any putEvent({ ... }) call object that both
//   (a) carries a `detail:` key AND (b) has a `detailType` whose TRAILING NAME
//   (i.e. after the last dot, or the whole identifier for bare literals) is a
//   name in the registered event registry — is a violation.
//
//   Dynamic/unresolvable detailTypes (bare runtime variables with no literal
//   name) are NOT flagged but ARE printed as `note:` lines to stderr so they
//   are never silently ignored.
//
// SUBJECT-CAST CHECK (repo-wide, same test file roots):
//   `.subject as <Type>` used as a PROPERTY VALUE in a fixture call object,
//   i.e. `key: ... .subject as Foo`. Standalone read-side assignments
//   (`const s = event.subject as T`) are assertion code and are intentionally
//   excluded from this check. This check is registry-independent.
//
// Registry source: tools/typed-fixture-registered-events.json
//   (kept in sync with the TypeScript EventSubjects registry via the
//    `libs/test-contracts/test/registry.test.ts` sync test)
//
// Usage: node tools/check-typed-fixtures.mjs
// Exit:  1 if any violations found, 0 if clean.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

// Load the registered event names from the committed JSON (cannot import TS here).
const { registeredEvents } = JSON.parse(
  readFileSync(join(root, 'tools/typed-fixture-registered-events.json'), 'utf8'),
);
const REGISTERED = new Set(registeredEvents);

// ─── file walk ──────────────────────────────────────────────────────────────

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
    // directory does not exist or is not readable — skip silently
  }
  return out;
}

// Roots to scan for test files (repo-wide for both checks).
const scanRoots = [
  join(root, 'services'),
  join(root, 'libs'),
  join(root, 'apps/e2e-feature-tests/src'),
];

const files = scanRoots.flatMap((r) => (existsSync(r) ? walk(r) : []));

// ─── patterns ───────────────────────────────────────────────────────────────

// subject-cast: `.subject as <Type>` used as a PROPERTY VALUE, i.e. preceded
// by a property key and colon on the same line (`key: ... .subject as Foo`).
// Standalone variable declarations (`const s = x.subject as T`) are
// assertion-side reads and are intentionally excluded.
const SUBJECT_CAST_LINE = /\w[\w.]*\s*:\s*.*\.subject\s+as\b/;

// putEvent call start — we collect the full brace-balanced block after this.
const PUTEVENT_START = /putEvent\s*\(\s*\{/g;

// detailType extractor — matches quoted strings and bare identifiers
// (possibly dotted, e.g. MyEnum.FOO or just FOO).
const DETAIL_TYPE_IN_BLOCK = /detailType\s*:\s*([`'"]?)(\w[\w.]*)\1/;

// presence of a `detail:` key anywhere in the block
const HAS_DETAIL = /\bdetail\s*:/;

// ─── scan ───────────────────────────────────────────────────────────────────

const violations = [];
const dynamicNotes = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');

  // ── legacy-detail check (registry-driven) ─────────────────────────────────
  PUTEVENT_START.lastIndex = 0;
  let match;
  while ((match = PUTEVENT_START.exec(src)) !== null) {
    const callStart = match.index;
    const lineNum = src.substring(0, callStart).split('\n').length;

    // Collect the brace-balanced object block.
    let depth = 0;
    let i = src.indexOf('{', callStart);
    let blockEnd = -1;
    while (i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) {
          blockEnd = i;
          break;
        }
      }
      i++;
    }
    if (blockEnd === -1) continue;

    const block = src.substring(callStart, blockEnd + 1);
    if (!HAS_DETAIL.test(block)) continue; // no `detail:` key → typed form, skip

    // Extract detailType from the block.
    const dtm = DETAIL_TYPE_IN_BLOCK.exec(block);
    if (!dtm) {
      // No resolvable literal detailType — dynamic variable, cannot evaluate.
      dynamicNotes.push(`  note: ${file}:${lineNum} — dynamic detailType (no literal name resolvable), skipped`);
      continue;
    }

    const rawName = dtm[2]; // may be 'SomeEnum.FOO' or bare 'FOO'
    // Trailing name: take everything after the last dot.
    const trailingName = rawName.includes('.') ? rawName.split('.').pop() : rawName;

    if (REGISTERED.has(trailingName)) {
      violations.push(
        `${file}:${lineNum}: ${trailingName} — legacy putEvent({ detail: ... }) — use the typed subject:/context: putEvent overload`,
      );
    } else if (rawName.includes('.')) {
      // Compound expression whose trailing name is not in the registry — not a violation,
      // but note it so compound sites are not silently ignored.
      dynamicNotes.push(
        `  note: ${file}:${lineNum} — compound detailType '${rawName}' (trailing '${trailingName}' not in registry), skipped`,
      );
    }
    // Simple literal not in registry → clean, no note needed.
  }

  // ── subject-cast check (registry-independent, repo-wide) ──────────────────
  for (const line of src.split('\n')) {
    if (SUBJECT_CAST_LINE.test(line)) {
      violations.push(
        `${file}: '.subject as' cast as fixture value — fixtures must satisfy the producer schema by type, not cast`,
      );
      break; // one violation per file is enough for the cast check
    }
  }
}

// ─── output ─────────────────────────────────────────────────────────────────

if (dynamicNotes.length) {
  process.stderr.write(
    'check-typed-fixtures: dynamic/compound detailType sites (not flagged, verify manually):\n' +
      dynamicNotes.join('\n') +
      '\n',
  );
}

if (violations.length) {
  process.stderr.write(
    'check-typed-fixtures: violations found:\n' +
      violations.map((v) => `  - ${v}`).join('\n') +
      '\n',
  );
  process.exit(1);
}

console.log(
  `check-typed-fixtures: OK (${files.length} test file(s) scanned, ${REGISTERED.size} registered events)`,
);
