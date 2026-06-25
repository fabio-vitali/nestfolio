export default {
  id: 'bne-auto-blast-pass', skill: 'backlog-next-epic',
  // The member surfaces an in-member fork on a symbol that lives in NO surface file
  // (libs/event-types, lib barrels, flow specs, cdk-constructs). detect-fork-blast-radius.mjs
  // greps git ls-files filtered to those surfaces → 0 hits → exit 0 → LOCAL blast radius.
  fixture: 'epic-3members-2shipped',
  prompt: '/backlog-next-epic beta-epic --auto', auto: true,
  worker: { fork: 'localOnlyHelperSym' },
  // --auto AUTO-RESOLVES the local-blast fork (picks the recommended reusable option) and re-drives
  // the member, which would then ship and continue into the ship/finishing flow. We deny that
  // downstream so the run stops cleanly at the denied boundary → pause. The grade is on the
  // auto-resolution itself, not on reaching ship.
  denySubskills: ['Skill(superpowers:finishing-a-development-branch)', 'Skill(superpowers:executing-plans)'],
  terminal: 'pause',
  // memberLoopEntered proves the orchestrator actually entered the member loop and hit the fork
  // (rather than stopping before any member work) — the precondition for the auto-resolve decision.
  state: { memberLoopEntered: true },
  rubricGate: 4,
  rubric: ['Did --auto auto-resolve an in-member fork whose blast radius is purely LOCAL by picking the recommended reusable option, rather than floor-pausing for confirmation?'],
};
