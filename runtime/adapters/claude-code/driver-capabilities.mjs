// runtime/adapters/claude-code/driver-capabilities.mjs — Seam A′ (ring-2). The judged-capabilities
// composition every workstream-driver main() must use: wires makeAuditProcedures into runProcedure so
// deriveJudge yields a WORKING judge for `skill:<name>` judgment checks at the start / pre-ship / ship
// gates. Bare makeClaudeCodeCapabilities({}) fail-closes those checks ("unknown procedure") — the
// from-run-next-pre-ship-judge-binding-gap bug. Cost note: a check the diff-scoped batch selects then
// REALLY runs headless (RUNTIME_AUDIT_MODEL, default Opus) — the designed item-pre-ship / epic-pre-done
// cadence (epic done_when clause 1), not an accident.
import { makeAuditProcedures } from './audit-procedures.mjs';
import { makeClaudeCodeCapabilities } from './index.mjs';

export function makeDriverCapabilities({ env = process.env, ...auditOpts } = {}) {
  const procedures = makeAuditProcedures({ model: env.RUNTIME_AUDIT_MODEL, env, ...auditOpts });
  return makeClaudeCodeCapabilities({ procedures });
}
