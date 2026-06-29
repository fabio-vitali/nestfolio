#!/usr/bin/env node
/**
 * Resolve the docs/backlog/ merge conflicts that arise when an epic branch meets
 * main at PR time (E8.1). Two kinds, resolved differently (F-25):
 *   - docs/BACKLOG.md (the auto-index) → REGEN_VIA_LINT: never hand-resolved;
 *     regenerated from the merged frontmatter by `node lint.mjs --fix`.
 *   - docs/backlog/<id>.md + any member file → TAKE_BRANCH_SIDE: the branch
 *     carries the shipped frontmatter; keeping main's `active` would rule-11-block
 *     the next epic. Taken via `git checkout <branch> -- <path>` (merge-direction
 *     independent — always the named branch's version).
 *   - anything else → UNKNOWN: escalate to the human floor (exit 1).
 *
 * Ordering is load-bearing: resolve TAKE_BRANCH_SIDE frontmatter FIRST, then run
 * lint --fix to render the index from the now-correct frontmatter.
 *
 * Touches ONLY git + node lint.mjs (run-for-real / end-state-graded). Never gh/nx/deploy.
 *
 * Usage: node pr-conflict-resolve.mjs --branch=<epic-branch>
 * Exit codes: 0 all resolved · 1 an UNKNOWN conflict present (escalate) · 2 usage.
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Pure: classify each conflicted path. Order is preserved. */
export function classifyConflicts(paths) {
  return paths.map((path) => {
    if (path === 'docs/BACKLOG.md') return { path, action: 'REGEN_VIA_LINT' };
    if (/^docs\/backlog\/.+\.md$/.test(path)) return { path, action: 'TAKE_BRANCH_SIDE' };
    return { path, action: 'UNKNOWN' };
  });
}

function flag(args, name) {
  const pre = `--${name}=`;
  const hit = args.find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : undefined;
}

function main() {
  const args = process.argv.slice(2);
  const branch = flag(args, 'branch');
  if (!branch) {
    console.error('Usage: pr-conflict-resolve.mjs --branch=<epic-branch>');
    process.exit(2);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
  const g = (cmd) => execSync(cmd, { cwd: repoRoot, encoding: 'utf8' }).trim();

  const conflicts = g('git diff --name-only --diff-filter=U').split('\n').filter(Boolean);
  const plan = classifyConflicts(conflicts);

  const unknown = plan.filter((e) => e.action === 'UNKNOWN');
  if (unknown.length > 0) {
    console.error(`✗ ${unknown.length} non-backlog conflict(s) — escalate to the human floor (resolve by hand):`);
    for (const e of unknown) console.error(`  ${e.path}`);
    process.exit(1);
  }

  // 1. Frontmatter FIRST — take the branch's version (carries shipped frontmatter).
  for (const e of plan.filter((p) => p.action === 'TAKE_BRANCH_SIDE')) {
    g(`git checkout ${branch} -- "${e.path}"`);
    g(`git add "${e.path}"`);
  }
  // 2. THEN regenerate the index from the now-correct frontmatter.
  const regen = plan.filter((p) => p.action === 'REGEN_VIA_LINT');
  if (regen.length > 0) {
    g(`node "${join(here, '../backlog-lint/lint.mjs')}" --fix`);
    for (const e of regen) g(`git add "${e.path}"`);
  }
  console.log(`resolved ${plan.length} docs/backlog conflict(s): ${plan.filter((p) => p.action === 'TAKE_BRANCH_SIDE').length} take-branch-side, ${regen.length} index-regen`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
