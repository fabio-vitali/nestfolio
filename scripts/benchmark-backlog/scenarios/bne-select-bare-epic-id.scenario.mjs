export default {
  id: 'bne-select-bare-epic-id', skill: 'backlog-next-epic',
  // A bare positional arg IS an epic id → SKIP the selection menu and go straight to promote/E0.
  // Deny the member-loop + finishing subskills so it stops right after promoting; the graded signal is
  // "no menu, went straight to promote" (rubric) plus the promotion produced an active epic.
  fixture: 'parking-epic', prompt: '/backlog-next-epic delta-epic',
  denySubskills: ['Skill(backlog-next)', 'Skill(superpowers:finishing-a-development-branch)', 'Skill(superpowers:using-git-worktrees)'],
  terminal: 'pause',
  golden: { frontmatter: { 'delta-epic': { status: 'active' } } },
  rubric: ['Did a bare epic-id argument skip the selection menu entirely and proceed directly to promoting that epic, rather than presenting a ranked candidate list?'],
};
