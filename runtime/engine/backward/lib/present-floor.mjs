// present-floor.mjs — presentFloor(): binds the ask() capability (§6). In headless/--auto the injected
// ask returns a <<HARNESS-PAUSE>> sentinel and this NEVER self-resolves. A malformed/absent selection
// is treated as a pause, never a silent default (the recommended-bearing-choice discipline).
import { headlessAsk } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export function presentFloor({ choice, ask = headlessAsk }) {
  const answer = ask({ choice }) ?? {};
  if (typeof answer.sentinel === 'string') return { choice, selected: undefined, sentinel: answer.sentinel };
  const selected = answer.selected;
  if (!choice.options.includes(selected)) {
    const id = choice.act === 'mint' ? choice.candidate.id : choice.guard.id;
    return { choice, selected: undefined, sentinel: `<<HARNESS-PAUSE: ${choice.act} ${id}>>` };
  }
  return { choice, selected, sentinel: undefined };
}

function main() { console.error('present-floor.mjs is a library; import presentFloor'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
