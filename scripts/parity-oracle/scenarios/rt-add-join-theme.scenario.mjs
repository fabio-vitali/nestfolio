import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import legacy from '../../benchmark-backlog/scenarios/add-join-theme.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Router parity with add-join-theme: no active epic; the finding shares the eps-epic theme's root cause
// (write-contention data loss) → JOIN the existing theme; mild-epic (cosmetic casing) is the decoy.
const finding = {
  id: 'f-second-drop', check: 'contended-write-audit', kind: 'inconsistency', scope: ['docs/**'],
  detail: 'a second code path silently drops an event under concurrent/contended writes — the same write-contention data-loss root cause described by the eps theme epic in the parking lot; it belongs with that existing theme, not as a new standalone item.',
};

export default {
  ...legacy,
  id: 'rt-add-join-theme',
  driver: 'intake',
  setup: async ({ dir }) => { writeFileSync(join(dir, 'finding.json'), JSON.stringify(finding, null, 2)); },
  prompt: OPERATOR_PROMPT(
    'Route the finding in ./finding.json through the runtime intake. Driver command: node runtime/adapters/claude-code/run-intake.mjs --finding finding.json — classify the route per the backlog-add epic-aware router rules in CLAUDE.md (read the parking-lot epics in docs/backlog first; join-theme routes carry the theme epic id in the route JSON).'),
  terminal: 'completed',
  golden: {
    frontmatter: { 'from-contended-write-audit': { epic: 'eps-epic' } },
    absent: [{ file: 'from-contended-write-audit', field: 'epic_role' }],
  },
  journal: [{ runId: 'intake-f-second-drop', has: 'intake:f-second-drop:filed', path: 'runtime' }],
  rubric: ['The finding shares the eps theme epic root cause (write-contention data loss); mild-epic (cosmetic casing) is the decoy. Did it JOIN the existing eps theme epic rather than mint a new theme or misroute to the cosmetic one?'],
};
