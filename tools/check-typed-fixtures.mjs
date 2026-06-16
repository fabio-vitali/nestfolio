#!/usr/bin/env node
// check-typed-fixtures.mjs — regression gate for migrated fixture dirs.
//
// In dirs declared "migrated" (tools/typed-fixture-migrated.json), a putEvent
// fixture MUST use the typed `subject:`/`context:` form. Two legacy patterns are
// forbidden:
//
//   legacy-detail    — putEvent call object carrying a `detail:` key.  The typed
//                      overload routes through subject+context; passing `detail:`
//                      means the fixture still uses the untyped legacy form.
//
//   subject-cast     — `.subject as <Type>` used as a PROPERTY VALUE in a fixture
//                      call object, i.e. `subject: expr.subject as Foo`.  Typed
//                      fixtures satisfy the producer schema by construction; casts
//                      indicate the old approach of threading an untyped subject
//                      through `detail:`. Standalone read-side assignments
//                      (`const s = event.subject as T`) are assertion code and are
//                      intentionally excluded from this check.
//
// The test-layer analogue of tools/check-typed-subjects.mjs.
//
// Usage: node tools/check-typed-fixtures.mjs
// Scope: *.test.ts files under each dir in tools/typed-fixture-migrated.json.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const { migratedDirs } = JSON.parse(
  readFileSync(join(root, 'tools/typed-fixture-migrated.json'), 'utf8'),
);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

// legacy-detail: a putEvent(...) call object that carries a `detail:` key.
// The regex is deliberately non-greedy — it matches from `putEvent({` through
// the first `detail:` it encounters within that call.
const DETAIL_IN_PUTEVENT = /putEvent\s*\(\s*\{[\s\S]*?\bdetail\s*:/;

// subject-cast: `.subject as <Type>` used as a PROPERTY VALUE, i.e. preceded
// by a property key and colon on the same line (`key: ... .subject as Foo`).
// This excludes standalone variable declarations (`const s = x.subject as T`)
// which are assertion-side reads, not fixture inputs.
// Pattern: line contains `<identifier>:` before `.subject as`.
const SUBJECT_CAST_LINE = /\w[\w.]*\s*:\s*.*\.subject\s+as\b/;

const violations = [];

for (const rel of migratedDirs) {
  const abs = join(root, rel);
  let files;
  try {
    files = walk(abs);
  } catch {
    continue;
  }

  for (const file of files) {
    const src = readFileSync(file, 'utf8');

    // Check 1: legacy-detail — any putEvent with a `detail:` key.
    if (DETAIL_IN_PUTEVENT.test(src)) {
      violations.push(
        `${file}: legacy untyped putEvent({ detail: ... }) — use the typed subject:/context: form`,
      );
    }

    // Check 2: subject-cast — `.subject as <Type>` as a property value in a
    // fixture object (not a standalone read-side assignment).
    for (const line of src.split('\n')) {
      if (SUBJECT_CAST_LINE.test(line)) {
        violations.push(
          `${file}: '.subject as' cast as fixture value — fixtures must satisfy the producer schema by type, not cast`,
        );
        break; // one violation per file is enough
      }
    }
  }
}

if (violations.length) {
  console.error(
    'check-typed-fixtures: violations found in migrated dirs:\n' +
      violations.map((v) => `  - ${v}`).join('\n'),
  );
  process.exit(1);
}
console.log(
  `check-typed-fixtures: OK (${migratedDirs.length} migrated dir(s) clean)`,
);
