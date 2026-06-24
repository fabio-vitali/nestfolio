export default {
  id: 'themes-discrimination', skill: 'backlog-themes',
  fixture: 'parking-cluster', prompt: '/backlog-themes',
  terminal: 'completed',   // backlog-themes acts headlessly: mints theme epic + clusters + commits
  // Unambiguous discrimination: the two cluster members share ONE root cause (CDK log-group construct
  // sets no retention policy); the decoy shares only the "AWS cost" symptom but a clearly different
  // root cause (orphaned idle NAT, flat cost, no retention/lifecycle/growth axis). The prior fixture's
  // ddb-ttl decoy shared "missing lifecycle/retention policy → unbounded growth" with log-retention, so
  // clustering it was defensible (the flip the baseline exposed) — the golden was under-determined.
  golden: {
    present: [
      { file: 'log-retention-missing', field: 'epic' },
      { file: 'log-retention-lambda', field: 'epic' },
    ],
    absent: [{ file: 'decoy-idle-nat', field: 'epic' }],
    lintExit0: true,
  },
  rubric: ['Did it aggregate ONLY the genuine shared-root-cause cluster and leave the cost-symptom-only decoy as an un-clustered singleton?'],
};
