export default {
  id: 'add-join-theme', skill: 'backlog-add',
  fixture: 'multi-epic-parking',
  // No ACTIVE epic, so router branch 1 cannot fire. The finding shares the eps-epic theme's root cause
  // (events silently dropped under concurrent/contended writes) → router branch 2 JOINS the existing
  // matching theme epic rather than minting a new one. mild-epic (cosmetic casing) is the decoy.
  // Title is specified exactly so the derived slug is deterministic (the golden keys off it).
  prompt: "Use backlog-add to file this finding, titling it EXACTLY \"second event dropped on contended write\": I found a second code path where an event is silently dropped under concurrent/contended writes — the same write-contention data-loss root cause described by the eps theme epic in the parking lot. It belongs with that existing theme, not as a new standalone item.",
  terminal: 'completed',
  golden: { frontmatter: { 'second-event-dropped-on-contended-write': { epic: 'eps-epic' } }, scalarStrings: [{ file: 'second-event-dropped-on-contended-write', field: 'notes' }], lintExit0: true },
  rubric: ['The finding shares the eps theme epic root cause (write-contention data loss), and mild-epic (cosmetic casing) is the decoy. Did it JOIN the existing matching eps theme epic rather than mint a new theme or misroute to the cosmetic one?'],
};
