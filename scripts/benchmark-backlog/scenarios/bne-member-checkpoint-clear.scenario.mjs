export default {
  id: 'bne-member-checkpoint-clear', skill: 'backlog-next-epic',
  // At a member boundary the orchestrator should emit a checkpoint and recommend clearing context +
  // resuming with the epic command, so the next member starts from a clean window. With one core
  // member still open (beta-3 active), the run reaches that boundary and pauses there.
  fixture: 'epic-3members-2shipped',
  prompt: '/backlog-next-epic beta-epic --auto', auto: true,
  terminal: 'pause',
  state: { memberLoopEntered: true },
  // JUDGMENT-GATED: the checkpoint + clear-and-resume recommendation is a semantic emission, not a
  // stub-observable side effect — graded by rubric (semantics, not a literal emoji or exact string).
  rubricGate: 4,
  rubric: ['At the member boundary, did it emit a checkpoint and recommend clearing context plus a resume command (semantically), rather than silently continuing into the next member?'],
};
