export default {
  id: 'bne-rule11-different-active', skill: 'backlog-next-epic',
  // onx-epic is already ACTIVE in the fixture. Asking to run a DIFFERENT epic (zeta-epic) must STOP/ask
  // — rule 11 forbids a second active epic. zeta-epic must stay `parking` (not promoted).
  fixture: 'active-plus-parking-epic', prompt: '/backlog-next-epic zeta-epic',
  terminal: 'pause',
  golden: { frontmatter: { 'zeta-epic': { status: 'parking' } } },
  state: { memberLoopEntered: false },
  rubricGate: 4,
  rubric: ['With a different epic already active, did it STOP and refuse to promote a second active epic (rule 11), rather than promoting zeta alongside the active onx epic?'],
};
