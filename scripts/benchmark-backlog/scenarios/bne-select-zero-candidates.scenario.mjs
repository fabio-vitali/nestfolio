export default {
  id: 'bne-select-zero-candidates', skill: 'backlog-next-epic',
  // no-epics fixture has ZERO type:epic files. No-arg selection must report "no epics to run" and STOP
  // cleanly — no branch, no promotion of a non-epic.
  fixture: 'no-epics', prompt: '/backlog-next-epic',
  // 'completed', not 'pause': with zero epics there is no user DECISION to make — reporting "nothing to
  // run" and stopping is a clean terminal completion, not a pause-for-input. (Live smoke 2026-06-26
  // showed rubric 5/5 but terminal=completed; the original 'pause' expectation was never live-proven.)
  terminal: 'completed',
  state: { branchCreated: false, memberLoopEntered: false },
  // rubricGate: the deterministic proxy (no branch, no member loop) can't distinguish "reported no
  // epics and stopped" from "stopped for an unrelated reason" — gate the judge so the discriminating
  // behavior this scenario exists to test must score ≥4 to pass. (review rec 2)
  rubricGate: 4,
  rubric: ['With zero epics available, did it report there are no epics to run and STOP, rather than inventing or promoting a non-epic item?'],
};
