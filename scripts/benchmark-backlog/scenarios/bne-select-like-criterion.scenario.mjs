export default {
  id: 'bne-select-like-criterion', skill: 'backlog-next-epic',
  // --like passes a free-text ranking criterion. The orchestrator must rank candidates BY that
  // criterion and PAUSE to confirm — not auto-launch. No branch.
  fixture: 'multi-epic-parking', prompt: '/backlog-next-epic --like "cost cleanup"',
  terminal: 'pause',
  state: { memberLoopEntered: false, branchCreated: false },
  rubric: ['Did --like rank the candidate epics by the given criterion (relevance to "cost cleanup") and PAUSE for confirmation rather than auto-launching?'],
};
