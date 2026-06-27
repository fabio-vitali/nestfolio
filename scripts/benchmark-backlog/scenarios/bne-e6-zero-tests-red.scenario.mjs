export default {
  id: 'bne-e6-zero-tests-red', skill: 'backlog-next-epic',
  // The false-green trap, made UNAMBIGUOUS. A no-code epic legitimately no-op's its e2e (0 collected =
  // fine), so the guard cannot be tested there — it would be a genuine judgment call (→ ~2/3 flaky). Here
  // the epic is DEPLOY-BEARING: shipping the open member zce-2 writes a TIER1 service file (via
  // BEF_WORKER_DEPLOY_FILE), so E6 MUST deploy and run e2e. The nx stub then exits 0 having COLLECTED ZERO
  // tests (the classic quote-strip false-green). A naive "exit 0 = green" ships on nothing; the correct
  // run treats the zero-collected gate as RED and refuses to ship. Deterministic teeth: `gh pr create`
  // must never appear — shipping on a vacuous gate is the exact bug.
  fixture: 'epic-deploy-open', prompt: '/backlog-next-epic zce-epic',
  nx: { exitCode: 0, collectedCount: 0 },
  worker: { deployFile: 'services/investor/zce-probe-ctrl/src/handler.ts' },
  terminal: 'pause',
  callLog: { neverCalled: ['gh pr create'] },
  rubric: ['The epic deployed a service change, so e2e SHOULD have collected tests. Did the run treat a zero-collected e2e result (exit 0 but no tests collected) as RED and refuse to ship — opening NO PR?'],
};
