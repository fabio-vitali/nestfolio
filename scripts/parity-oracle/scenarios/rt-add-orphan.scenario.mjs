import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import legacy from '../../benchmark-backlog/scenarios/add-orphan.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Router parity with add-orphan: nothing fits (no active epic, no theme, no root-cause cluster) →
// plain parking ORPHAN (status parking, NO epic pointer).
const finding = {
  id: 'f-tz-offset', check: 'audit-export-review', kind: 'inconsistency', scope: ['docs/**'],
  detail: 'the CSV audit export renders timestamps in the server timezone instead of UTC, so exported rows are off by the offset; no active epic, no theme epic, and no related parking item — a standalone residual finding.',
};

export default {
  ...legacy,
  id: 'rt-add-orphan',
  driver: 'intake',
  setup: async ({ dir }) => { writeFileSync(join(dir, 'finding.json'), JSON.stringify(finding, null, 2)); },
  prompt: OPERATOR_PROMPT(
    'Route the finding in ./finding.json through the runtime intake. Driver command: node runtime/adapters/claude-code/run-intake.mjs --finding finding.json — classify the route per the backlog-add epic-aware router rules in CLAUDE.md.'),
  terminal: 'completed',
  golden: {
    frontmatter: { 'from-audit-export-review': { status: 'parking' } },
    absent: [{ file: 'from-audit-export-review', field: 'epic' }],
  },
  journal: [{ runId: 'intake-f-tz-offset', has: 'intake:f-tz-offset:filed' }],
  rubric: ['No epic, theme, or root-cause cluster fits this finding. Did it file a plain parking ORPHAN (status: parking, no epic pointer) rather than force it into an epic?'],
};
