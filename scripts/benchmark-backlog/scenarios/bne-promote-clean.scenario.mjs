export default {
  id: 'bne-promote-clean', skill: 'backlog-next-epic',
  // Clean promote of a fully-formed parking epic, asserted within a full --auto run. NOTE: subskill
  // denials CANNOT stop the epic orchestrator after promote — it drives the member loop + finish via raw
  // Bash (worker.mjs, gh, git), circumventing Skill() denies (proven: the run reaches PR-open even with
  // backlog-next denied). So we don't try to halt it. Instead we assert the PROMOTE landed correctly:
  // delta-epic flips to active with done_when/scope/out_of_scope intact on the sandbox ROOT (the promote
  // marker is committed on main — the later ship lands on the unmerged branch, so root stays active), AND
  // the marker reaches origin/main with the 'promote' verb (E1). The run then drives to a clean PR-open
  // pause. The full ship is bne-ship-clean's concern; here the deterministic teeth are the promote outcome.
  fixture: 'parking-epic', prompt: '/backlog-next-epic delta-epic',
  terminal: 'pause',
  golden: {
    frontmatter: { 'delta-epic': { status: 'active' } },
    present: [
      { file: 'delta-epic', field: 'done_when' },
      { file: 'delta-epic', field: 'scope' },
      { file: 'delta-epic', field: 'out_of_scope' },
    ],
  },
  state: { originMainContains: 'promote' },
  rubric: ['Did it cleanly promote the epic to active with done_when, scope, and out_of_scope all present, and commit the promotion marker to origin/main?'],
};
