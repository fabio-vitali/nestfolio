export default {
  id: 'bne-e84-postflight-cwd-survival', skill: 'backlog-next-epic',
  // Post-merge tail, focused on CWD SURVIVAL (the differentiator vs bne-resume-merged-tail-only, which
  // asserts "only cleanup, no re-do member work"). At PR_OPEN_AWAITING_MERGE with the PR now MERGED, the
  // post-merge tail (epic-level checks + branch/worktree cleanup + drop run-state) must run from a
  // GUARANTEED-LIVE cwd ($MAIN), surviving the fact that the epic worktree it was launched in has been
  // removed — running cleanup from inside the about-to-be-removed worktree would strand the cwd. Asserts
  // the tail completed: run-state dropped (runstateAbsent) and the epic branch cleaned up. terminal:completed.
  fixture: 'epic-pr-open', prompt: '/backlog-next-epic epic-pr-open',
  runstate: { phase: 'pr-open', pr: 7 }, gh: { prState: 'MERGED' },
  terminal: 'completed',
  callLog: { neverCalled: ['gh pr merge'] },
  state: { runstateAbsent: true, branchAbsent: 'feat/epic-epic-pr-open' },
  rubric: ['Did the post-merge tail complete — dropping the run-state and cleaning the branch — by running from a live $MAIN cwd that survives the removed epic worktree?'],
};
