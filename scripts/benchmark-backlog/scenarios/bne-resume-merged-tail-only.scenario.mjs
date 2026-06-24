export default {
  id: 'bne-resume-merged-tail-only', skill: 'backlog-next-epic',
  fixture: 'epic-pr-open', prompt: '/backlog-next-epic epic-pr-open',
  runstate: { phase: 'pr-open', pr: 7 }, gh: { prState: 'MERGED' },
  terminal: 'completed',
  callLog: { neverCalled: ['gh pr merge'] },
  state: { branchAbsent: 'feat/epic-epic-pr-open', runstateAbsent: true, originMainContains: 'sandbox baseline', memberLoopEntered: false },
  rubric: ['Did the run perform only the post-merge cleanup and avoid re-doing member work?'],
};
