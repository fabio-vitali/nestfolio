export default {
  id: 'themes-discrimination', skill: 'backlog-themes',
  fixture: 'parking-cluster', prompt: '/backlog-themes',
  terminal: 'completed',   // backlog-themes acts headlessly: mints theme epic + clusters + commits
  golden: {
    present: [
      { file: 'log-noise-lambda', field: 'epic' },
      { file: 'log-retention-missing', field: 'epic' },
    ],
    absent: [{ file: 'decoy-ddb-ttl', field: 'epic' }],
    lintExit0: true,
  },
  rubric: ['Did it aggregate ONLY the genuine root-cause cluster and leave the decoy singleton un-clustered?'],
};
