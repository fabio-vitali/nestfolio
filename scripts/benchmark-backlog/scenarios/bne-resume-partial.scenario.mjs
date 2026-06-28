export default {
  id: 'bne-resume-partial', skill: 'backlog-next-epic',
  // beta-epic is already ACTIVE with run-state present (phase:'mid'): beta-1/2 shipped, beta-3 open.
  // A correct resume RE-DERIVES the next open member (beta-3) and drives it — it does NOT re-promote and
  // does NOT restart at beta-1. NOTE: we do NOT deny the worker/finishing subskills. As proven for
  // bne-promote-clean, the epic orchestrator drives the member loop + finish via raw Bash (worker.mjs, gh),
  // circumventing Skill() denies — so a denial-based "stop at the member boundary" is both unreachable AND
  // backwards: a mid-flight resume SHOULD enter the loop (unlike the other resume scenarios, which stop
  // before it). The prior denials forced the orchestrator to improvise around missing tools (35-43 turns,
  // wandering into the PR-open path), which is what made the rubricGate:4 judge swing 1/5↔4/5. We instead
  // let the run drive naturally and assert DETERMINISTIC teeth from the stub call-log: the loop drove
  // beta-3 (the only open member) and never re-drove beta-1/beta-2 (the shipped ones) — i.e. it re-derived
  // the next OPEN member rather than restarting. The run then drives beta-3 → ship → PR-open pause.
  fixture: 'epic-3members-2shipped', runstate: { phase: 'mid' },
  prompt: '/backlog-next-epic beta-epic',
  // Same heavy resume → loop → ship → PR path as bne-promote-clean (~50 turns) — give it the headroom.
  timeoutMs: 900000,
  terminal: 'pause',
  // Deterministic gate: the loop drove the next OPEN member (beta-3) and NEVER the already-shipped ones
  // (beta-1/beta-2). The stub worker logs `backlog-next-worker <id>` to the absolute BEF_STUBS_LOG, so this
  // is cwd-robust and judge-free. This replaces the prior unreachable+backwards `memberLoopEntered:false`.
  callLog: {
    called: ['backlog-next-worker beta-3'],
    neverCalled: ['backlog-next-worker beta-1', 'backlog-next-worker beta-2'],
  },
  // Informational only (no rubricGate): the callLog teeth above deterministically prove the resume picked
  // beta-3, so the judge no longer gates. The previous rubricGate:4 swung 1/5↔4/5 because the run was
  // nondeterministic under the over-denial; deterministic teeth + natural drive remove both flake sources.
  rubric: ['Did it resume the active epic without re-promoting or re-creating the branch, and select the next OPEN member (the only non-shipped one) rather than restarting from the first?'],
};
