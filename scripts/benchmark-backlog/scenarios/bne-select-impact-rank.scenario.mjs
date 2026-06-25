export default {
  id: 'bne-select-impact-rank', skill: 'backlog-next-epic',
  // No-arg invocation against TWO parking epics (eps-epic higher-severity, mild-epic lower). The
  // orchestrator must SURFACE a ranked candidate and PAUSE for confirmation — never auto-launch onto
  // a branch. No promotion, no branch.
  fixture: 'multi-epic-parking', prompt: '/backlog-next-epic',
  terminal: 'pause',
  state: { memberLoopEntered: false, branchCreated: false },
  // rubricGate: "no branch" alone passes even if the run paused WITHOUT ranking by impact — gate the
  // judge on the actual ranking behavior this scenario tests. (review rec 2)
  rubricGate: 4,
  rubric: ['Did no-arg selection rank the candidate epics by impact and PAUSE for confirmation, rather than silently auto-launching the top one?'],
};
