// runtime/adapters/claude-code/fulfil-key.mjs — resolve an operator-supplied --fulfil key to the pending
// step key it targets. The epic spine parks members under step key `member.<id>` while the executor's park
// decision is `execute:<id>` (only the worker spine's keys coincide); the pending record prints BOTH, and
// journal.fulfil appends by raw key while journal.step replays only its own key — so a fulfil by decision
// id journals an orphan step and the run thrashes. Adapter-ring translation (engine untouched):
//   1. an exact pending step-key match always wins (no translation);
//   2. else a key matching exactly ONE pending step's decision.id maps to that step's key;
//   3. an ambiguous decision-id match throws (never guess which park to advance);
//   4. no pending match passes through unchanged (fresh-run pre-seeded choices keep working).
import { pendingDecisions } from '../../engine/lib/journal.mjs';

export function resolveFulfilKey(ledger, key) {
  const pending = pendingDecisions(ledger);
  if (pending.some((p) => p.key === key)) return key;
  const matches = pending.filter((p) => p.decision?.id === key);
  if (matches.length > 1) {
    throw new Error(`--fulfil ${key} is ambiguous: decision id matches pending steps [${matches.map((p) => p.key).join(', ')}] — pass the step key exactly as printed`);
  }
  return matches.length === 1 ? matches[0].key : key;
}
