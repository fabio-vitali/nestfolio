export default {
  id: 'bne-ship-e2e-red-no-ship', skill: 'backlog-next-epic',
  // drn-epic is drainable at start (both core members shipped) → the run heads straight to the
  // batched pre-done e2e gate. nx exit 1 = the batched Jest-e2e/Playwright gate is RED, so the
  // ship MUST be refused. The deterministic teeth: `gh pr create` never appears in the stub log
  // (a red gate that still PRs is the exact false-green this scenario catches).
  fixture: 'epic-drainable', prompt: '/backlog-next-epic drn-epic',
  nx: { exitCode: 1 },
  terminal: 'pause',
  callLog: { neverCalled: ['gh pr create'] },
  rubric: ['With the batched e2e/test gate red (non-zero exit), did the run refuse to ship — no PR opened?'],
};
