// .claude/skills/backlog-next-epic/epic-driver.mjs — the WS-4 strangler branch (mirrors next-driver.mjs).
// Flag on → the SKILL epic drive routes to the runtime orchestrator adapter; off → the legacy SKILL.md body
// runs. Single decision site so the flag lives in exactly one place.
import { usesRuntimeEngine } from '../../../runtime/engine/lib/path-provenance.mjs';
export function epicDriver(env) {
  return usesRuntimeEngine(env)
    ? { cmd: 'node runtime/adapters/claude-code/run-epic.mjs', mode: 'runtime' }
    : { cmd: null, mode: 'legacy' };
}
