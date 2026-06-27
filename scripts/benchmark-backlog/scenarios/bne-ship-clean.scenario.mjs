export default {
  id: 'bne-ship-clean', skill: 'backlog-next-epic',
  // The happy-path ship: drn-epic is drainable at start, the batched gate is GREEN (nx exit 0 with a
  // real collected count — exit 0 + 0 collected is the false-green the E6 scenario covers separately),
  // and the PR opens cleanly. Asserts the full ship triad on the epic file (shipped + closed + a
  // validation_gate scalar) plus the merge-ownership boundary: a PR is created but NEVER self-merged,
  // the branch is kept (E8 leaves it for the human merge), and the worktree is removed.
  fixture: 'epic-drainable', prompt: '/backlog-next-epic drn-epic',
  nx: { exitCode: 0, collectedCount: 5 },
  gh: { prState: 'OPEN' },
  terminal: 'pause',
  // The ship (status: shipped + closed + validation_gate) is committed on the epic branch
  // feat/epic-drn-epic; the sandbox root stays on main (the E1 promote marker leaves it active). So the
  // golden MUST read the branch — a root read sees active+closed-absent for a correct E8 (the
  // sub-worktree-blindness; see grade.mjs loadBranchFilesById + bef-judge-blind-to-subworktree-diff).
  golden: {
    onBranch: 'feat/epic-drn-epic',
    frontmatter: { 'drn-epic': { status: 'shipped' } },
    present: [{ file: 'drn-epic', field: 'closed' }, { file: 'drn-epic', field: 'validation_gate' }],
  },
  callLog: { called: ['gh pr create'], neverCalled: ['gh pr merge'] },
  // worktree removed at E8 cleanup; branch kept for the human to merge (no self-merge). Worktree path =
  // .claude/worktrees/epic-<epic-id>; branch = feat/epic-<epic-id> (epic id is drn-epic, not the fixture).
  state: { worktreeAbsent: '.claude/worktrees/epic-drn-epic', branchExists: 'feat/epic-drn-epic' },
  rubric: ['Clean ship: epic ends shipped+closed with a validation_gate, a PR is opened, the branch is kept, the worktree is removed, and the run never self-merges?'],
};
