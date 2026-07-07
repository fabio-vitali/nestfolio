// .claude/skills/backlog-next/next-driver.mjs — the WS-3 strangler branch (mirrors backlog-gate.mjs).
// Flag on → the SKILL Step-5 drive routes to the runtime worker; off → the legacy SKILL.md body runs.
// Single decision site so the flag lives in exactly one place.
import { usesRuntimeEngine } from '../../../runtime/engine/lib/path-provenance.mjs';
export function nextDriver(env) {
  return usesRuntimeEngine(env)
    ? { cmd: 'node runtime/adapters/claude-code/run-next.mjs', mode: 'runtime' }
    : { cmd: null, mode: 'legacy' };
}
