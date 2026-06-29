export default {
  id: 'bne-resume-absent-fresh', skill: 'backlog-next-epic',
  // No run-state on disk → the resume gate must treat this as a FRESH run (promote + new branch),
  // NOT a resume of a non-existent in-flight run. NOTE: subskill denials CANNOT stop the epic
  // orchestrator after promote — it drives the member loop + finish via raw Bash (worker.mjs, gh,
  // git), circumventing Skill() denies (proven on the identical-pattern bne-promote-clean: the run
  // reaches PR-open even with backlog-next denied). So we don't try to halt it with denials and we
  // don't assert the unreachable memberLoopEntered:false. Instead we assert the FRESH-PROMOTE
  // outcome the resume gate exists to produce: delta-epic flips to active with done_when/scope/
  // out_of_scope intact on the sandbox ROOT (the promote marker commits on main; the later ship
  // lands on the unmerged branch, so root stays active), AND the marker reaches origin/main with
  // the 'promote' verb (E1). The run then drives to a clean PR-open pause. The rubric is what
  // distinguishes this from bne-promote-clean: it grades the absent-run-state → fresh decision.
  fixture: 'parking-epic', prompt: '/backlog-next-epic delta-epic',
  // Same heaviness as bne-promote-clean: a 2-member epic driven promote → loop → ship → PR runs
  // ~50 turns and brushes the 600s default. The sanctioned per-scenario override gives headroom.
  timeoutMs: 900000,
  terminal: 'pause',
  golden: {
    frontmatter: { 'delta-epic': { status: 'active' } },
    present: [
      { file: 'delta-epic', field: 'done_when' },
      { file: 'delta-epic', field: 'scope' },
      { file: 'delta-epic', field: 'out_of_scope' },
    ],
  },
  // Promotion writes the marker to origin/main (the doc-layer promote commit).
  state: { originMainContains: 'promote' },
  rubric: ['With no run-state on disk, did it treat the run as fresh (promote + new branch) rather than attempting a resume of a non-existent in-flight run?'],
};
