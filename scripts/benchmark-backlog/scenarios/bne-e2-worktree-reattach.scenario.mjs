export default {
  id: 'bne-e2-worktree-reattach', skill: 'backlog-next-epic',
  // The resume path where the branch EXISTS but its worktree was pruned. The correct move is
  // `git worktree add .claude/worktrees/epic-beta-epic feat/epic-beta-epic` (re-attach, WITHOUT -b);
  // a wrong re-create (`worktree add -b feat/epic-beta-epic`) ERRORS because the branch already exists,
  // so the member loop never enters and the worker never runs. That makes reattach-vs-recreate a
  // DETERMINISTIC distinction after all: the stub call-log shows the loop drove beta-3 (the only open
  // member) iff the reattach succeeded. We therefore gate on judge-free callLog teeth (mirroring the
  // shipped bne-resume-partial / bne-promote-clean pattern) and DROP the prior flaky rubricGate:4 — the
  // "did it reattach" rubric swung the same way the sibling bef-resume-partial-scenario-flaky did, since
  // a procedural judgment with no clean golden flip is exactly what a deterministic tooth should replace.
  // beta-3 is still active, so a resume re-derives the next open member rather than re-promoting.
  fixture: 'epic-3members-2shipped', prompt: '/backlog-next-epic beta-epic',
  runstate: { phase: 'mid' },        // resume into an in-flight epic (not a fresh promote)
  // Same heavy resume → reattach → loop → ship → PR path as bne-resume-partial (~50 turns) — headroom.
  timeoutMs: 900000,
  terminal: 'pause',
  state: { branchExists: 'feat/epic-beta-epic' },
  // Deterministic gate: the reattach succeeded iff the loop drove the only OPEN member (beta-3) and never
  // re-drove the shipped ones (beta-1/beta-2). A botched re-create (`worktree add -b`) would error on the
  // existing branch → the loop never runs the worker → these teeth fail RED. Judge-free, cwd-robust
  // (absolute BEF_STUBS_LOG). Replaces the flaky rubricGate:4.
  callLog: {
    called: ['backlog-next-worker beta-3'],
    neverCalled: ['backlog-next-worker beta-1', 'backlog-next-worker beta-2'],
  },
  // Informational only (no rubricGate): the callLog teeth above deterministically prove the reattach,
  // so the judge no longer gates (the previous rubricGate:4 swung like bef-resume-partial did).
  rubric: ['With the epic branch already present but its worktree pruned, did the run RE-ATTACH the worktree to the existing branch rather than re-creating the branch?'],
  setup: async ({ dir, git }) => {
    // Branch exists; no worktree is attached (the prune state). On resume the skill must re-attach the
    // worktree to feat/epic-beta-epic, not re-create it. We create the branch and immediately return to
    // main so the sandbox checkout is clean — leaving the branch dangling without a worktree.
    git(dir, 'branch', 'feat/epic-beta-epic');
    git(dir, 'worktree', 'prune');
  },
};
