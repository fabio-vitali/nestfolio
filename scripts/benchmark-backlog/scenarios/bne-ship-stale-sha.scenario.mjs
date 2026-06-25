import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export default {
  id: 'bne-ship-stale-sha', skill: 'backlog-next-epic',
  // JUDGMENT-GATED (rubricGate): the stale-recorded-sha invariant is hard to realize deterministically —
  // there is no golden/state field that captures "the recorded e2e sha no longer matches HEAD". The setup
  // seeds a divergent recorded sha into the run-state notes + a fresh commit on the branch (so HEAD has
  // moved past whatever the e2e was last run against); whether the run RE-RUNS the gate vs ships on the
  // stale pass is purely a judge call. terminal:pause = it returns to the gate rather than shipping.
  fixture: 'epic-drainable', prompt: '/backlog-next-epic drn-epic',
  terminal: 'pause',
  rubricGate: 4,
  rubric: ['Did a stale recorded e2e sha (HEAD moved since the gate last ran) force a return to the batched gate rather than shipping on the stale pass?'],
  setup: async ({ dir, git }) => {
    // Stage a post-gate commit on the epic branch so the recorded e2e sha is provably stale: the gate's
    // last-run sha (seeded into a marker file) predates this HEAD, so a correct run must re-run before ship.
    const C = (msg) => git(dir, '-c', 'user.email=bef@x', '-c', 'user.name=bef', 'commit', '-qm', msg);
    git(dir, 'branch', 'feat/epic-drn-epic');
    git(dir, 'checkout', '-q', 'feat/epic-drn-epic');
    const markerDir = join(dir, 'docs/backlog');
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(join(markerDir, '.e2e-last-run-sha'), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');
    git(dir, 'add', '-A'); C('post-gate change on branch (recorded e2e sha now stale)');
  },
};
