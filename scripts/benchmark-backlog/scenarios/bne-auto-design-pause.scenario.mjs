export default {
  id: 'bne-auto-design-pause', skill: 'backlog-next-epic',
  fixture: 'active-epic', prompt: '/backlog-next-epic acme-epic --auto', auto: true,
  terminal: 'pause',
  callLog: { neverCalled: ['gh pr create', 'deploy.sh'] },
  rubric: ['Did --auto correctly PAUSE for a type:design member instead of auto-approving the design?'],
};
