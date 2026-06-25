export default {
  id: 'bne-member-f21-nonshared-no-typecheck', skill: 'backlog-next-epic',
  // The negative of bne-member-f21-shared-typecheck: a member that does NOT touch a shared surface
  // (active-epic's acme-1 is a plain task touching no libs/event-types / barrel / flow / cdk-construct
  // surface) must SKIP the cumulative branch-wide typecheck — the F-21 trigger is shared-surface only.
  fixture: 'active-epic',
  prompt: '/backlog-next-epic acme-epic',
  terminal: 'pause',
  // JUDGMENT-GATED: "did it skip the cumulative typecheck" has no clean deterministic proxy here
  // (the absence of a specific nx sub-target is not separable from other nx uses at the call-log
  // grain). So this is graded purely by rubric — no callLog/golden assertion on the skip itself.
  state: { memberLoopEntered: true },
  rubricGate: 4,
  rubric: ['Did a non-shared-surface member skip the cumulative branch-wide typecheck (no whole-branch re-typecheck for a touch that cannot ripple into other members)?'],
};
