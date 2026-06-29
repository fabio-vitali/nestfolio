export default {
  id: 'next-lane-design-doc', skill: 'backlog-next',
  // `next-lanes` fixture, nothing active. `design-spec-only` is a `type: design` workstream whose
  // entire done-definition is its design doc landing (no code). A spec/design-only workstream stays in
  // the Doc-layer lane — it must NOT spin up a code worktree even though it's non-trivial design work.
  fixture: 'next-lanes', prompt: '/backlog-next design-spec-only',
  denySubskills: ['Skill(superpowers:brainstorming)', 'Skill(superpowers:executing-plans)', 'Skill(superpowers:finishing-a-development-branch)'],
  // terminal:'completed' (corrected from 'pause'): the live transcript shows the Doc-layer lane runs to
  // COMPLETION — it lands the design doc on `main` and ships the item (status:shipped + validation_gate),
  // never routing through a denied downstream skill (a design that only needs its doc to LAND doesn't
  // invoke brainstorming/executing/finishing). The old 'pause' rested on a wrong "classify then stop at
  // the denied routing" theory; the real discriminator is the deterministic branchCreated:false (design
  // ≠ code → no worktree) + the classification rubric, which both pass. The deny-list is KEPT — it still
  // catches a wrong *Complex* classification (which WOULD hit denied finishing/executing and pause/error).
  terminal: 'completed',
  // Deterministic proxy: a Doc-layer (design-doc-only) workstream works on `main` and creates NO
  // isolation branch — distinguishing it from a code-bearing item that would branch+worktree. The
  // discriminator under test is "design ≠ code": done-by-doc-landing stays Doc-layer.
  state: { branchCreated: false },
  rubricGate: 4,
  rubric: ['Did it keep a spec/design-only workstream (done-definition = the design doc lands, no code) in the Doc-layer lane — no code worktree?'],
};
