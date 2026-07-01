// runtime/engine/backward/lib/capabilities.mjs — the injected SPEC-3 capability SEAMS (D3).
// Ring-1 ships HEADLESS defaults; SPEC 3 injects real bindings (interactive ask, persistent journal).
// A floor act NEVER self-resolves in headless/--auto — ask returns a <<HARNESS-PAUSE>> sentinel (§6, §13.4).
import { fileURLToPath } from 'node:url';

/** Headless ask: returns { sentinel } — the caller MUST pause. Never returns a selected transition. */
export function headlessAsk({ choice }) {
  const id = choice.act === 'mint' ? choice.candidate.id : choice.guard.id;
  return { sentinel: `<<HARNESS-PAUSE: ${choice.act} ${id}>>` };
}

/** In-memory append-only idempotency ledger. SPEC 3 provides a persistent one. */
export function inMemoryJournal() {
  const seen = new Map();
  return {
    has: (key) => seen.has(key),
    get: (key) => seen.get(key),
    record: (key, decision) => { if (!seen.has(key)) seen.set(key, decision); return seen.get(key); },
  };
}

function main() { console.error('capabilities.mjs is a library; SPEC 3 injects real ask/journal'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
