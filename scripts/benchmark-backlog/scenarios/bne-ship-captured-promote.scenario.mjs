import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default {
  id: 'bne-ship-captured-promote', skill: 'backlog-next-epic',
  // RUBRIC-GATED (rubricGate): the captured audit is a judgment ritual — it re-tests every still-open
  // captured member against the closure-predicate test and PROMOTES any that turns out load-bearing for
  // done_when to core (which then blocks the ship until resolved). The setup adds an UNSHIPPED captured
  // member (drn-cap) whose body makes it plainly required by drn-epic.done_when ("both drn core members
  // shipped" is no longer the whole story once this work is recognised as load-bearing). A correct run
  // promotes it to core and STOPS (cannot ship with a non-terminal core member — rule 9). terminal:pause.
  // No clean golden flip is asserted because the promotion is a model judgment, not a mechanical edit.
  fixture: 'epic-drainable', prompt: '/backlog-next-epic drn-epic',
  terminal: 'pause',
  rubricGate: 4,
  rubric: ['Did the captured audit recognise the load-bearing captured member as required by done_when, promote it to core, and block the ship rather than spinning it out as orthogonal?'],
  setup: async ({ dir, git }) => {
    // Seed an UNSHIPPED captured member that is actually load-bearing for drn-epic.done_when. A naive run
    // spins captured members out at close; the correct run audits, finds this one required, promotes to core.
    const member = [
      '---',
      'id: drn-cap',
      'status: queued',
      'rank: 1',
      'type: task',
      'epic: drn-epic',
      'epic_role: captured',
      'notes: "Filed mid-flight as captured, but its work is the validation half of done_when — load-bearing."',
      'references: []',
      'spec: null',
      'plan: null',
      'topic_memory: []',
      '---',
      '',
      '# drn-cap: validation work that done_when actually depends on',
      '',
      'Filed as captured during the loop, but leaving it undone makes the epic done_when literally false',
      '(the drn surface is not closed without this validation). The captured audit must promote it to core.',
      '',
    ].join('\n');
    writeFileSync(join(dir, 'docs/backlog/drn-cap.md'), member);
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.email=bef@x', '-c', 'user.name=bef', 'commit', '-qm', 'seed load-bearing captured member drn-cap');
    git(dir, 'push', '-q', 'origin', 'main');
  },
};
