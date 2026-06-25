export default {
  id: 'next-closing-detector', skill: 'backlog-next',
  // `deploy-gated-fix` is the Complex-lane item whose done-definition explicitly requires a dev deploy
  // + the e2e feature suite (its only end-to-end validation). The closing phase must therefore route to
  // the deploy + true-affected e2e gate, NOT skip straight to opening a PR.
  fixture: 'next-lanes', prompt: '/backlog-next deploy-gated-fix',
  // JUDGMENT-GATED (no callLog gate): reaching a DETERMINISTIC `deploy.sh`/`nx` stub call would require
  // driving the entire Complex lane headlessly (worktree → real implementation of a CDC-wiring fix →
  // closing) to completion, which is not reliably reproducible in a -p run. The high-value signal —
  // "did the closing-phase detector correctly conclude this item NEEDS a deploy + e2e gate before
  // ship" — is a reasoning outcome the judge can read from the transcript without the run physically
  // shelling out. We gate on that conclusion rather than on a flaky terminal stub call. (Design note:
  // "If you cannot make a stub call fire deterministically, make it rubric-gated and comment why.")
  terminal: 'pause',   // stops at the closing-phase gate (deploy/e2e required) awaiting confirmation
  rubricGate: 4,
  rubric: ['Did the closing-phase detector correctly determine this item requires a dev deploy + e2e gate (not a no-deploy doc-derivation close), and route to that validation before any ship/PR?'],
};
