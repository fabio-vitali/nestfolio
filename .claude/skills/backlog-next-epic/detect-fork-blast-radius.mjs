#!/usr/bin/env node
/**
 * Blast-radius gate for /backlog-next-epic E5 case-3 auto-resolve (F-5/F-6).
 * Greps a curated manifest of shared/exported surfaces for a fork's subject
 * symbol(s). Exit 0 = no shared-surface hit (safe to auto-resolve); exit 1 =
 * hits printed (escalate to the AskUserQuestion floor); exit 2 = usage error.
 *
 * Usage: node detect-fork-blast-radius.mjs <pattern> [<pattern>...]
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Curated shared / exported surfaces. A change to any of these can ripple into a
// not-yet-worked core member, so a fork touching one is NOT safe to auto-resolve.
// Extend this list as new shared surfaces appear; entries matching nothing are inert.
export const SURFACE_PATTERNS = [
  /^libs\/event-types\/src\/.*\.ts$/,     // event contracts / names
  /^libs\/[^/]+\/src\/index\.ts$/,        // shared-lib public exports (barrel)
  /^flows\/.*\.flow\.yaml$/,              // cross-domain flow specs
  /^libs\/cdk-constructs\/src\/.*\.ts$/,  // CDK construct public APIs
];

export const isSurfaceFile = (f) => SURFACE_PATTERNS.some((re) => re.test(f));

// Exit-code contract the orchestrator's F-21 / E5 case-3 routing keys off:
//   0 = no shared-surface hit (safe to auto-resolve)
//   1 = shared-surface hit(s)  (escalate to the AskUserQuestion floor)
//   2 = usage error (no patterns given)
// Value 1 (not 10) is load-bearing: E5 case-3 reads "exit 1 = a shared-surface hit".
export const BLAST_EXIT = { SAFE: 0, ESCALATE: 1, USAGE: 2 };

/** Pure: map a shared-surface hit count to the CLI exit code the routing reads. */
export const blastExitCode = (hitCount) => (hitCount === 0 ? BLAST_EXIT.SAFE : BLAST_EXIT.ESCALATE);

/** Pure: scan fileEntries [{path, content}] for any literal pattern. */
export function scanSurfaces(patterns, fileEntries) {
  const hits = [];
  for (const { path, content } of fileEntries) {
    content.split('\n').forEach((text, i) => {
      for (const p of patterns) {
        if (p && text.includes(p)) hits.push({ path, line: i + 1, pattern: p, text: text.trim() });
      }
    });
  }
  return hits;
}

function main() {
  const patterns = process.argv.slice(2).filter(Boolean);
  if (patterns.length === 0) {
    console.error('Usage: detect-fork-blast-radius.mjs <pattern> [<pattern>...]');
    process.exit(BLAST_EXIT.USAGE);
  }
  const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
  const files = execSync('git ls-files', { cwd: repoRoot })
    .toString().split('\n').filter(Boolean).filter(isSurfaceFile);
  const entries = files.map((f) => ({ path: f, content: readFileSync(join(repoRoot, f), 'utf8') }));
  const hits = scanSurfaces(patterns, entries);
  if (hits.length === 0) {
    console.log(`✓ no shared-surface references to [${patterns.join(', ')}] — safe to auto-resolve`);
  } else {
    console.error(`✗ ${hits.length} shared-surface reference(s) — escalate to the AskUserQuestion floor:`);
    for (const h of hits) console.error(`  ${h.path}:${h.line}  [${h.pattern}]  ${h.text}`);
  }
  process.exit(blastExitCode(hits.length));
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
