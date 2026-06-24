export default {
  id: 'themes-discrimination', skill: 'backlog-themes',
  fixture: 'parking-cluster', prompt: '/backlog-themes',
  terminal: 'pause',   // proposes a cluster, awaits confirm
  rubric: ['Did it aggregate ONLY the genuine root-cause cluster and leave the decoy singleton un-clustered?'],
};
