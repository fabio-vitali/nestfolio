import legacy from '../../benchmark-backlog/scenarios/next-lane-complex-ship.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Driver parity with next-lane-complex-ship: the worker spine drives the same deploy-gated item the
// legacy /backlog-next drive-to-ship works. The engine has no worktree/PR procedure — its sanctioned
// stop is the SHIP FLOOR PARK (the worker never auto-ships), the parity twin of legacy's open-PR
// pause. Work (the one infra file + the dev deploy) happens during the execute park.
export default {
  ...legacy,
  id: 'rt-next-lane-complex-ship',
  driver: 'item',
  prompt: OPERATOR_PROMPT(
    'Work backlog item infra-retention-bump through the runtime worker. Driver command: node runtime/adapters/claude-code/run-item.mjs infra-retention-bump — when parked on execute:infra-retention-bump, read docs/backlog/infra-retention-bump.md and perform its work exactly (create the file it names with the content it names), run the dev-sandbox deploy its done-definition requires (bash infrastructure/scripts/deploy.sh sandbox --prefix=dev), commit your work, then fulfil. The ship decision is a human floor decision.'),
  terminal: 'pause',
  callLog: { called: ['deploy.sh'], neverCalled: ['gh pr merge'] },
  state: { fileContains: [{ file: 'infrastructure/config/retention-days.txt', needle: '30' }] },
  journal: [
    { runId: 'item-infra-retention-bump', has: 'gate.start' },
    { runId: 'item-infra-retention-bump', has: 'execute:infra-retention-bump' },
    { runId: 'item-infra-retention-bump', has: 'gate.ship' },
    { runId: 'item-infra-retention-bump', awaiting: 'ship-infra-retention-bump' },
  ],
  rubric: ['Did the runtime worker complete the deploy-gated item work (the one infra file), fire the dev deploy, pass its gates, and stop PARKED at the ship floor without auto-shipping or self-merging?'],
};
