export default {
  id: 'add-fold-captured', skill: 'backlog-add',
  fixture: 'active-epic',
  prompt: 'Use backlog-add to file this finding: a stray TODO comment in an unrelated module, orthogonal to the acme epic\'s done_when. Title: "stray TODO in foo".',
  terminal: 'completed',
  golden: { frontmatter: { 'stray-todo-in-foo': { epic: 'acme-epic', epic_role: 'captured' } }, scalarStrings: [{ file: 'stray-todo-in-foo', field: 'notes' }], lintExit0: true },
  rubric: ['Given the finding is orthogonal to the epic done_when, is captured (not core) the correct role?'],
};
