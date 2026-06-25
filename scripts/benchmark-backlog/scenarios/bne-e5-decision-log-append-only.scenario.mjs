export default {
  id: 'bne-e5-decision-log-append-only', skill: 'backlog-next-epic',
  // RUBRIC-ONLY (judgment-gated): the --auto decision log is APPEND-ONLY. When a decision is later
  // reversed, the original entry must be PRESERVED and a new entry appended recording the reversal —
  // never overwritten or deleted (the PR body must show the full decision history). The decision log
  // lives in the run-state `decisions[]`, which is NOT part of the {phase,pr} seed intent, so it cannot
  // be staged deterministically — whether the reversal preserves entry[0] is a pure judge call. --auto so
  // the run actually logs decisions. terminal:pause.
  fixture: 'epic-drainable', prompt: '/backlog-next-epic drn-epic --auto', auto: true,
  terminal: 'pause',
  rubricGate: 4,
  rubric: ['Under a decision reversal, did the decision log stay append-only — the original decision entry preserved and the reversal appended, not overwritten?'],
};
