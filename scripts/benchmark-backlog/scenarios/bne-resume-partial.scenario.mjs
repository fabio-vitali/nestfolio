export default {
  id: 'bne-resume-partial', skill: 'backlog-next-epic',
  // beta-epic is already ACTIVE with run-state present (phase:'mid'): beta-1/2 shipped, beta-3 open.
  // A correct resume RE-DERIVES the next open member (beta-3) WITHOUT re-promoting or re-creating the
  // branch. Deny the worker + finishing subskills so it stops at the member-work boundary.
  fixture: 'epic-3members-2shipped', runstate: { phase: 'mid' },
  prompt: '/backlog-next-epic beta-epic',
  denySubskills: ['Skill(backlog-next)', 'Skill(superpowers:finishing-a-development-branch)', 'Skill(superpowers:using-git-worktrees)'],
  terminal: 'pause',
  // It picks the next OPEN member but is denied the worker that would log 'backlog-next-worker'.
  state: { memberLoopEntered: false },
  rubric: ['Did it resume the active epic without re-promoting or re-creating the branch, and select the next OPEN member (the only non-shipped one) rather than restarting from the first?'],
};
