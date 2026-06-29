export default {
  id: 'bne-e71-chained-e6', skill: 'backlog-next-epic',
  // The chained-gate invariant: after the captured audit promotes a load-bearing member and that member is
  // reworked, the batched gate must run a SECOND time (the prior pass is stale) before shipping. That exact
  // invariant is NOT deterministically gateable here — its premise (the E7.1 audit JUDGING a captured
  // member load-bearing and promoting it) is a model judgment, and "gate ran twice" can't be counted by the
  // substring callLog teeth — so a rubricGate on it just swings (it scored 3 on the drainable fixture, which
  // can't even elicit a captured-promote rework). Per the shipped bne-resume-partial / bne-promote-clean
  // pattern we therefore GATE on the deterministic, elicitable part and keep the chained-gate as an
  // INFORMATIONAL rubric. Deterministic part: a DEPLOY-BEARING epic (shipping the open member writes a TIER1
  // file via BEF_WORKER_DEPLOY_FILE) so E6 MUST run the batched gate; with a real non-zero collected count
  // the gate is GREEN and the epic ships cleanly — the GREEN counterpart to bne-e6-zero-tests-red's
  // 0-collected RED, and distinct from bne-ship-clean (drainable, no deploy, no gate). Unit-level coverage
  // of the chained second-gate is tracked separately (bne-e71-chained-gate-unit-coverage). terminal:pause.
  fixture: 'epic-deploy-open', prompt: '/backlog-next-epic zce-epic',
  nx: { exitCode: 0, collectedCount: 5 },   // GREEN gate (collected>0) — green counterpart to bne-e6's 0-collected RED
  worker: { deployFile: 'services/investor/zce-probe-ctrl/src/handler.ts' },  // deploy-bearing → E6 MUST run the batched gate
  gh: { prState: 'OPEN' },
  terminal: 'pause',
  // Deterministic gate: the deploy-bearing epic shipped cleanly through a green batched gate — shipped+closed
  // with a validation_gate scalar on the epic branch, a PR opened, never self-merged, branch kept. The ship
  // outcome (proven-robust by bne-ship-clean's teeth) implies the gate ran, without a fragile nx substring.
  // NOTE: we deliberately do NOT assert worktree-removal here — the heavier deploy-bearing path occasionally
  // pauses before executing the E8.2 cleanup (flip=true on a 2-iteration confirm; bne-ship-clean covers
  // worktree-removal deterministically on the lighter drainable path), and it is incidental to this
  // scenario's purpose (the green-gate deploy-bearing ship), so gating on it here only adds flake.
  golden: {
    onBranch: 'feat/epic-zce-epic',
    frontmatter: { 'zce-epic': { status: 'shipped' } },
    present: [{ file: 'zce-epic', field: 'closed' }, { file: 'zce-epic', field: 'validation_gate' }],
  },
  callLog: { called: ['gh pr create'], neverCalled: ['gh pr merge'] },
  state: { branchExists: 'feat/epic-zce-epic' },
  // Informational only (no rubricGate): whether a post-captured-promote rework re-runs the batched gate a
  // SECOND time is not deterministically gateable (model-judgment premise + uncountable by substring teeth),
  // so it informs rather than gates. Unit-level coverage tracked in bne-e71-chained-gate-unit-coverage.
  rubric: ['After a captured-promote rework on the branch, did the run re-run the batched gate a SECOND time before shipping, rather than shipping on the now-stale earlier pass?'],
};
