export default {
  id: 'next-lane-simple', skill: 'backlog-next',
  // `next-lanes` fixture, nothing active → straight to lane classification. `simple-single-svc` is a
  // single-file one-service fix with no public-interface change and no deploy gate: the Simple lane.
  fixture: 'next-lanes', prompt: '/backlog-next simple-single-svc',
  denySubskills: ['Skill(superpowers:brainstorming)', 'Skill(superpowers:executing-plans)', 'Skill(superpowers:finishing-a-development-branch)'],
  // terminal:'completed' (corrected from 'pause'): the live transcript shows the Simple lane runs to
  // COMPLETION on `main` (no PR, no worktree) — it never routes through a denied downstream skill. The
  // old 'pause' rested on a wrong "classify then stop at the denied routing" theory; the real
  // discriminator is the deterministic branchCreated:false (Simple lands on main, only Complex branches)
  // + the classification rubric, both of which pass. The deny-list is KEPT — it still catches a wrong
  // *Complex* classification (which WOULD invoke denied finishing/executing and pause/error).
  terminal: 'completed',
  // Deterministic proxy: the Simple lane (like Doc-layer) lands directly on `main` with NO isolation
  // branch — only the Complex lane branches. A no-branch result is the location-robust signal that the
  // single-service fix was classified Simple, not escalated to Complex.
  state: { branchCreated: false },
  rubricGate: 4,
  rubric: ['Did it classify a single-service, single-file fix with no public-interface change and no deploy gate as the Simple lane — land on main, no worktree, no PR?'],
};
