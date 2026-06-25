export default {
  id: 'bne-e2-worktree-reattach', skill: 'backlog-next-epic',
  // RUBRIC-GATED: the resume path where the branch EXISTS but its worktree was pruned. The correct move
  // is `git worktree add .claude/worktrees/epic-beta-epic feat/epic-beta-epic` (re-attach, WITHOUT -b) —
  // re-creating the branch (`worktree add -b`) would error or fork history. Whether the run re-attaches
  // vs re-creates is a procedural judgment with no clean golden flip (the branch exists either way), so
  // it is judge-gated. The setup creates the epic branch then leaves NO worktree (prune state). beta-3 is
  // still active, so a resume re-derives the next open member rather than re-promoting. terminal:pause.
  fixture: 'epic-3members-2shipped', prompt: '/backlog-next-epic beta-epic',
  runstate: { phase: 'mid' },        // resume into an in-flight epic (not a fresh promote)
  terminal: 'pause',
  rubricGate: 4,
  state: { branchExists: 'feat/epic-beta-epic' },
  rubric: ['With the epic branch already present but its worktree pruned, did the run RE-ATTACH the worktree to the existing branch rather than re-creating the branch?'],
  setup: async ({ dir, git }) => {
    // Branch exists; no worktree is attached (the prune state). On resume the skill must re-attach the
    // worktree to feat/epic-beta-epic, not re-create it. We create the branch and immediately return to
    // main so the sandbox checkout is clean — leaving the branch dangling without a worktree.
    git(dir, 'branch', 'feat/epic-beta-epic');
    git(dir, 'worktree', 'prune');
  },
};
