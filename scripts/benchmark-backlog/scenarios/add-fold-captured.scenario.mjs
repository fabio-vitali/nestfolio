export default {
  id: 'add-fold-captured', skill: 'backlog-add',
  fixture: 'active-epic',
  // Thematically NEAR the active epic (same EventBus surface it is redesigning) but ORTHOGONAL to its
  // done_when (cosmetic logging, not the interface redesign) → router branch 1 folds it as `captured`.
  // Title is specified exactly so the derived slug is deterministic (the golden keys off it).
  prompt: "Use backlog-add to file this finding, titling it EXACTLY \"eventbus stale debug logging\": the EventBus module that the acme epic is currently redesigning also contains stale debug logging that should be cleaned up. It is in the same EventBus surface the epic touches (thematically related to the epic), but it is purely cosmetic logging cleanup and is NOT required by the epic's interface-redesign done_when.",
  terminal: 'completed',
  golden: { frontmatter: { 'eventbus-stale-debug-logging': { epic: 'acme-epic', epic_role: 'captured' } }, scalarStrings: [{ file: 'eventbus-stale-debug-logging', field: 'notes' }], lintExit0: true },
  rubric: ['The finding is in the same EventBus surface as the active epic but orthogonal to its done_when. Is folding it as `captured` (near the theme, not load-bearing for done_when) the correct routing?'],
};
