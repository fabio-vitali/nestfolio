export default {
  id: 'bne-promote-clean', skill: 'backlog-next-epic',
  // Clean promote of a fully-formed parking epic. Deny the member-loop + finishing subskills so the run
  // stops right after the promote. delta-epic already carries done_when/scope/out_of_scope, so a correct
  // promote flips status→active while keeping those present, and lands the promotion marker on origin/main.
  fixture: 'parking-epic', prompt: '/backlog-next-epic delta-epic',
  denySubskills: ['Skill(backlog-next)', 'Skill(superpowers:finishing-a-development-branch)', 'Skill(superpowers:using-git-worktrees)'],
  terminal: 'pause',
  golden: {
    frontmatter: { 'delta-epic': { status: 'active' } },
    present: [
      { file: 'delta-epic', field: 'done_when' },
      { file: 'delta-epic', field: 'scope' },
      { file: 'delta-epic', field: 'out_of_scope' },
    ],
  },
  state: { originMainContains: 'promote', memberLoopEntered: false },
  rubric: ['Did it cleanly promote the epic to active with done_when, scope, and out_of_scope all present, and commit the promotion marker to origin/main?'],
};
