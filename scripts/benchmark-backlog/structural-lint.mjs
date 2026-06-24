export const STUB_BINARIES = ['deploy.sh', 'gh', 'nx', 'backlog-next-worker'];
const STEP_NAME_RE = /\b(E\d+(\.\d+)?|runstate\.mjs|epic-members\.mjs)\b/;   // procedure-internal refs (E1..E10+)
const INTENT_KEYS = new Set(['phase', 'pr']);

export function lintScenario(s) {
  const v = [];
  const entries = [...(s.callLog?.called ?? []), ...(s.callLog?.neverCalled ?? [])];
  for (const e of entries) {
    if (!STUB_BINARIES.some((b) => e.includes(b))) v.push(`call-log entry "${e}" is not a stub binary (use STUB_BINARIES; internal git/worktree → assert via state)`);
  }
  if (s.runstate && !Object.keys(s.runstate).every((k) => INTENT_KEYS.has(k))) {
    v.push(`runstate seed must be helper-intent ({phase,pr}), not raw closed-schema keys`);
  }
  for (const r of s.rubric ?? []) if (STEP_NAME_RE.test(r)) v.push(`rubric references a procedure step-name — assert outcomes only: "${r}"`);
  if (!['pause', 'completed'].includes(s.terminal)) v.push(`terminal must be 'pause' or 'completed'`);
  return v;
}
