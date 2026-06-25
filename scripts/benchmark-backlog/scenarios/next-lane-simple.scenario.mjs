export default {
  id: 'next-lane-simple', skill: 'backlog-next',
  // `next-lanes` fixture, nothing active → straight to lane classification. `simple-single-svc` is a
  // single-file one-service fix with no public-interface change and no deploy gate: the Simple lane.
  fixture: 'next-lanes', prompt: '/backlog-next simple-single-svc',
  denySubskills: ['Skill(superpowers:brainstorming)', 'Skill(superpowers:executing-plans)', 'Skill(superpowers:finishing-a-development-branch)'],
  terminal: 'pause',   // classification-only: classify, then stop at the denied downstream routing
  // Deterministic proxy: the Simple lane (like Doc-layer) lands directly on `main` with NO isolation
  // branch — only the Complex lane branches. A no-branch result is the location-robust signal that the
  // single-service fix was classified Simple, not escalated to Complex.
  state: { branchCreated: false },
  rubricGate: 4,
  rubric: ['Did it classify a single-service, single-file fix with no public-interface change and no deploy gate as the Simple lane — land on main, no worktree, no PR?'],
};
