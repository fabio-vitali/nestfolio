export default {
  id: 'next-lane-complex', skill: 'backlog-next',
  // Dedicated fixture with the single queued item and NO active in-flight workstream: against the
  // `active-epic` fixture the active member (acme-1) tripped the active-in-flight guard, so the run
  // paused to ask resume-vs-switch and never reached the lane verdict (the thin gate still passed —
  // judge 1/5). With nothing active, `/backlog-next standalone-complex` proceeds straight to Step-3
  // classification.
  fixture: 'standalone-complex', prompt: '/backlog-next standalone-complex',
  denySubskills: ['Skill(superpowers:brainstorming)', 'Skill(superpowers:executing-plans)', 'Skill(superpowers:finishing-a-development-branch)'],
  terminal: 'pause',   // classification-only: adopt then stop at the denied downstream routing — AND the
  // deterministic discriminator. Only the Complex lane routes to a denied downstream skill and PAUSES;
  // Doc-layer/Simple complete on `main` (cf. next-lane-simple / next-lane-doc-layer `terminal:'completed'`).
  //
  // De-flaked (bef-branchcreated-assertion-enterworktree-flaky, core member of bef-deterministic-coverage-gaps).
  // The former `state: { branchCreated: true }` deterministic proxy flipped ~1/4: under headless `claude -p`
  // the worker sometimes pauses at the denied `brainstorming` routing BEFORE finishing branch-creation, so
  // the proxy rode a nondeterministic MULTI-STEP worker action → a false REGRESSION on a single-iteration
  // `compare`. No deterministic substitute exists in the classify-only path: a call-log tooth is forbidden
  // (structural-lint requires every call-log entry to be a STUB_BINARY, and the classify-only Complex path
  // fires NONE — it pauses before the closing phase that would invoke deploy.sh/gh/nx), and lane
  // classification is irreducible model judgment with no code predicate to unit-test. So the deterministic
  // signal moves onto the stable `terminal:'pause'` axis — evidenced stable on the very run where
  // branchCreated flipped (the failing diagnostic reported only `branchCreated=false`, never a terminal
  // mismatch). The deterministic Complex-*adoption* coverage (worktree+branch+deploy+PR) lives in
  // next-lane-complex-ship, whose stub-binary call-log (`deploy.sh` + `gh pr create`) is non-flaky because
  // reaching those ops REQUIRES completed adoption. Same discipline as the shipped bne-resume-partial
  // (swapped a flaky proxy for deterministic teeth).
  //
  // rubricGate keeps the classification assessment GATING: `terminal:'pause'` alone can't tell a correct
  // Complex classification from a WRONG escalation (both pause at a denied downstream), so the judge
  // confirms it classified Complex for the right reason. This is the one scenario whose positive proxy is
  // irreducibly model-coupled, so the rubric gate carries classification correctness here.
  rubricGate: 4,
  rubric: ['Did it classify a public-interface-changing item as the Complex lane (worktree + PR), not Simple or Doc-layer?'],
};
