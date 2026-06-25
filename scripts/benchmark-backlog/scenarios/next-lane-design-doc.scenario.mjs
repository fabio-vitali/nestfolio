export default {
  id: 'next-lane-design-doc', skill: 'backlog-next',
  // `next-lanes` fixture, nothing active. `design-spec-only` is a `type: design` workstream whose
  // entire done-definition is its design doc landing (no code). A spec/design-only workstream stays in
  // the Doc-layer lane — it must NOT spin up a code worktree even though it's non-trivial design work.
  fixture: 'next-lanes', prompt: '/backlog-next design-spec-only',
  denySubskills: ['Skill(superpowers:brainstorming)', 'Skill(superpowers:executing-plans)', 'Skill(superpowers:finishing-a-development-branch)'],
  terminal: 'pause',   // classification-only: classify, then stop at the denied downstream routing
  // Deterministic proxy: a Doc-layer (design-doc-only) workstream works on `main` and creates NO
  // isolation branch — distinguishing it from a code-bearing item that would branch+worktree. The
  // discriminator under test is "design ≠ code": done-by-doc-landing stays Doc-layer.
  state: { branchCreated: false },
  rubricGate: 4,
  rubric: ['Did it keep a spec/design-only workstream (done-definition = the design doc lands, no code) in the Doc-layer lane — no code worktree?'],
};
