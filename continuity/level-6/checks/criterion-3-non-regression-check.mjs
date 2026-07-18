#!/usr/bin/env node
// MI-006-R1 criterion 3 deterministic non-regression check (fixed create path,
// dependency-free). Exits 0 only if:
//  - the two dashboard-bff integration-suite files are byte-identical to their
//    bound-revision digests (the integration suite targets real deployed AWS and
//    is NOT run in a bounded local session; its non-regression is proven by
//    byte-identity — the SE-001 precedent);
//  - the two unit projection test files are byte-identical to their bound-revision
//    digests;
//  - no non-comment occurrence of USER_CONFIRMATION_REQUESTED exists under
//    services/investor/dashboard-bff/src.
// Runs with cwd == repository root (the engine's command validator spawns it so).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const PINNED = {
  'services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts':
    'aa7c11fc1e975deecb8cd5329a2c831aef5dd36e2374473831141f2d1999fc50',
  'services/investor/dashboard-bff/test/integration/read-model-projection.integration.test.ts':
    'bad65ddec03bffb7fdf78031e42d8fc69c53a3cdccee63024f990e3664b2f8e8',
  'services/investor/dashboard-bff/test/unit/handlers/awaiting-confirmation-activity-gap.test.ts':
    'c3724e16986a1751330ea02040b4716619beada67b0c12e7cefc5f6e574ec5f0',
  'services/investor/dashboard-bff/test/unit/transforms/awaiting-confirmation-activity.test.ts':
    'a2203511920c20903fc80086ecdf5c6ef963a60fc894c2f88bcf370da2580a66',
};

const failures = [];

for (const [rel, expected] of Object.entries(PINNED)) {
  const p = join(root, rel);
  if (!existsSync(p)) { failures.push(`missing: ${rel}`); continue; }
  const actual = sha256(readFileSync(p));
  if (actual !== expected) failures.push(`digest mismatch: ${rel} (${actual})`);
}

// Strip block and line comments deterministically, then scan for the dead event.
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => {
    const i = line.indexOf('//');
    return i === -1 ? line : line.slice(0, i);
  }).join('\n');

const walk = (dir) => {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    const abs = join(dir, entry);
    const s = statSync(abs);
    if (s.isDirectory()) out.push(...walk(abs));
    else if (s.isFile()) out.push(abs);
  }
  return out;
};

const srcRoot = join(root, 'services/investor/dashboard-bff/src');
let nonCommentHits = 0;
for (const abs of walk(srcRoot)) {
  const stripped = stripComments(readFileSync(abs, 'utf8'));
  if (stripped.includes('USER_CONFIRMATION_REQUESTED')) {
    nonCommentHits += 1;
    failures.push(`non-comment USER_CONFIRMATION_REQUESTED in ${relative(root, abs).split(sep).join('/')}`);
  }
}

const report = {
  check: 'mi006-r1-criterion-3-non-regression',
  integration_files_byte_identical: Object.keys(PINNED).filter((k) => k.includes('/integration/')).length === 2 && !failures.some((f) => f.includes('/integration/')),
  unit_files_byte_identical: !failures.some((f) => f.includes('/unit/')),
  dead_handler_non_comment_occurrences: nonCommentHits,
  result: failures.length === 0 ? 'pass' : 'fail',
};
process.stdout.write(`${JSON.stringify(report)}\n`);
if (failures.length) {
  for (const f of failures) process.stderr.write(`${f}\n`);
  process.exit(1);
}
process.exit(0);
