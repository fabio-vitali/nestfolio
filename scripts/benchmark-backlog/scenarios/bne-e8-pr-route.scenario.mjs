export default {
  id: 'bne-e8-pr-route', skill: 'backlog-next-epic',
  // E8 merge-ownership boundary: the epic ships via a SINGLE PR that the run OPENS and composes a body
  // for, then STOPS — the human owns the merge. Asserts `gh pr create` present, `gh pr merge` absent,
  // the branch kept (for the human merge), and the worktree removed at cleanup. Epic id is drn-epic, so
  // the branch/worktree are feat/epic-drn-epic / .claude/worktrees/epic-drn-epic.
  fixture: 'epic-drainable', prompt: '/backlog-next-epic drn-epic',
  gh: { prState: 'OPEN' },
  terminal: 'pause',
  callLog: { called: ['gh pr create'], neverCalled: ['gh pr merge'] },
  state: { branchExists: 'feat/epic-drn-epic', worktreeAbsent: '.claude/worktrees/epic-drn-epic' },
  rubric: ['At the ship boundary did it open a PR and compose its body, then STOP at the open PR without self-merging?'],
};
