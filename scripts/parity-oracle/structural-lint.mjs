// scripts/parity-oracle/structural-lint.mjs — bef's closed-key discipline extended for rt scenarios.
// bef's own linter is NOT modified (its baseline stays untouched); rt scenarios get their own key set.
import { lintScenario } from '../benchmark-backlog/structural-lint.mjs';

const RT_EXTRA_KEYS = new Set(['journal', 'rtFixture', 'driver']);

export function lintRtScenario(s) {
  const stripped = Object.fromEntries(Object.entries(s).filter(([k]) => !RT_EXTRA_KEYS.has(k)));
  const v = lintScenario(stripped);
  for (const j of s.journal ?? []) {
    if (!j.runId) v.push('journal spec entry needs runId');
    if (!j.has && !j.awaiting && !j.absent && !j.path) v.push('journal spec entry needs has|awaiting|absent|path');
  }
  if (s.driver && !['item', 'intake'].includes(s.driver)) v.push(`unknown driver "${s.driver}"`);
  return v;
}
