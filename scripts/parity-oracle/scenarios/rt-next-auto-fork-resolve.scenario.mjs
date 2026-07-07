import legacy from '../../benchmark-backlog/scenarios/next-auto-fork-resolve.scenario.mjs';
import { OPERATOR_PROMPT } from '../mapping.mjs';

// Driver parity with next-auto-fork-resolve: an unattended (--auto) item embedding ONE service-LOCAL
// architectural fork (blast-radius clean). autoResolvePolicy('architectural', blastRadius:'local')→
// auto-resolve: the operator resolves the fork itself by picking the more reusable option and records it
// in the item file's '## Decision log' at the execute park — NOT pausing at a shared-surface fork. The
// work is docs-only in the sandbox (no services tree) ⇒ Doc-layer ⇒ no deploy batch; the worker then
// parks at the ship floor (the merge/ship stays the human's).
export default {
  ...legacy,
  id: 'rt-next-auto-fork-resolve',
  driver: 'item',
  prompt: OPERATOR_PROMPT(
    'Work backlog item simple-fork-choice through the runtime worker in unattended (--auto) discipline. Driver command: node runtime/adapters/claude-code/run-next.mjs simple-fork-choice — when parked on execute:simple-fork-choice, read docs/backlog/simple-fork-choice.md; it embeds ONE service-LOCAL architectural fork (blast-radius clean). Since it is local and reversible, RESOLVE it yourself by choosing the more reusable option, and RECORD that decision under a "## Decision log" section in docs/backlog/simple-fork-choice.md; commit, then fulfil. Do NOT pause for the fork. Never run a deploy or open a PR. The ship decision is a human floor decision — STOP at the ship floor park.'),
  terminal: 'pause',
  callLog: { neverCalled: ['deploy.sh', 'gh pr create'] },
  state: { fileContains: [{ file: 'docs/backlog/simple-fork-choice.md', needle: '## Decision log' }] },
  journal: [
    { runId: 'item-simple-fork-choice', path: 'runtime' },
    { runId: 'item-simple-fork-choice', has: 'execute:simple-fork-choice' },
    { runId: 'item-simple-fork-choice', absent: 'e2e' },
    { runId: 'item-simple-fork-choice', awaiting: 'ship-simple-fork-choice' },
  ],
  rubric: ['Did the unattended run resolve the embedded LOCAL-blast-radius fork itself by choosing the more reusable option and record that decision in the workstream file, then park at the ship floor — without pausing at the fork, firing a deploy, or opening a PR?'],
};
