export default {
  id: 'bne-e71-chained-e6', skill: 'backlog-next-epic',
  // RUBRIC-ONLY (judgment-gated): the chained-gate invariant. When the captured audit promotes a
  // load-bearing member and that member is then reworked on the branch, the batched e2e/test gate must
  // run a SECOND time (the prior pass is stale against the new code) before the run is allowed to ship.
  // There is no deterministic field that counts gate runs (callLog can't count, and the rework is itself
  // a model action), so this is purely a judge call. The fixture is drainable so the first gate is
  // reachable; the rubric asks whether a post-rework re-run happened before ship. terminal:pause.
  fixture: 'epic-drainable', prompt: '/backlog-next-epic drn-epic',
  terminal: 'pause',
  rubricGate: 4,
  rubric: ['After a captured-promote rework on the branch, did the run re-run the batched gate a SECOND time before shipping, rather than shipping on the now-stale earlier pass?'],
};
