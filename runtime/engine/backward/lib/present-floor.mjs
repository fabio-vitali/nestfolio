// present-floor.mjs — the floor BRIDGE (§4.3, fork Q1). Builds a formal Decision from the domain
// FloorChoice, awaits the formal ask(Decision)→Choice, maps back to {choice, selected, sentinel}.
// A PAUSE value or an out-of-options answer is a pause (never a silent default) — the recommended-
// bearing-choice discipline. The <<HARNESS-PAUSE: act id>> string is preserved (runner PAUSE_RE).
import { headlessAsk, PAUSE } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

/** §2.3: the Decision renders the COMPLETE act — the human never ratifies sight-unseen. */
function renderContext(choice) {
  if (choice.act === 'mint') {
    return [`RATIONALE: ${choice.rationale ?? ''}`,
      '--- candidate check (full YAML) ---',
      stringify(choice.candidate).trimEnd()].join('\n');
  }
  const parts = [`TRIGGER: ${choice.trigger}`, `RATIONALE: ${choice.rationale ?? ''}`,
    '--- current guard (full YAML) ---', stringify(choice.guard).trimEnd()];
  if (choice.finding) parts.push('--- finding ---', stringify(choice.finding).trimEnd());
  if (choice.proposed_successor) parts.push('--- proposed successor (full YAML) ---',
    stringify(choice.proposed_successor.entry ?? choice.proposed_successor).trimEnd());
  return parts.join('\n');
}

export function toDecision(choice) {
  const entity = choice.act === 'mint' ? choice.candidate : choice.guard;
  const gen = entity.provenance?.generation ?? 1;                  // §2.4: gen-1 fulfilment can never replay into gen-2
  const question = choice.act === 'mint'
    ? `Ratify candidate check "${entity.id}" minted from lesson ${choice.lesson}?`
    : `Curate check "${entity.id}" (${choice.trigger})?`;
  return {
    id: `${choice.act}-${entity.id}-g${gen}`,
    question,
    options: choice.options.map((v) => ({ label: v, value: v, recommended: v === choice.recommended })),
    context: renderContext(choice),
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
