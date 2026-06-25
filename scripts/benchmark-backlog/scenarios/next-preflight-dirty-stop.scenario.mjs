import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default {
  id: 'next-preflight-dirty-stop', skill: 'backlog-next',
  // `standalone-complex` is the Complex-lane item; with nothing active the run reaches preflight. The
  // setup dirties the working tree (an uncommitted untracked file) BEFORE the run starts — preflight
  // must refuse to adopt a workstream onto a dirty tree and STOP rather than branch over uncommitted work.
  fixture: 'standalone-complex', prompt: '/backlog-next standalone-complex',
  // Seed the dirty state after the sandbox's runstate/baseline so the file is genuinely uncommitted at run start.
  setup: async ({ dir }) => { writeFileSync(join(dir, 'UNCOMMITTED_LOCAL_EDIT.txt'), 'dirty working tree\n'); },
  terminal: 'pause',   // a dirty tree is a preflight STOP — Claude asks the user to clean up, not proceeds
  // Deterministic proxy: a clean preflight STOP must NOT have adopted the item onto an isolation branch.
  // No new branch is the location-robust signal that preflight aborted before lane adoption.
  state: { branchCreated: false },
  rubricGate: 4,
  rubric: ['Did a dirty working tree at preflight STOP the run (refuse to adopt) rather than branch/worktree over the uncommitted changes?'],
};
