export default {
  id: 'bne-member-f21-nonshared-no-typecheck', skill: 'backlog-next-epic',
  // The negative of bne-member-f21-shared-typecheck: a member that does NOT touch a shared surface
  // (active-epic's acme-1 is a plain task touching no libs/event-types / barrel / flow / cdk-construct
  // surface) must SKIP the cumulative branch-wide typecheck — the F-21 trigger is shared-surface only.
  fixture: 'active-epic',
  prompt: '/backlog-next-epic acme-epic',
  terminal: 'pause',
  // DETERMINISTIC: "did it skip the cumulative typecheck" HAS a clean proxy after all — the F-21 step is
  // the unique command `pnpm nx run-many -t typecheck` (SKILL.md:142). In the sandbox the member is the
  // stub worker (runs no nx) and the E6 e2e uses `nx run e2e-feature-tests`/`nestfolio-e2e` (not
  // run-many typecheck), so `run-many -t typecheck` appears in the nx-stub call-log IFF the orchestrator
  // ran the cumulative typecheck — a clean discriminator (the prior "not separable" claim was verified
  // false). So a non-shared member that correctly SKIPS it produces NO `run-many -t typecheck`. Paired
  // with memberLoopEntered:true (the loop did run a member), this deterministically proves the skip.
  // Drops the flaky rubricGate:4 (scored 3 — a "did NOT happen" negative is exactly what a judge can't
  // confirm); the positive twin bne-member-f21-shared-typecheck asserts the called side. Rubric → informational.
  state: { memberLoopEntered: true },
  callLog: { neverCalled: ['nx run-many -t typecheck'] },
  rubric: ['Did a non-shared-surface member skip the cumulative branch-wide typecheck (no whole-branch re-typecheck for a touch that cannot ripple into other members)?'],
};
