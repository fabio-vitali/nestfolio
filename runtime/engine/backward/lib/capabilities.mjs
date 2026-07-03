// runtime/engine/backward/lib/capabilities.mjs — the SPEC-3 capability seam, UNIFIED (fork Q1).
// The backward edge now speaks the formal Journal (../../lib/journal.mjs) + Decision/Choice shapes.
// Headless default: ask returns a Choice whose value is the PAUSE sentinel — the caller MUST pause.
import { fileURLToPath } from 'node:url';
import { PAUSE } from '../../lib/journal.mjs';
export { inMemoryJournal, PAUSE } from '../../lib/journal.mjs';   // the formal Journal + sentinel, one home

/** Headless ask: a floor act NEVER self-resolves — returns a Choice carrying the PAUSE value. */
export async function headlessAsk(decision) {
  return { decisionId: decision.id, value: PAUSE };
}

function main() { console.error('capabilities.mjs is a library; the adapter injects the interactive ask/journal'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
