import { cpSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// backlog-next-epic E8 routes to these superpowers subskills (not part of the backlog skill set),
// so the sandbox must carry them for the E8 PR route to load via the Skill tool.
const SUPERPOWERS = '/Users/fabiovitali/.claude/plugins/cache/claude-plugins-official/superpowers/6.0.3/skills';

export default {
  id: 'bne-e8-conflict-resolution', skill: 'backlog-next-epic',
  fixture: 'e8-conflict',
  runstate: { phase: 'mid' },          // init-only run-state (no e8 marker) → resume into the ship/E8 flow
  prompt: '/backlog-next-epic e8-conflict',
  terminal: 'pause',                   // E8 stops at the open PR after resolving the conflict (calibrated live)
  callLog: { neverCalled: ['gh pr merge'] },
  // Branch side (shipped) must win the docs/backlog conflict → epic closed, lint clean, rule-11 unblocked.
  golden: { frontmatter: { 'e8-conflict': { status: 'shipped' } }, scalarStrings: [{ file: 'e8-conflict', field: 'validation_gate' }], lintExit0: true },
  rubric: ['Was the docs/backlog conflict resolved to the shipped (branch) frontmatter, leaving lint clean and the epic closed (status shipped, not active)?'],
  setup: async ({ dir, git }) => {
    // 1. Provide the superpowers subskills E8 routes to.
    for (const s of ['finishing-a-development-branch', 'using-git-worktrees']) {
      const src = join(SUPERPOWERS, s);
      if (existsSync(src)) cpSync(src, join(dir, '.claude/skills', s), { recursive: true });
    }
    // 2. Stage the E8 divergence on docs/backlog/e8-conflict.md:
    //    branch carries SHIPPED frontmatter; origin/main keeps the ACTIVE promotion marker.
    const epicPath = join(dir, 'docs/backlog/e8-conflict.md');
    const baseline = readFileSync(epicPath, 'utf8');
    const C = (msg) => git(dir, '-c', 'user.email=bef@x', '-c', 'user.name=bef', 'commit', '-qm', msg);

    // branch side: ship the epic
    git(dir, 'branch', 'feat/epic-e8-conflict');
    git(dir, 'checkout', '-q', 'feat/epic-e8-conflict');
    const shipped = baseline
      .replace('status: active', 'status: shipped')
      .replace('validation_gate: null', 'validation_gate: "batched e2e green at branch tip; gamma-1/gamma-2 shipped"')
      .replace(/^(notes: .*)$/m, '$1\nclosed: "2026-06-24"');
    writeFileSync(epicPath, shipped);
    git(dir, 'add', '-A'); C('ship e8-conflict epic (branch side)');

    // main side: a divergent edit to the SAME file (promotion marker, still active) → conflict on rebase
    git(dir, 'checkout', '-q', 'main');
    writeFileSync(epicPath, baseline.replace(/^# Epic: E8-Conflict$/m, '# Epic: E8-Conflict (promotion marker — main side, still active)'));
    git(dir, 'add', '-A'); C('promotion marker e8-conflict (main side)');
    git(dir, 'push', '-q', 'origin', 'main');

    // leave the epic branch checked out — the skill resumes onto it
    git(dir, 'checkout', '-q', 'feat/epic-e8-conflict');
  },
};
