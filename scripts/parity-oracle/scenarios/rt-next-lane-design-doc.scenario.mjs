import legacy from '../../benchmark-backlog/scenarios/next-lane-design-doc.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Driver parity with next-lane-design-doc: a `type: design` workstream whose entire done-definition is
// its design doc landing (no code). Driven by run-next.mjs, the worker sees a docs-only branch delta →
// classifyLane Doc-layer → laneToTrigger null → the pre-ship deploy batch is SKIPPED (design ≠ code, no
// deploy). Runtime-native proof: the ABSENT `e2e` record. The worker parks at the ship floor.
export default {
  ...legacy,
  id: 'rt-next-lane-design-doc',
  driver: 'item',
  prompt: OPERATOR_PROMPT(
    'Work backlog item design-spec-only through the runtime worker. Driver command: node runtime/adapters/claude-code/run-next.mjs design-spec-only — when parked on execute:design-spec-only, read docs/backlog/design-spec-only.md and land its design (a docs-only, type:design workstream — record its decisions in the doc; touch NO code, NO service, NO infra), commit, then fulfil. Never run a deploy. The ship decision is a human floor decision.'),
  terminal: 'pause',
  callLog: { neverCalled: ['deploy.sh', 'gh pr create'] },
  state: {},                                                   // journal is the runtime-native evidence here
  journal: [
    { runId: 'item-design-spec-only', path: 'runtime' },
    { runId: 'item-design-spec-only', has: 'gate.start' },
    { runId: 'item-design-spec-only', has: 'execute:design-spec-only' },
    { runId: 'item-design-spec-only', absent: 'e2e' },         // design-doc-only ⇒ Doc-layer ⇒ batch skipped
    { runId: 'item-design-spec-only', awaiting: 'ship-design-spec-only' },
  ],
  rubric: ['Did the runtime worker keep a design-doc-only workstream (done = the doc lands, no code) in the no-deploy Doc-layer lane — firing NO deploy batch (no e2e record) — and park at the ship floor?'],
};
