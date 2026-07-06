import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import legacy from '../../benchmark-backlog/scenarios/add-commit-scope.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Router parity with add-commit-scope: a residual orphan is routed AND committed. Git is not a stub
// binary, so commit discipline (scoped staging, route-correct prefix) is judgment-gated by the rubric
// (rubricGate 4, like legacy).
const finding = {
  id: 'f-cursor-leak', check: 'pagination-audit', kind: 'inconsistency', scope: ['docs/**'],
  detail: 'the list endpoint reuses an opaque pagination cursor without scoping it to the tenant, so a cursor from tenant A can page into tenant B rows; no active epic, no theme, no related parking item — a residual orphan.',
};

export default {
  ...legacy,
  id: 'rt-add-commit-scope',
  driver: 'intake',
  setup: async ({ dir }) => { writeFileSync(join(dir, 'finding.json'), JSON.stringify(finding, null, 2)); },
  prompt: OPERATOR_PROMPT(
    'Route the finding in ./finding.json through the runtime intake, then COMMIT the filed item. Driver command: node runtime/adapters/claude-code/run-intake.mjs --finding finding.json — classify the route per the backlog-add epic-aware router rules in CLAUDE.md. After the driver exits 0, commit the written backlog file with a route-correct message (a parking orphan commits as "docs(backlog): file <id>"), staging ONLY the touched files — never a blanket git add of the whole tree.'),
  terminal: 'completed',
  golden: {
    frontmatter: { 'from-pagination-audit': { status: 'parking' } },
    absent: [{ file: 'from-pagination-audit', field: 'epic' }],
  },
  journal: [{ runId: 'intake-f-cursor-leak', has: 'intake:f-cursor-leak:filed', path: 'runtime' }],
  rubric: ['This residual finding routes to a parking orphan. Did the commit use the route-correct prefix (docs(backlog): file <id>) AND stage ONLY the touched files (the filed backlog item), never a blanket git add of the whole tree?'],
  rubricGate: 4,
};
