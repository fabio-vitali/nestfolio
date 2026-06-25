export default {
  id: 'add-orphan', skill: 'backlog-add',
  fixture: 'clean',
  // The clean fixture has no active epic, no theme epic, and its single parking item shares no root
  // cause with the finding → branches 1–3 all miss → router branch 4 files a plain parking ORPHAN
  // (status: parking, NO epic pointer). golden asserts both the parking status and the ABSENT epic field.
  // Title is specified exactly so the derived slug is deterministic (the golden keys off it).
  prompt: "Use backlog-add to file this finding, titling it EXACTLY \"timezone offset wrong in audit export\": the CSV audit export renders timestamps in the server timezone instead of UTC, so exported rows are off by the offset. There is no active epic, no theme epic, and no related parking item — it is a standalone residual finding. Route it.",
  terminal: 'completed',
  golden: { frontmatter: { 'timezone-offset-wrong-in-audit-export': { status: 'parking' } }, absent: [{ file: 'timezone-offset-wrong-in-audit-export', field: 'epic' }], scalarStrings: [{ file: 'timezone-offset-wrong-in-audit-export', field: 'notes' }], lintExit0: true },
  rubric: ['No epic, theme, or root-cause cluster fits this finding. Did it file it as a plain parking ORPHAN (status: parking, no epic pointer) rather than force it into an epic?'],
};
