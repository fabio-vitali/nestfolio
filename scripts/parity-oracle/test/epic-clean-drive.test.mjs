// scripts/parity-oracle/test/epic-clean-drive.test.mjs — deterministic (no-LLM) drive of the WS-4
// epic twins' sandbox: builds the epic-clean fixture sandbox, drives run-epic.mjs through both member
// fulfils exactly as a protocol-compliant operator would, and asserts the run parks at the merge floor
// with gradeJournal green. Locks the two live-red root causes of parity-oracle-bne-live-red-fixes:
// the fixture must satisfy the starter registry at epic-pre-done (BACKLOG.md / non-empty check scopes),
// and the member park must be fulfil-able by its pending step key (member.<id>, decision execute:<id>).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRuntimeSandbox } from '../runtime-sandbox.mjs';
import { gradeJournal } from '../runtime-grade.mjs';
import scenario from '../scenarios/rt-bne-e8-auto-no-self-merge.scenario.mjs';

const drive = (dir, extra = []) => {
  try {
    const out = execFileSync('node', ['runtime/adapters/claude-code/run-epic.mjs', 'e', '--auto', ...extra],
      { cwd: dir, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: JSON.parse(out) };
  } catch (e) {
    if (e.signal) assert.fail(`run-epic.mjs hung (killed by ${e.signal})`);
    let out; try { out = JSON.parse(e.stdout ?? ''); } catch { assert.fail(`unparseable driver output (exit ${e.status}): ${e.stdout}\n${e.stderr}`); }
    return { code: e.status, out };
  }
};

test('epic-clean sandbox: run-epic drives both members and parks awaiting merge-e (gradeJournal green)', async () => {
  const { dir, cleanup } = await buildRuntimeSandbox(scenario, 'HEAD');
  try {
    let r = drive(dir);
    for (let i = 0; i < 2; i++) {
      assert.equal(r.code, 3, `drive#${i + 1}: expected park (exit 3), got ${r.code}: ${JSON.stringify(r.out.result ?? r.out)}`);
      const park = (r.out.pending ?? []).find((p) => String(p.decision?.id ?? '').startsWith('execute:'));
      assert.ok(park, `drive#${i + 1}: expected a pending execute park, got ${JSON.stringify((r.out.pending ?? []).map((p) => [p.key, p.decision?.id]))}`);
      const member = park.decision.id.replace('execute:', '');
      // the pending KEY is the journal step key — the only key journal.step replays (protocol contract)
      assert.equal(park.key, `member.${member}`);
      // operator work: create the member's file and commit (the fixture members' done_when)
      writeFileSync(join(dir, 'docs', `${member}.txt`), `${member}-done`);
      execSync(`git add -A && git -c user.email=po@x -c user.name=po commit -qm "member ${member}"`, { cwd: dir });
      r = drive(dir, ['--fulfil', park.key, '--value', JSON.stringify({ taskId: member, status: 'done', summary: `created docs/${member}.txt` })]);
    }
    // after both members: the epic-pre-done batch must pass and the run must park at the merge floor
    assert.equal(r.code, 3, `expected merge-floor park (exit 3), got ${r.code}: ${JSON.stringify(r.out.result ?? r.out)}`);
    assert.ok((r.out.pending ?? []).some((p) => p.key === 'merge-e'), `expected awaiting merge-e, pending: ${JSON.stringify((r.out.pending ?? []).map((p) => p.key))}`);
    const g = gradeJournal(scenario, dir);
    assert.ok(g.pass, `gradeJournal failures: ${JSON.stringify(g.failures)}`);
  } finally { cleanup(); }
});
