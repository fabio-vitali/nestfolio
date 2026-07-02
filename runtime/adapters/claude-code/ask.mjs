// runtime/adapters/claude-code/ask.mjs — binds ask to AskUserQuestion; degrades to a PAUSE Choice.
import { PAUSE } from '../../engine/backward/lib/capabilities.mjs';
export function makeAsk({ interactive } = {}) {
  return async function ask(decision) {
    if (interactive) return await interactive(decision);   // AskUserQuestion binding (host-supplied)
    return { decisionId: decision.id, value: PAUSE };       // headless → pause (the caller parks it)
  };
}
