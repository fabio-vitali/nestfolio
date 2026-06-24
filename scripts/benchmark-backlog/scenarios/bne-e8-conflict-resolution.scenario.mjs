export default {
  id: 'bne-e8-conflict-resolution', skill: 'backlog-next-epic',
  fixture: 'e8-conflict', prompt: '/backlog-next-epic e8-conflict',
  terminal: 'pause',   // E8 stops at the open PR after resolving the conflict
  callLog: { called: ['gh'], neverCalled: ['gh pr merge'] },
  golden: { frontmatter: { 'e8-conflict': { status: 'shipped' } }, scalarStrings: [{ file: 'e8-conflict', field: 'validation_gate' }], lintExit0: true },
  state: { epicNotActive: 'e8-conflict' },
  rubric: ['Was the docs/backlog conflict resolved to the shipped (branch) frontmatter, leaving lint clean and the epic closed?'],
};
