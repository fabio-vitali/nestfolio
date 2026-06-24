import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBacklogFiles } from '../../.claude/skills/backlog-lint/lib/frontmatter.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function gradeGolden(scenario, sandboxDir) {
  const failures = [];
  const g = scenario.golden ?? {};
  const files = loadBacklogFiles(join(sandboxDir, 'docs/backlog'));
  const byId = Object.fromEntries(files.map((f) => [f.id, f]));
  for (const [id, fields] of Object.entries(g.frontmatter ?? {})) {
    const f = byId[id];
    if (!f) { failures.push(`expected backlog file "${id}" not found`); continue; }
    for (const [k, v] of Object.entries(fields)) {
      if (JSON.stringify(f.frontmatter[k]) !== JSON.stringify(v))
        failures.push(`${id}.${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(f.frontmatter[k])}`);
    }
  }
  for (const { file, field } of g.scalarStrings ?? []) {
    const f = byId[file];
    if (f && typeof f.frontmatter[field] !== 'string') failures.push(`${file}.${field} must be a YAML string scalar`);
  }
  if (g.lintExit0) {
    try { execFileSync('node', [join(sandboxDir, '.claude/skills/backlog-lint/lint.mjs')], { cwd: sandboxDir, encoding: 'utf8', env: { ...process.env, NESTFOLIO_MEMORY_DIR: join(sandboxDir, '.mem') } }); }
    catch (e) { failures.push(`lint did not exit 0: ${e.stderr?.toString() || e.stdout?.toString() || e.message}`); }
  }
  return { pass: failures.length === 0, failures };
}

function branchExists(dir, name) {
  try { execFileSync('git', ['rev-parse', '--verify', '--quiet', name], { cwd: dir }); return true; } catch { return false; }
}

export function gradeInvariants(scenario, runResult, sandboxDir, stubsLog = '') {
  const failures = [];
  const cl = scenario.callLog ?? {};
  for (const c of cl.called ?? []) if (!stubsLog.includes(c)) failures.push(`expected call-log "${c}" not found`);
  for (const c of cl.neverCalled ?? []) if (stubsLog.includes(c)) failures.push(`forbidden call-log "${c}" present`);
  const st = scenario.state ?? {};
  if (st.branchExists && !branchExists(sandboxDir, st.branchExists)) failures.push(`branch ${st.branchExists} should exist`);
  if (st.branchAbsent && branchExists(sandboxDir, st.branchAbsent)) failures.push(`branch ${st.branchAbsent} should be gone`);
  if (st.worktreeAbsent && existsSync(join(sandboxDir, st.worktreeAbsent))) failures.push(`worktree ${st.worktreeAbsent} should be removed`);
  if (st.runstateAbsent != null) {
    let present = true; try { execFileSync('node', [join(sandboxDir, '.claude/skills/backlog-next-epic/runstate.mjs'), 'get', scenario.fixture], { cwd: sandboxDir }); } catch { present = false; }
    if (st.runstateAbsent === present) failures.push(`runstate present=${present}, expected absent=${st.runstateAbsent}`);
  }
  if (st.originMainContains) {
    const log = execFileSync('git', ['-C', sandboxDir, 'log', 'origin/main', '--oneline'], { cwd: sandboxDir }).toString();
    if (!log.includes(st.originMainContains)) failures.push(`origin/main missing commit "${st.originMainContains}"`);
  }
  if (st.memberLoopEntered != null) {
    const entered = stubsLog.includes('backlog-next-worker');
    if (entered !== st.memberLoopEntered) failures.push(`memberLoopEntered=${entered}, expected ${st.memberLoopEntered}`);
  }
  if (scenario.terminal && runResult.terminalKind !== scenario.terminal) failures.push(`terminal=${runResult.terminalKind}, expected ${scenario.terminal}`);
  if (runResult.terminalKind === 'timeout' && scenario.terminal !== 'timeout') failures.push('run timed out');
  return { pass: failures.length === 0, failures };
}

export async function gradeScenario(scenario, runResult, sandboxDir, stubsLog) {
  const golden = gradeGolden(scenario, sandboxDir);
  const invariants = gradeInvariants(scenario, runResult, sandboxDir, stubsLog);
  const rubric = scenario.rubric?.length ? await (await import('./judge.mjs')).runJudge(scenario, runResult, sandboxDir) : null;
  const gatePass = golden.pass && invariants.pass;
  return { gatePass, golden, invariants, terminalOk: runResult.terminalKind === scenario.terminal, rubric };
}
