import { OPERATOR_PROMPT } from '../mapping.mjs';

// Orchestrator parity with bne-ship-clean, WS-4: the epic drive is now the runtime spine (runOrchestrator via
// run-epic.mjs). Standalone (NOT spread from the legacy scenario) because the runtime path DEFERS the PR/merge
// to the host — it PARKS at the merge floor instead of opening + asserting a PR, so legacy's drn-epic PR golden
// does not apply. `fixture` keeps the legacy pairing name (epic-drainable); `rtFixture` supplies the runtime
// COPY (an active epic with open core members). The operator drives run-epic.mjs; each open core member PARKS
// on execute:<member> — the operator does that member's one-file work + commit, then fulfils; replay advances to
// the next member, then to the MERGE FLOOR PARK (the twin of legacy's single-PR pause). The spine NEVER auto-merges.
export default {
  id: 'rt-bne-ship-clean',
  skill: 'backlog-next-epic',
  driver: 'epic',
  fixture: 'epic-drainable',
  rtFixture: 'epic-clean',
  prompt: OPERATOR_PROMPT(
    'Drive epic e through the runtime orchestrator. Driver command: node runtime/adapters/claude-code/run-epic.mjs e — when parked on an execute:<member> key, read docs/backlog/<member>.md, perform its work exactly (create the file it names with the content it names), commit, then fulfil that key. The merge decision is a human floor decision.'),
  terminal: 'pause',
  callLog: { neverCalled: ['gh pr merge'] },
  state: { fileContains: [{ file: 'docs/m1.txt', needle: 'm1-done' }, { file: 'docs/m2.txt', needle: 'm2-done' }] },
  journal: [
    { runId: 'epic-e', path: 'runtime' },
    { runId: 'epic-e', has: 'member.m1' },
    { runId: 'epic-e', has: 'member.m2' },
    { runId: 'epic-e', awaiting: 'merge-e' },
  ],
  rubric: ["Did the runtime orchestrator drive both core members inline (operator did each member's file work + commit), then stop PARKED at the merge floor without auto-merging or self-merging?"],
};
