// mint.mjs — runMint(): the reference composition of the §4 mint procedure over the six helpers.
// SPEC 3's worker composes the same helpers; the dogfood (§10) uses this entry point. Now async: the
// floor ask + registerRatified are awaited (the unified seam, fork Q1).
import { draftCandidate } from './draft-candidate.mjs';
import { presentFloor } from './present-floor.mjs';
import { registerRatified } from './register-ratified.mjs';
import { advanceLifecycle } from '../../lib/advance-lifecycle.mjs';
import { headlessAsk, inMemoryJournal } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export async function runMint({ item, lesson, proposal, ask = headlessAsk, journal = inMemoryJournal(), checksDir, dossierRoot, scenariosDir }) {
  const draft = draftCandidate({ item, lesson, proposal });
  if (!draft) return { kind: 'rejected', reason: 'not-mechanizable' };                 // §8 category error

  const choice = {
    act: 'mint', candidate: draft.entry, lesson: draft.entry.provenance.lesson,
    rationale: draft.rationale, recommended: 'ratify', options: ['ratify', 'edit', 'decline'],
  };
  const { selected, sentinel } = await presentFloor({ choice, ask });
  if (sentinel) return { kind: 'paused', sentinel };                                    // --auto/headless

  if (selected === 'ratify') {
    return { kind: 'minted', ...(await registerRatified({ draft, floorApproval: true, journal, checksDir, dossierRoot, scenariosDir })) };
  }
  if (selected === 'decline') {
    advanceLifecycle({ check: draft.entry, transition: 'decline', floorApproval: true });  // discarded, never persisted
    return { kind: 'declined' };
  }
  return { kind: 'edit', draft };                                                       // re-draft loop (caller)
}

function main() { console.error('mint.mjs is a library; import runMint'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
