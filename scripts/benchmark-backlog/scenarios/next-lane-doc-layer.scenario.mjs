export default {
  id: 'next-lane-doc-layer', skill: 'backlog-next',
  // `next-lanes` fixture: four queued non-epic items, one per lane, NOTHING active — so
  // `/backlog-next <id>` goes straight to lane classification without tripping the active-in-flight
  // guard (the failure mode that capped next-lane-complex at judge 1/5 against active-epic).
  fixture: 'next-lanes', prompt: '/backlog-next doc-only-tweak',
  denySubskills: ['Skill(superpowers:brainstorming)', 'Skill(superpowers:executing-plans)', 'Skill(superpowers:finishing-a-development-branch)'],
  terminal: 'pause',   // classification-only: classify, then stop at the denied downstream routing
  // Deterministic proxy: the Doc-layer lane works directly on `main` and creates NO isolation branch
  // (only the Complex lane branches + worktrees). A docs-only item touching only docs/backlog must NOT
  // branch — the location-robust signal that it was classified Doc-layer, not Complex.
  state: { branchCreated: false },
  // rubricGate makes the classification assessment GATE (not informational) so a no-branch result for
  // the wrong reason (e.g. it paused before classifying at all) can't slip through the deterministic proxy.
  rubricGate: 4,
  rubric: ['Did it classify a docs-only item (touching only docs/backlog) as the Doc-layer lane — work on main, no worktree, no PR?'],
};
