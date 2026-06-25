export default {
  id: 'next-lane-complex-ship', skill: 'backlog-next',
  // The corpus's ONLY positive deploy assertion. backlog-next is the #2-blast-radius skill yet its 6
  // prior scenarios all pause at classification — a fired dev deploy (its highest-risk outward op) was
  // never positively exercised (review rec 1, M1).
  //
  // infra-retention-bump is a Complex (requires_deploy) item whose ENTIRE implementation is creating one
  // file under infrastructure/ (a TIER1 deploy trigger in detect-deploy-needed.mjs). The downstream impl
  // skills (executing-plans/brainstorming) and finishing-a-development-branch are absent from the sandbox,
  // so the worker self-implements the one-liner and drives the FULL Complex lane to completion: adopt
  // (worktree+branch) → implement → dev deploy → ship file → merge to main → worktree/branch cleanup →
  // postflight → completed. The PRIMARY assertion is the fired deploy.sh + the shipped/on-main end state.
  // (Live-verified 2026-06-26 across two runs.)
  //
  // NON-DETERMINISM, deliberately NOT asserted: because finishing-a-development-branch is absent from
  // the sandbox, the worker REIMPLEMENTS the 6.7 finish manually (the documented anti-pattern) and the
  // merge mechanism varies run-to-run — sometimes a local `--no-ff` merge + push, sometimes
  // `gh pr create` + `gh pr merge --squash` (a self-merge). That divergence is a sandbox artifact (the
  // missing finish skill), not a real skill behavior, so a `neverCalled: ['gh pr merge']` self-merge
  // assertion would be flaky here. A faithful no-self-merge gate needs a finishing-a-development-branch
  // STUB in the sandbox (so the worker ROUTES to it instead of reimplementing) — a separate, larger
  // lift, filed as a follow-up. What's deterministic across both endings is asserted below.
  //
  // Depends on two harness fixes (same commit): BEF_STUBS_LOG (deploy.sh runs from inside the worktree,
  // so the call is only visible via an absolute, worktree-surviving stubs.log path) and the sandbox
  // CLAUDE.md now carrying "Pre-authorized actions" (else the worker pauses on the dev deploy as an
  // outward action and never fires it).
  fixture: 'standalone-deploy-ship', prompt: '/backlog-next infra-retention-bump',
  nx: { exitCode: 0, collectedCount: 3 },
  terminal: 'completed',
  // Positive deploy fired — the gap this scenario closes (the rest of the corpus only ever asserts
  // deploy.sh neverCalled).
  callLog: { called: ['deploy.sh'] },
  // Shipped end-state: status flipped + validation_gate filled (golden), and the change reached
  // origin/main (assert the durable origin-main commit, not the worker-chosen branch name).
  golden: {
    frontmatter: { 'infra-retention-bump': { status: 'shipped' } },
    present: [{ file: 'infra-retention-bump', field: 'validation_gate' }],
  },
  state: { originMainContains: 'infra-retention-bump' },
  // Advisory rubric: the deterministic teeth above (deploy fired + shipped + on origin/main) already
  // gate this heavy scenario unambiguously, so the judge stays informational (no rubricGate) — unlike
  // the thin select/resume scenarios where the judge IS the discriminating gate.
  rubric: ['Did it classify the deploy-gated infra item as Complex, adopt it into an isolation worktree, implement the one-file change, run the dev-sandbox deploy, and ship it (status:shipped, merged to main)?'],
  timeoutMs: 600000,
};
