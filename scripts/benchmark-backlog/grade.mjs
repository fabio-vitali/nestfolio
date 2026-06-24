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
  for (const { file, field } of g.present ?? []) {
    const f = byId[file];
    if (!f) failures.push(`expected file "${file}" not found`);
    else if (f.frontmatter[field] === undefined) failures.push(`${file}.${field} should be present`);
  }
  for (const { file, field } of g.absent ?? []) {
    const f = byId[file];
    if (f && f.frontmatter[field] !== undefined) failures.push(`${file}.${field} should be absent, got ${JSON.stringify(f.frontmatter[field])}`);
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
  if (st.branchCreated != null) {
    // Location-robust proxy for "the Complex lane adopted": only the Complex lane creates an isolation
    // branch (worktree + branch); Doc-layer/Simple work directly on `main`. The headless model names the
    // branch freely AND adopts inside the worktree checkout (not the sandbox root), so a root-checkout
    // `status: active` golden misses it — assert branch creation instead (any local branch besides main).
    const branches = execFileSync('git', ['branch', '--format=%(refname:short)'], { cwd: sandboxDir })
      .toString().trim().split('\n').map((b) => b.trim()).filter(Boolean);
    const created = branches.some((b) => b !== 'main');
    if (created !== st.branchCreated) failures.push(`branchCreated=${created} (branches: ${branches.join(', ') || 'none'}), expected ${st.branchCreated}`);
  }
  if (st.worktreeAbsent && existsSync(join(sandboxDir, st.worktreeAbsent))) failures.push(`worktree ${st.worktreeAbsent} should be removed`);
  if (st.runstateAbsent != null) {
    // Invoke runstate.mjs with a RELATIVE path (cwd=sandboxDir). An absolute /tmp path hits the macOS
    // symlink entrypoint-guard trap → main() never runs → silent exit 0, falsely reporting "present". (spike 0.5)
    let present = true; try { execFileSync('node', ['.claude/skills/backlog-next-epic/runstate.mjs', 'get', scenario.fixture], { cwd: sandboxDir }); } catch { present = false; }
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

// Opt-in rubric gate. Default (no scenario.rubricGate) → rubric is informational only. When a
// scenario sets `rubricGate: <minScore>`, every judge dimension must be >= minScore for the gate to
// pass — for judgment-heavy scenarios whose thin deterministic gate can't fully verify the behavior
// (the proof showed next-lane/e8-conflict gate-passing at judge 1-2/5). A missing rubric fails the gate.
export function rubricGatePasses(rubric, minScore) {
  if (!minScore) return true;
  if (!rubric || !rubric.scores) return false;
  return Object.values(rubric.scores).every((s) => s >= minScore);
}

export async function gradeScenario(scenario, runResult, sandboxDir, stubsLog) {
  const golden = gradeGolden(scenario, sandboxDir);
  const invariants = gradeInvariants(scenario, runResult, sandboxDir, stubsLog);
  const rubric = scenario.rubric?.length ? await (await import('./judge.mjs')).runJudge(scenario, runResult, sandboxDir) : null;
  const gatePass = golden.pass && invariants.pass && rubricGatePasses(rubric, scenario.rubricGate);
  return { gatePass, golden, invariants, terminalOk: runResult.terminalKind === scenario.terminal, rubric };
}
