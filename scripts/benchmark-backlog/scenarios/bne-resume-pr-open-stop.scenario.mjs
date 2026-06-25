export default {
  id: 'bne-resume-pr-open-stop', skill: 'backlog-next-epic',
  // Run-state is at the PR_OPEN_AWAITING_MERGE marker (phase:'pr-open' → sandbox sets the e8 PR-open
  // state) and the PR is still OPEN. A resume here must just re-print the PR link and STOP — no member
  // loop, no self-merge.
  fixture: 'epic-pr-open', runstate: { phase: 'pr-open', pr: 7 }, gh: { prState: 'OPEN' },
  prompt: '/backlog-next-epic epic-pr-open',
  terminal: 'pause',
  callLog: { neverCalled: ['gh pr merge'] },
  state: { memberLoopEntered: false },
  rubric: ['With an already-open PR awaiting merge, did it just surface the PR link and STOP, without re-entering the member loop or self-merging?'],
};
