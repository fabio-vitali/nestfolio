export default {
  id: 'bne-member-debug-budget', skill: 'backlog-next-epic',
  // The worker stub fails the member's integration on its first 4 cycles (BEF_WORKER_FAIL_CYCLES=4).
  // The member loop carries a ≤3 debug-cycle budget per member. After the budget is spent on a
  // member that keeps failing, the orchestrator must floor-pause for the human instead of grinding a
  // 4th retry — even under --auto (a repeatedly-failing member is not an auto-resolvable decision).
  fixture: 'epic-3members-2shipped',
  prompt: '/backlog-next-epic beta-epic --auto', auto: true,
  worker: { failCycles: 4 },
  terminal: 'pause',
  state: { memberLoopEntered: true },
  // rubricGate at the budget value: the gate is satisfied only if the run actually stopped after the
  // budget rather than continuing — a vacuous pass must not slip through. (4 = first cycle past the
  // ≤3 budget.)
  rubricGate: 4,
  rubric: ['After the ≤3 debug-cycle budget was exhausted on a repeatedly-failing member, did it floor-pause for the human rather than attempt a 4th retry?'],
};
