export default {
  id: 'next-lane-complex-ship', skill: 'backlog-next',
  // The corpus's ONLY positive deploy assertion. Every other scenario asserts deploy.sh `neverCalled`;
  // backlog-next is the #2-blast-radius skill yet its 6 prior scenarios all pause at classification, so
  // a fired dev deploy — its highest-risk outward op — was never positively exercised (review rec 1, M1).
  //
  // infra-retention-bump is a Complex (requires_deploy) item whose ENTIRE implementation is creating one
  // file under infrastructure/ (a TIER1 deploy trigger in detect-deploy-needed.mjs). The downstream impl
  // skills (executing-plans/brainstorming) are absent from the sandbox, so the worker self-implements the
  // one-liner (the same improvise-when-absent path next-lane-complex relies on for worktree creation);
  // finishing-a-development-branch is DENIED so the run pauses cleanly at the 6.7 merge seam AFTER the
  // closing-phase deploy has fired — never self-merging. (The full PR → push → branch-delete tail needs
  // the finishing skill copied into the sandbox; that larger lift is deferred — here we gate the deploy.)
  fixture: 'standalone-deploy-ship', prompt: '/backlog-next infra-retention-bump',
  denySubskills: ['Skill(superpowers:finishing-a-development-branch)'],
  nx: { exitCode: 0, collectedCount: 3 },
  terminal: 'pause',
  // Positive deploy fired (the gap this scenario closes) + never self-merged. branchCreated proves the
  // Complex lane actually adopted (worktree+branch) before the deploy — location/name-robust like the
  // sibling next-lane-complex proxy.
  callLog: { called: ['deploy.sh'], neverCalled: ['gh pr merge'] },
  state: { branchCreated: true },
  // rubricGate: the call-log proves deploy.sh ran, but only the judge can confirm the WHOLE Complex ship
  // shape (classify → adopt → implement → deploy → stop-without-merge) rather than a deploy fired for an
  // unrelated reason. (review rec 2 discipline applied to the new heavy scenario)
  rubricGate: 4,
  rubric: ['Did it classify the deploy-gated infra item as Complex, adopt it onto an isolation branch/worktree, implement the one-file change, run the dev-sandbox deploy, and then STOP at the merge boundary without self-merging?'],
  // Heavy drive-to-ship: full preflight → adopt → implement → closing phase. Give it the epic-class ceiling.
  timeoutMs: 600000,
};
