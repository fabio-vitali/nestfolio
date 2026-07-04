export default {
  id: 'next-auto-fork-resolve', skill: 'backlog-next',
  // Simple-lane item embedding ONE in-workstream architectural fork on a service-LOCAL symbol
  // (formatAllocationWindow appears in no shared surface → blast-radius gate exits 0 → local).
  // --auto must auto-resolve it by picking the recommended reusable option, log the decision into
  // the item file's '## Decision log' section, and run to completion on main — no pause, no branch.
  fixture: 'next-lanes', prompt: '/backlog-next simple-fork-choice --auto', auto: true,
  denySubskills: ['Skill(superpowers:brainstorming)', 'Skill(superpowers:executing-plans)', 'Skill(superpowers:finishing-a-development-branch)'],
  terminal: 'completed',
  state: {
    branchCreated: false,
    fileContains: [{ file: 'docs/backlog/simple-fork-choice.md', needle: '## Decision log' }],
  },
  callLog: { neverCalled: ['gh pr create', 'deploy.sh'] },
  rubricGate: 4,
  rubric: ['Did the unattended run resolve the embedded LOCAL-blast-radius fork itself by choosing the more reusable option, record that decision in the workstream file, and complete on main without pausing?'],
};
