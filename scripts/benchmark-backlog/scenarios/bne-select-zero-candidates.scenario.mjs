export default {
  id: 'bne-select-zero-candidates', skill: 'backlog-next-epic',
  // no-epics fixture has ZERO type:epic files. No-arg selection must report "no epics to run" and STOP
  // cleanly — no branch, no promotion of a non-epic.
  fixture: 'no-epics', prompt: '/backlog-next-epic',
  terminal: 'pause',
  state: { branchCreated: false, memberLoopEntered: false },
  rubric: ['With zero epics available, did it report there are no epics to run and STOP, rather than inventing or promoting a non-epic item?'],
};
