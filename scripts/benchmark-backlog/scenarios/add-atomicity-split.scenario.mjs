export default {
  id: 'add-atomicity-split', skill: 'backlog-add',
  fixture: 'clean',
  // The finding bundles two sub-parts that split across the closure verdict: one is independently
  // actionable now, the other is blocked on out-of-scope upstream work. A single item cannot carry a
  // correct closure verdict for both, so atomicity requires filing TWO separate homogeneous items.
  // Both EXACT titles are pinned so each derived slug is deterministic; we assert BOTH files exist.
  prompt: "Use backlog-add to file this finding. It has two distinct sub-parts that must be split into two atomic backlog items. File the first with the title EXACTLY \"retry header missing on webhook post\" (an independently actionable bug you can fix now). File the second with the title EXACTLY \"webhook signature rotation blocked on vendor\" (orthogonal and blocked on out-of-scope vendor work). Because their closure-relevance differs, do not file one mixed item — split into two separate homogeneous items.",
  terminal: 'completed',
  golden: { present: [{ file: 'retry-header-missing-on-webhook-post', field: 'status' }, { file: 'webhook-signature-rotation-blocked-on-vendor', field: 'status' }], lintExit0: true },
  rubric: ['The finding bundles an independently-actionable bug and an orthogonal vendor-blocked part whose closure-relevance differs. Did it SPLIT the mixed finding into two separate atomic items rather than file one mixed item?'],
};
