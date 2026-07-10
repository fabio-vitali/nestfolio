// runtime/adapters/claude-code/git-delta.mjs — the adapter-ring branch-delta helper, shared by the
// worker-drive (run-next.mjs → runWorker) and the orchestrator-drive (run-epic.mjs → runOrchestrator).
// The `origin/main` base is a Nestfolio/host convention, so this git-diff lives in the ADAPTER ring —
// the engine spines stay project-agnostic and receive the computed delta as `changedScope` (mirroring
// how `gitHeadSha` stays a ring-1 primitive while the base-branch choice does not).
// Returns [] on any git failure OR an empty diff; deciding what an empty delta MEANS is the caller's
// job — a ship gate must fail-broad (`changedScope?.length ? … : ['**/*']`), never silently narrow.
import { execSync } from 'node:child_process';

/** File paths changed on HEAD vs `base` (merge-base three-dot). `exec` injectable for tests. */
export function branchDelta(base, exec = (c) => execSync(c, { encoding: 'utf8' })) {
  try { return exec(`git diff --name-only ${base}...HEAD`).split('\n').filter(Boolean); }
  catch { return []; }
}
