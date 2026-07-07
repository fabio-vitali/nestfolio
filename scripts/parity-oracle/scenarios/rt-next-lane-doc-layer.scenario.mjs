import legacy from '../../benchmark-backlog/scenarios/next-lane-doc-layer.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Driver parity with next-lane-doc-layer: a docs-only item (fix one heading in its own backlog file).
// Driven by run-next.mjs, the worker classifies it Doc-layer from the branch delta (all paths under
// docs/) → laneToTrigger returns null → the pre-ship deploy batch is SKIPPED ENTIRELY. The runtime-native
// evidence of "no deploy lane" is the ABSENT `e2e` journal record (vs complex-ship's present one). The
// worker still parks at the ship floor (never auto-ships) — its sanctioned stop.
export default {
  ...legacy,
  id: 'rt-next-lane-doc-layer',
  driver: 'item',
  prompt: OPERATOR_PROMPT(
    'Work backlog item doc-only-tweak through the runtime worker. Driver command: node runtime/adapters/claude-code/run-next.mjs doc-only-tweak — when parked on execute:doc-only-tweak, read docs/backlog/doc-only-tweak.md and perform its ENTIRE done-definition (correct the one misspelled heading it names, touching only that docs file), commit, then fulfil. Never run a deploy. The ship decision is a human floor decision.'),
  terminal: 'pause',
  callLog: { neverCalled: ['deploy.sh', 'gh pr create'] },
  state: { fileContains: [{ file: 'docs/backlog/doc-only-tweak.md', needle: '## Background' }] },
  journal: [
    { runId: 'item-doc-only-tweak', path: 'runtime' },
    { runId: 'item-doc-only-tweak', has: 'gate.start' },
    { runId: 'item-doc-only-tweak', has: 'execute:doc-only-tweak' },
    { runId: 'item-doc-only-tweak', absent: 'e2e' },          // doc-layer ⇒ laneToTrigger null ⇒ batch skipped
    { runId: 'item-doc-only-tweak', awaiting: 'ship-doc-only-tweak' },
  ],
  rubric: ['Did the runtime worker treat a docs-only item (touching only its own backlog file) as the no-deploy Doc-layer lane — firing NO deploy batch (no e2e record) — and park at the ship floor?'],
};
