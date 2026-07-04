export default {
  id: 'next-auto-finishing-pr-stop', skill: 'backlog-next',
  // Complex drive-to-ship under --auto: adopt (worktree+branch) → implement the one-file infra change
  // → dev deploy → ship on the branch → close. In --auto the close takes the PR route and STOPS at the
  // open PR for the human merge — never `gh pr merge`, never a local merge. The auto-resolved close
  // is a logged decision; the decision-log section lands on the BRANCH (sandbox root stays
  // pre-adoption), so it is judge-verified via the rubric, not fileContains (root-only).
  fixture: 'standalone-deploy-ship', prompt: '/backlog-next infra-retention-bump --auto', auto: true,
  nx: { exitCode: 0, collectedCount: 3 },
  terminal: 'pause',
  callLog: { called: ['deploy.sh', 'gh pr create'], neverCalled: ['gh pr merge'] },
  state: { branchCreated: true },
  rubricGate: 4,
  rubric: ['Did the unattended run drive the Complex item to ship and close by OPENING a PR and stopping there for the human to merge — recording its auto-resolved decisions in the workstream file on the branch — rather than merging itself or pausing at forks it could safely resolve?'],
  timeoutMs: 600000,
};
