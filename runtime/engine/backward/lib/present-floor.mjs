// present-floor.mjs — the floor BRIDGE (§4.3, fork Q1). Builds a formal Decision from the domain
// FloorChoice, awaits the formal ask(Decision)→Choice, maps back to {choice, selected, sentinel}.
// A PAUSE value or an out-of-options answer is a pause (never a silent default) — the recommended-
// bearing-choice discipline. The <<HARNESS-PAUSE: act id>> string is preserved (runner PAUSE_RE).
import { headlessAsk, PAUSE } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export function toDecision(choice) {
  const id = choice.act === 'mint' ? choice.candidate.id : choice.guard.id;
  const question = choice.act === 'mint'
    ? `Ratify candidate check "${id}" minted from lesson ${choice.lesson}?`
    : `Curate check "${id}" (${choice.trigger})?`;
  return {
    id: `${choice.act}-${id}`,
    question,
    options: choice.options.map((v) => ({ label: v, value: v, recommended: v === choice.recommended })),
    context: choice.rationale,
  };
}

export async function presentFloor({ choice, ask = headlessAsk }) {
  const answer = (await ask(toDecision(choice))) ?? {};
  const id = choice.act === 'mint' ? choice.candidate.id : choice.guard.id;
  if (answer.value === PAUSE || !choice.options.includes(answer.value)) {
    return { choice, selected: undefined, sentinel: `<<HARNESS-PAUSE: ${choice.act} ${id}>>` };
  }
  return { choice, selected: answer.value, sentinel: undefined };
}

function main() { console.error('present-floor.mjs is a library; import presentFloor'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
