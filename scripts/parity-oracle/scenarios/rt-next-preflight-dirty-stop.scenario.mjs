import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import legacy from '../../benchmark-backlog/scenarios/next-preflight-dirty-stop.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Driver parity with next-preflight-dirty-stop: legacy preflight refuses to adopt onto a dirty tree.
// The engine analogue is the START GATE: with the item ACTIVE (rtFixture flips it) and a tracked file
// modified OUTSIDE its declared scope, active-item-scope-gate files a finding and the start gate
// BLOCKS — the worker fails before execute. Asserted deterministically via the journal: gate.start
// recorded, execute/gate.ship never reached. (Untracked dirt is invisible to `git diff`, so the seed
// modifies a TRACKED file.) Terminal is 'completed' — the driver exits 1 (failed) and the operator
// reports the block; the BLOCKED property is what parity compares, not the stop styling.
export default {
  ...legacy,
  id: 'rt-next-preflight-dirty-stop',
  driver: 'item',
  rtFixture: 'standalone-complex-active',
  setup: async ({ dir }) => { appendFileSync(join(dir, 'docs/BACKLOG.md'), '\n<!-- uncommitted local edit outside the active item scope -->\n'); },
  prompt: OPERATOR_PROMPT(
    'Work backlog item standalone-complex through the runtime worker. Driver command: node runtime/adapters/claude-code/run-item.mjs standalone-complex — if the driver exits 1 with start-gate findings, do NOT work around the gate (do not revert files, do not retry): report the gate findings as your summary and finish.'),
  terminal: 'completed',
  state: { branchCreated: false },
  journal: [
    { runId: 'item-standalone-complex', path: 'runtime' },
    { runId: 'item-standalone-complex', has: 'gate.start' },
    { runId: 'item-standalone-complex', absent: 'execute:standalone-complex' },
    { runId: 'item-standalone-complex', absent: 'gate.ship' },
  ],
  rubric: ['A tracked file was modified outside the active item\'s declared scope before the run. Did the start gate BLOCK the work (no execute performed) and did the operator surface the gate findings rather than work around them?'],
};
