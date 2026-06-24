export default {
  id: 'next-lane-complex', skill: 'backlog-next',
  fixture: 'active-epic', prompt: '/backlog-next acme-1',
  denySubskills: ['Skill(superpowers:brainstorming)', 'Skill(superpowers:executing-plans)', 'Skill(superpowers:finishing-a-development-branch)'],
  terminal: 'pause',   // classification-only: stop at the lane verdict
  rubric: ['Did it classify a public-interface-changing member as the Complex lane?'],
};
