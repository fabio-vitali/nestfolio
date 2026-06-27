import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const STUB_BINARIES = ['deploy.sh', 'gh', 'nx', 'backlog-next-worker'];
const STEP_NAME_RE = /\b(E\d+(\.\d+)?|runstate\.mjs|epic-members\.mjs)\b/;   // procedure-internal refs (E1..E10+)
const INTENT_KEYS = new Set(['phase', 'pr']);
// Closed key set — a typo'd key would otherwise be silently ignored by the harness (and the scenario
// would mis-grade or mis-run only at the deferred live run). Keep in sync with run.mjs/grade.mjs/sandbox.mjs.
const KNOWN_KEYS = new Set([
  'id', 'skill', 'fixture', 'prompt', 'terminal', 'auto', 'runstate', 'gh', 'nx', 'worker',
  'denySubskills', 'golden', 'callLog', 'state', 'rubric', 'rubricGate', 'setup', 'timeoutMs',
]);
const WORKER_KEYS = new Set(['failCycles', 'fork', 'deployFile']);

/** Pure structural lint — no fs. Run over every scenario by scenarios-lint.test.mjs. */
export function lintScenario(s) {
  const v = [];
  for (const k of Object.keys(s)) if (!KNOWN_KEYS.has(k)) v.push(`unknown scenario key "${k}" (typo? extend KNOWN_KEYS if intentional)`);
  const entries = [...(s.callLog?.called ?? []), ...(s.callLog?.neverCalled ?? [])];
  for (const e of entries) {
    if (!STUB_BINARIES.some((b) => e.includes(b))) v.push(`call-log entry "${e}" is not a stub binary (use STUB_BINARIES; internal git/worktree → assert via state)`);
  }
  if (s.runstate && !Object.keys(s.runstate).every((k) => INTENT_KEYS.has(k))) {
    v.push(`runstate seed must be helper-intent ({phase,pr}), not raw closed-schema keys`);
  }
  if (s.worker) {
    for (const k of Object.keys(s.worker)) if (!WORKER_KEYS.has(k)) v.push(`unknown worker knob "${k}" (allowed: failCycles, fork, deployFile)`);
    if (s.worker.fork && s.skill !== 'backlog-next-epic') v.push(`worker.fork only applies to backlog-next-epic scenarios (in-member fork)`);
    if (s.worker.deployFile && !/^services\/[^/]+\/[^/]+\/src\//.test(s.worker.deployFile)) v.push(`worker.deployFile must be a TIER1 service src path (services/<domain>/<svc>/src/...) so detect-deploy-needed flags it`);
  }
  for (const r of s.rubric ?? []) if (STEP_NAME_RE.test(r)) v.push(`rubric references a procedure step-name — assert outcomes only: "${r}"`);
  if (!['pause', 'completed'].includes(s.terminal)) v.push(`terminal must be 'pause' or 'completed'`);
  return v;
}

/**
 * fs-aware realizability check: the scenario's `fixture` directory MUST exist under fixturesDir.
 * Without this, a typo'd/missing fixture passes the pure lint + unit suite and only blows up at the
 * (deferred, expensive) live run with an opaque cpSync ENOENT. fixturesDir = abs path to fixtures/.
 */
export function lintScenarioFs(s, fixturesDir) {
  const v = [];
  if (!s.fixture || !existsSync(join(fixturesDir, s.fixture))) {
    v.push(`fixture "${s.fixture}" does not exist under ${fixturesDir}`);
  }
  return v;
}
