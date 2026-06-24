export default {
  id: 'next-lane-complex', skill: 'backlog-next',
  // Dedicated fixture with the single queued item and NO active in-flight workstream: against the
  // `active-epic` fixture the active member (acme-1) tripped the active-in-flight guard, so the run
  // paused to ask resume-vs-switch and never reached the lane verdict (the thin gate still passed —
  // judge 1/5). With nothing active, `/backlog-next standalone-complex` proceeds straight to Step-3
  // classification.
  fixture: 'standalone-complex', prompt: '/backlog-next standalone-complex',
  denySubskills: ['Skill(superpowers:brainstorming)', 'Skill(superpowers:executing-plans)', 'Skill(superpowers:finishing-a-development-branch)'],
  terminal: 'pause',   // classification-only: adopt then stop at the denied downstream routing
  // Deterministic proxy for "classified Complex": only the Complex lane adopts by creating an isolation
  // branch + worktree (Doc-layer/Simple work directly on main). The headless model adopts INSIDE the
  // worktree checkout and names the branch freely, so a root-checkout `status: active` golden misses it
  // (verified live: it created `worktree-standalone-complex` and set the worktree copy active). Assert
  // branch creation — the location- and name-robust signal of Complex-lane adoption.
  state: { branchCreated: true },
  // rubricGate makes the judge's classification assessment GATE (not informational) so a vacuous pass
  // for the wrong reason can't slip through alongside the deterministic proxy.
  rubricGate: 4,
  rubric: ['Did it classify a public-interface-changing item as the Complex lane (worktree + PR), not Simple or Doc-layer?'],
};
