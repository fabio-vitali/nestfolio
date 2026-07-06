import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import legacy from '../../benchmark-backlog/scenarios/add-mint-aggregation.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Router parity with add-mint-aggregation: no active epic, no matching theme; the finding shares the
// missing-retention-policy root cause with two parking orphans → mint-aggregation. decoy-idle-nat
// shares only the cost SYMPTOM. The judge (rubricGate 4, like legacy) verifies the cluster is named
// correctly and the decoy excluded.
const finding = {
  id: 'f-sf-log-retention', check: 'retention-policy-audit', kind: 'gap', scope: ['docs/**'],
  detail: 'the Step Functions execution log groups are created with no retention policy and grow forever — the same missing-CDK-retention-policy root cause as the existing log-retention-missing and log-retention-lambda parking items.',
};

export default {
  ...legacy,
  id: 'rt-add-mint-aggregation',
  driver: 'intake',
  setup: async ({ dir }) => { writeFileSync(join(dir, 'finding.json'), JSON.stringify(finding, null, 2)); },
  prompt: OPERATOR_PROMPT(
    'Route the finding in ./finding.json through the runtime intake. Driver command: node runtime/adapters/claude-code/run-intake.mjs --finding finding.json — classify the route per the backlog-add epic-aware router rules in CLAUDE.md (read the parking lot in docs/backlog first; a mint-aggregation route carries the NEW aggregation epic id in the route JSON, and your final summary must name the clustered orphans).'),
  terminal: 'completed',
  golden: { present: [{ file: 'from-retention-policy-audit', field: 'epic' }] },
  journal: [{ runId: 'intake-f-sf-log-retention', has: 'intake:f-sf-log-retention:filed', path: 'runtime' }],
  rubric: ['Two parking orphans share the missing-retention-policy root cause (log-retention-missing, log-retention-lambda); decoy-idle-nat shares only the cost symptom. Did the route mint a NEW aggregation that clusters this finding with the two retention orphans (naming them, excluding the decoy)?'],
  rubricGate: 4,
};
