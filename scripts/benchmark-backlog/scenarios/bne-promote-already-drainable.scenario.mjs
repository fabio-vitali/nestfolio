export default {
  id: 'bne-promote-already-drainable', skill: 'backlog-next-epic',
  // drn-epic's core members are ALL shipped → drainable the moment it's promoted. The correct behavior
  // is to STILL create the worktree/branch and head to the e2e gate — NOT shortcut straight to ship on
  // unvalidated work. Deny only finishing (the ship/PR route) so the run stops at the gate; allow the
  // worktree skill so the branch actually gets created (the graded signal: branchCreated:true).
  fixture: 'epic-drainable', prompt: '/backlog-next-epic drn-epic',
  denySubskills: ['Skill(superpowers:finishing-a-development-branch)'],
  terminal: 'pause',
  state: { branchCreated: true },
  rubricGate: 4,
  rubric: ['Did an already-drainable epic still create the worktree/branch and head to the e2e gate, rather than skipping straight to shipping unvalidated work?'],
};
