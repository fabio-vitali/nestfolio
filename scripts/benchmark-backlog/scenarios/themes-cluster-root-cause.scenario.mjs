export default {
  id: 'themes-cluster-root-cause', skill: 'backlog-themes',
  fixture: 'parking-cluster', prompt: '/backlog-themes',
  terminal: 'completed',   // backlog-themes acts headlessly: mints the theme epic, repoints members, commits
  // POSITIVE-clustering framing (companion to themes-discrimination's negative/decoy framing): the two
  // log-retention orphans share ONE root cause — the shared CDK log-group construct sets no retention
  // policy — so a correct run mints a theme epic and points BOTH at it via `epic:`. The decoy (idle NAT)
  // shares only the "AWS cost" symptom with a clearly different root cause, so it must stay un-clustered.
  golden: {
    present: [
      { file: 'log-retention-missing', field: 'epic' },
      { file: 'log-retention-lambda', field: 'epic' },
    ],
    absent: [{ file: 'decoy-idle-nat', field: 'epic' }],
    lintExit0: true,   // the minted theme epic + repointed members must leave the backlog rule-clean (incl. pointer integrity)
  },
  rubricGate: 4,
  rubric: ['Did it cluster the two orphans by their shared ROOT CAUSE (the no-retention CDK log-group construct), not the surface cost symptom, and mint a well-formed theme epic (status: parking, done_when/scope/out_of_scope present) that both members point at?'],
};
