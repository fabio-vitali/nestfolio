export default {
  id: 'bne-resume-absent-fresh', skill: 'backlog-next-epic',
  // No run-state on disk → the orchestrator must treat this as a FRESH run (promote + branch),
  // NOT a resume. Deny the member-loop + finishing subskills so it STOPS right after promoting,
  // before any member work — making the "fresh promote, not resume" decision the only thing graded.
  fixture: 'parking-epic', prompt: '/backlog-next-epic delta-epic',
  denySubskills: ['Skill(backlog-next)', 'Skill(superpowers:finishing-a-development-branch)', 'Skill(superpowers:using-git-worktrees)'],
  terminal: 'pause',
  golden: { frontmatter: { 'delta-epic': { status: 'active' } } },
  // Promotion writes the marker to origin/main (the doc-layer promote commit), and no member loop ran.
  state: { originMainContains: 'promote', memberLoopEntered: false },
  rubric: ['With no run-state on disk, did it treat the run as fresh (promote + new branch) rather than attempting a resume of a non-existent in-flight run?'],
};
