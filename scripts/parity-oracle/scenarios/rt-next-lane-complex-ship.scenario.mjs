import legacy from '../../benchmark-backlog/scenarios/next-lane-complex-ship.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Driver parity with next-lane-complex-ship, WS-3 upgrade: the deploy is now owned by the RUNTIME
// pre-ship batch, not the operator. Driven by run-next.mjs (not run-item.mjs), the worker classifies the
// item Complex (infrastructure/ + requires_deploy) → laneToTrigger → the sha-conditional expensive
// deploy-gate batch fires `deploy.sh` (via the starter-pack deploy-gate check + sandbox-robust runner)
// between execute and the ship floor. So the operator performs ONLY the one-file code work + commit at
// the execute park; the batch does the deploy and journals the sha-pinned `e2e` record. The engine's
// sanctioned stop is still the SHIP FLOOR PARK (the worker never auto-ships) — the twin of legacy's open-PR pause.
export default {
  ...legacy,
  id: 'rt-next-lane-complex-ship',
  driver: 'item',
  prompt: OPERATOR_PROMPT(
    'Work backlog item infra-retention-bump through the runtime worker. Driver command: node runtime/adapters/claude-code/run-next.mjs infra-retention-bump — when parked on execute:infra-retention-bump, read docs/backlog/infra-retention-bump.md and perform its work exactly (create the file it names with the content it names), commit your work, then fulfil. Do NOT run any deploy yourself — the runtime pre-ship batch owns the deploy. The ship decision is a human floor decision.'),
  terminal: 'pause',
  callLog: { called: ['deploy.sh'], neverCalled: ['gh pr merge'] },
  state: { fileContains: [{ file: 'infrastructure/config/retention-days.txt', needle: '30' }] },
  journal: [
    { runId: 'item-infra-retention-bump', path: 'runtime' },
    { runId: 'item-infra-retention-bump', has: 'gate.start' },
    { runId: 'item-infra-retention-bump', has: 'execute:infra-retention-bump' },
    { runId: 'item-infra-retention-bump', has: 'e2e' },        // WS-3: the runtime-owned pre-ship deploy batch fired
    { runId: 'item-infra-retention-bump', has: 'gate.ship' },
    { runId: 'item-infra-retention-bump', awaiting: 'ship-infra-retention-bump' },
  ],
  rubric: ['Did the runtime worker complete the deploy-gated item work (the one infra file), let the runtime pre-ship batch fire the dev deploy (not the operator), pass its gates, and stop PARKED at the ship floor without auto-shipping or self-merging?'],
};
