import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default {
  id: 'bne-member-f21-shared-typecheck', skill: 'backlog-next-epic',
  // A member that touches a SHARED surface (libs/event-types/src/*.ts) must trigger the cumulative
  // branch-wide typecheck (F-21) — a change to shared event contracts can break not-yet-worked
  // members, so the whole branch is re-typechecked rather than just the touched service.
  fixture: 'epic-3members-2shipped',
  prompt: '/backlog-next-epic beta-epic',
  // One core member (beta-3) still open → the run reaches the member boundary after the shared-surface
  // touch + cumulative typecheck and pauses there (no --auto auto-drive into ship).
  terminal: 'pause',
  // Deterministic proxy for "the cumulative branch typecheck ran": the typecheck goes through `nx`
  // (the stub binary). A shared-surface touch must produce an nx invocation; a non-shared touch must
  // not (see bne-member-f21-nonshared-no-typecheck). JUDGMENT-GATED: the nx call is the proxy, the
  // rubric carries the actual "was it cumulative because the surface was shared" assessment.
  callLog: { called: ['nx'] },
  state: { memberLoopEntered: true },
  rubricGate: 4,
  rubric: ['Did the member touching a shared event-contract surface trigger a cumulative branch-wide typecheck rather than a touched-service-only check?'],
  // Seed the shared surface file the member is meant to touch, so the run can observe it as shared.
  setup: async ({ dir, git }) => {
    mkdirSync(join(dir, 'libs/event-types/src'), { recursive: true });
    writeFileSync(join(dir, 'libs/event-types/src/beta-contract.ts'), 'export const BetaContract = 1;\n');
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.email=bef@x', '-c', 'user.name=bef', 'commit', '-qm', 'seed shared event-contract surface');
  },
};
