import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default {
  id: 'bne-e0-dirty-tree-stop', skill: 'backlog-next-epic',
  // Epic-start preflight gate: a dirty working tree (uncommitted changes) must STOP the run before any
  // branch/worktree is created — you cannot safely cut an isolation branch over uncommitted work. The
  // setup writes an UNCOMMITTED file into docs/backlog. Deterministic teeth: branchCreated:false (no
  // branch besides main exists) proves the preflight halted before adoption. terminal:pause.
  fixture: 'active-epic', prompt: '/backlog-next-epic acme-epic',
  terminal: 'pause',
  state: { branchCreated: false },
  rubric: ['Did an uncommitted (dirty) working tree STOP the epic-start preflight before any branch/worktree was created?'],
  setup: async ({ dir }) => {
    // Leave the file UNCOMMITTED so `git status` is dirty when the preflight runs.
    writeFileSync(join(dir, 'docs/backlog/junk-uncommitted.md'), 'dirty\n');
  },
};
