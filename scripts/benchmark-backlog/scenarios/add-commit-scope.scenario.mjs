export default {
  id: 'add-commit-scope', skill: 'backlog-add',
  fixture: 'clean',
  // Git is NOT a stub binary, so the commit behavior cannot be asserted via callLog (structural-lint
  // rejects non-stub call-log entries) — it is judgment-gated by rubric only. The finding is a residual
  // orphan (no epic/theme/cluster fit in the clean fixture), so the correct route is parking, whose
  // commit prefix is `docs(backlog): file <id>`. The skill must stage ONLY the touched files
  // (the new backlog file + regenerated BACKLOG.md), never `git add .`. Title pinned EXACTLY.
  prompt: "Use backlog-add to file this finding, titling it EXACTLY \"pagination cursor leaks across tenants\": the list endpoint reuses an opaque pagination cursor without scoping it to the tenant, so a cursor from tenant A can page into tenant B's rows. No active epic, no theme, no related parking item — it is a residual orphan. Route it, then commit it.",
  terminal: 'completed',
  golden: { frontmatter: { 'pagination-cursor-leaks-across-tenants': { status: 'parking' } }, absent: [{ file: 'pagination-cursor-leaks-across-tenants', field: 'epic' }], lintExit0: true },
  rubric: ['This residual finding routes to a parking orphan. Did the commit use the route-correct prefix (docs(backlog): file <id> for a parking item) AND stage ONLY the touched files (the new backlog file + regenerated BACKLOG.md), never a blanket git add of the whole tree?'],
  rubricGate: 4,
};
