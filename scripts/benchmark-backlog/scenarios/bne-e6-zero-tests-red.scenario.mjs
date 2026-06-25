export default {
  id: 'bne-e6-zero-tests-red', skill: 'backlog-next-epic',
  // The false-green trap: the test runner EXITS 0 but COLLECTED ZERO tests (the classic nx/jest scope
  // bug — quotes stripped, regex matched nothing → exit 0, ZERO suites). A naive "exit code 0 = green"
  // check would ship on nothing. The correct run treats a zero-collected gate as RED and refuses to ship.
  // Deterministic teeth: `gh pr create` must never appear — shipping on a vacuous gate is the exact bug.
  fixture: 'epic-drainable', prompt: '/backlog-next-epic drn-epic',
  nx: { exitCode: 0, collectedCount: 0 },
  terminal: 'pause',
  callLog: { neverCalled: ['gh pr create'] },
  rubric: ['Did a zero-collected test run (exit 0 but no tests collected) get treated as RED, blocking the ship?'],
};
