import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import legacy from '../../benchmark-backlog/scenarios/add-fold-captured.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Router parity with add-fold-captured: thematically near the active epic, orthogonal to its done_when
// → fold as `captured`.
const finding = {
  id: 'f-eventbus-logging', check: 'eventbus-logging-review', kind: 'drift', scope: ['docs/**'],
  detail: 'the EventBus module the acme epic is redesigning also contains stale debug logging to clean up; it is in the same EventBus surface the epic touches but purely cosmetic logging cleanup — NOT required by the epic interface-redesign done_when.',
};

export default {
  ...legacy,
  id: 'rt-add-fold-captured',
  driver: 'intake',
  setup: async ({ dir }) => { writeFileSync(join(dir, 'finding.json'), JSON.stringify(finding, null, 2)); },
  prompt: OPERATOR_PROMPT(
    'Route the finding in ./finding.json through the runtime intake. Driver command: node runtime/adapters/claude-code/run-intake.mjs --finding finding.json — classify the route per the backlog-add epic-aware router rules in CLAUDE.md, choosing epicRole by the closure-predicate test (core if leaving it undone falsifies a done_when clause; captured only if genuinely orthogonal).'),
  terminal: 'completed',
  golden: { frontmatter: { 'from-eventbus-logging-review': { epic: 'acme-epic', epic_role: 'captured' } } },
  journal: [{ runId: 'intake-f-eventbus-logging', has: 'intake:f-eventbus-logging:filed', path: 'runtime' }],
  rubric: ['The finding is in the same EventBus surface as the active epic but orthogonal to its done_when. Is folding it as `captured` (near the theme, not load-bearing for done_when) the correct routing?'],
};
