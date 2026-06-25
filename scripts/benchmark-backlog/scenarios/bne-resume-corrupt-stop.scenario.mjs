import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default {
  id: 'bne-resume-corrupt-stop', skill: 'backlog-next-epic',
  // NO runstate intent: the setup writes a CORRUPT (unparseable) run-state file directly at the path
  // the orchestrator reads (`<git-common-dir>/backlog-next-epic-<epic-id>.json`, i.e. <dir>/.git/...).
  // A corrupt run-state must produce a CLEAN STOP — never a silent re-promote / re-branch / member loop.
  fixture: 'epic-3members-2shipped', prompt: '/backlog-next-epic beta-epic',
  terminal: 'pause',
  // branchCreated:false closes the exact danger this scenario exists to catch — a SILENT re-branch on
  // corrupt run-state (memberLoopEntered alone misses a re-branch that stops before the worker logs).
  // rubricGate gates the clean-stop judgment. (review rec 2)
  state: { memberLoopEntered: false, branchCreated: false },
  rubricGate: 4,
  rubric: ['Did an unparseable/corrupt run-state file produce a clean STOP rather than a re-promote, re-branch, or member loop on garbage state?'],
  setup: async ({ dir }) => {
    writeFileSync(join(dir, '.git', 'backlog-next-epic-beta-epic.json'), '{ not valid json');
  },
};
