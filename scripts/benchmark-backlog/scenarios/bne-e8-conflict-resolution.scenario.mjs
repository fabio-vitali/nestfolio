import { cpSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSuperpowersSkills } from '../superpowers-path.mjs';

export default {
  id: 'bne-e8-conflict-resolution', skill: 'backlog-next-epic',
  fixture: 'e8-conflict',
  runstate: { phase: 'mid' },          // init-only run-state (no e8 marker) → resume into the ship + finishing flow
  prompt: '/backlog-next-epic e8-conflict',
  terminal: 'pause',                   // stops at the open PR after resolving the conflict (calibrated live)
  callLog: { neverCalled: ['gh pr merge'] },
  rubricGate: 4,
  // NO-PRE-SHIP: the fixture leaves the epic `status: active` on BOTH sides; the SKILL performs the
  // ship (status→shipped + validation_gate + closed) during the run and then resolves the rebase
  // conflict against origin/main's divergent promotion-marker edit. So every graded field below is
  // PRODUCED BY THE SKILL, not baked by the fixture — the prior setup pre-shipped the branch AND
  // edited a non-overlapping region (the body title), so git auto-merged with no conflict at all and
  // `status: shipped` was a pure fixture artifact (judge 2/5). lintExit0 also fails on unresolved
  // `<<<<<<<` markers, so a half-resolved file cannot pass.
  golden: {
    frontmatter: { 'e8-conflict': { status: 'shipped' } },
    scalarStrings: [{ file: 'e8-conflict', field: 'validation_gate' }],
    present: [{ file: 'e8-conflict', field: 'closed' }],
    lintExit0: true,
  },
  rubric: ['Was the docs/backlog conflict resolved so the epic ends shipped (closed, with a validation gate) and lint clean, rather than left active or with unresolved conflict markers?'],
  setup: async ({ dir, git }) => {
    // 1. Provide the superpowers subskills the finishing/PR route loads via the Skill tool — resolved
    //    portably (env override → highest ~/.claude plugin-cache version), never a baked host path.
    const sp = resolveSuperpowersSkills();
    if (sp) {
      for (const s of ['finishing-a-development-branch', 'using-git-worktrees']) {
        const src = join(sp, s);
        if (existsSync(src)) cpSync(src, join(dir, '.claude/skills', s), { recursive: true });
      }
    }

    // 2. Stage a GUARANTEED, semantically-meaningful rebase conflict WITHOUT pre-shipping:
    //    - branch feat/epic-e8-conflict: epic still `status: active` (members shipped, epic ship NOT done)
    //    - origin/main: a divergent edit to the SAME `status:` line (E1 promotion marker, still active)
    //    When the skill ships on the branch (`status: active` → `status: shipped`), the rebase onto
    //    origin/main's `status: active  # …` line conflicts on exactly the active-vs-shipped decision
    //    the scenario tests. The merge base is the plain `status: active`, both sides changed it → conflict.
    const epicPath = join(dir, 'docs/backlog/e8-conflict.md');
    const baseline = readFileSync(epicPath, 'utf8');
    const C = (msg) => git(dir, '-c', 'user.email=bef@x', '-c', 'user.name=bef', 'commit', '-qm', msg);

    // branch side: create the epic branch at the active baseline — NO ship edit here.
    git(dir, 'branch', 'feat/epic-e8-conflict');

    // main side: divergent edit to the status line (still active) → forces the conflict on the skill's ship.
    git(dir, 'checkout', '-q', 'main');
    const mainSide = baseline.replace(
      /^status: active$/m,
      'status: active  # E1 promotion marker (main side) — epic still active here',
    );
    if (mainSide === baseline) throw new Error('e8-conflict setup: status line not found — fixture changed?');
    writeFileSync(epicPath, mainSide);
    git(dir, 'add', '-A'); C('promotion marker e8-conflict (main side, still active)');
    git(dir, 'push', '-q', 'origin', 'main');

    // leave the epic branch checked out at the un-shipped baseline — the skill resumes onto it
    git(dir, 'checkout', '-q', 'feat/epic-e8-conflict');
  },
};
