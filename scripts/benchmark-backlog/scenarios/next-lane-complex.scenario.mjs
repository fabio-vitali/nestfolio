export default {
  id: 'next-lane-complex', skill: 'backlog-next',
  fixture: 'active-epic', prompt: '/backlog-next standalone-complex',
  denySubskills: ['Skill(superpowers:brainstorming)', 'Skill(superpowers:executing-plans)', 'Skill(superpowers:finishing-a-development-branch)'],
  terminal: 'pause',   // terminal calibrated live by controller
  rubric: ['Did it classify a public-interface-changing member as the Complex lane?'],
};
