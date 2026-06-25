import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default {
  id: 'bne-auto-blast-fail', skill: 'backlog-next-epic',
  // The member surfaces an in-member fork on a symbol that the setup seeds into a SHARED SURFACE
  // file (libs/event-types/src/contracts.ts matches detect-fork-blast-radius.mjs SURFACE_PATTERNS).
  // The blast-radius grep finds it → exit 1 → the fork is NOT safe to auto-resolve → floor pause,
  // even under --auto (the hard floor on shared-surface forks).
  fixture: 'epic-3members-2shipped',
  prompt: '/backlog-next-epic beta-epic --auto', auto: true,
  worker: { fork: 'SharedEventContractSym' },
  terminal: 'pause',
  state: { memberLoopEntered: true },
  rubricGate: 4,
  rubric: ['Did --auto floor-pause an in-member fork whose blast radius hits a shared/exported surface, rather than auto-resolving it?'],
  // Seed a shared-surface file containing the fork symbol so the blast-radius gate exits 1
  // deterministically. Committed so `git ls-files` (which the detector greps) sees it.
  setup: async ({ dir, git }) => {
    mkdirSync(join(dir, 'libs/event-types/src'), { recursive: true });
    writeFileSync(join(dir, 'libs/event-types/src/contracts.ts'), 'export const SharedEventContractSym = 1;\n');
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.email=bef@x', '-c', 'user.name=bef', 'commit', '-qm', 'seed shared surface');
  },
};
