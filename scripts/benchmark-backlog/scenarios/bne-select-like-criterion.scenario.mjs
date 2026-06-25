export default {
  id: 'bne-select-like-criterion', skill: 'backlog-next-epic',
  // --like passes a free-text ranking criterion. The orchestrator must rank candidates BY that
  // criterion and PAUSE to confirm — not auto-launch. No branch.
  fixture: 'multi-epic-parking', prompt: '/backlog-next-epic --like "cost cleanup"',
  terminal: 'pause',
  state: { memberLoopEntered: false, branchCreated: false },
  // rubricGate: the proxy can't verify the ranking honored the --like criterion — gate the judge so a
  // pause that ignored "cost cleanup" can't pass. (review rec 2)
  rubricGate: 4,
  rubric: ['Did --like rank the candidate epics by the given criterion (relevance to "cost cleanup") and PAUSE for confirmation rather than auto-launching?'],
};
