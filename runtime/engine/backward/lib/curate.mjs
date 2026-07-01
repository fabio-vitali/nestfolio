// curate.mjs — runCurate(): the reference composition of the §5 curate procedure. Both triggers feed
// ONE floor decision (retire · supersede · keep). recommended default: dangling-scope → retire,
// ship-gate → keep (guard presumed right). Lowering a guard is a hard-floor act (pauses in --auto).
import { presentFloor } from './present-floor.mjs';
import { curateGuard } from './curate-guard.mjs';
import { headlessAsk, inMemoryJournal } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export function runCurate({ guard, trigger, finding, proposedSuccessor, rationale = '', ask = headlessAsk, journal = inMemoryJournal(), checksDir, dossierRoot }) {
  const recommended = trigger === 'dangling-scope' ? 'retire' : 'keep';
  const choice = {
    act: 'curate', guard, trigger, finding,
    ...(proposedSuccessor ? { proposed_successor: proposedSuccessor } : {}),
    rationale, recommended, options: ['retire', 'supersede', 'keep'],
  };
  const { selected, sentinel } = presentFloor({ choice, ask });
  if (sentinel) return { kind: 'paused', sentinel };

  if (selected === 'keep') return { kind: 'kept', ...curateGuard({ guard, trigger, transition: 'keep', rationale, journal, checksDir, dossierRoot }) };
  if (selected === 'retire') return { kind: 'retired', ...curateGuard({ guard, trigger, transition: 'retire', floorApproval: true, rationale: rationale || 'property abandoned', retiredReason: rationale || 'property abandoned', journal, checksDir, dossierRoot }) };
  return { kind: 'superseded', ...curateGuard({ guard, trigger, transition: 'supersede', successor: proposedSuccessor, floorApproval: true, rationale: rationale || 'property narrowed', journal, checksDir, dossierRoot }) };
}

function main() { console.error('curate.mjs is a library; import runCurate'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
