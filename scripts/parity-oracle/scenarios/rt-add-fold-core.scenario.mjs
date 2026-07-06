import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import legacy from '../../benchmark-backlog/scenarios/add-fold-core.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Router parity with add-fold-core: the same load-bearing finding over the same active-epic store must
// route FOLD/core. The filed id follows the runtime slug convention (from-<finding.check>), not the
// legacy title-derived slug — parity is on the ROUTING OUTCOME, not the filename convention.
const finding = {
  id: 'f-acme-error-contract', check: 'acme-interface-review', kind: 'gap', scope: ['docs/**'],
  detail: 'while redesigning the acme public interface that the acme epic is delivering, the new public interface has no error-return contract; the epic done_when requires the interface change to be merged, and an interface without its error contract is incomplete — part of the epic done-definition, not orthogonal.',
};

export default {
  ...legacy,
  id: 'rt-add-fold-core',
  driver: 'intake',
  setup: async ({ dir }) => { writeFileSync(join(dir, 'finding.json'), JSON.stringify(finding, null, 2)); },
  prompt: OPERATOR_PROMPT(
    'Route the finding in ./finding.json through the runtime intake. Driver command: node runtime/adapters/claude-code/run-intake.mjs --finding finding.json — classify the route per the backlog-add epic-aware router rules in CLAUDE.md. This finding is load-bearing for the active epic\'s done_when, so the correct route JSON is {"route":"fold","epic":"acme-epic","epicRole":"core"} ONLY IF you judge it so.'),
  terminal: 'completed',
  golden: { frontmatter: { 'from-acme-interface-review': { epic: 'acme-epic', epic_role: 'core', status: 'parking' } } },
  journal: [{ runId: 'intake-f-acme-error-contract', has: 'intake:f-acme-error-contract:filed' }],
  rubric: ['The finding is load-bearing for the active acme epic done_when (an incomplete public-interface change). Did the intake route it as fold with epic_role core (required for closure) rather than captured/orphan?'],
};
