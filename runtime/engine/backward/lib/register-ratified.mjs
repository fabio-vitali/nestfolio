// register-ratified.mjs — registerRatified(): §4 step 4, the ATOMIC journal-keyed unit (SPEC 3: journal.step).
// One journal key ⇒ crash/clear replay is a no-op (§5). Order is load-bearing: land the scenario FIRST
// (so a judgment ratify guard is satisfiable), THEN advanceLifecycle('ratify'). A REFUSAL returns BEFORE
// journal.step (never recorded, no yaml). On RATIFIED, the durable write + reconcile run inside the keyed step.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { advanceLifecycle } from '../../lib/advance-lifecycle.mjs';
import { landEvalScenario } from './land-eval-scenario.mjs';
import { reconcileLesson } from './reconcile-lesson.mjs';
import { inMemoryJournal } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export async function registerRatified({ draft, floorApproval, journal = inMemoryJournal(), checksDir, dossierRoot, scenariosDir }) {
  const id = draft.entry.id;
  const journalKey = `mint:${id}:ratify`;

  const landing = landEvalScenario({ draft, scenariosDir });            // step 4.1 (FIRST) — idempotent by check id

  const { check, event } = advanceLifecycle({ check: draft.entry, transition: 'ratify', floorApproval });   // 4.2 (pure)
  // REFUSAL (floorless/illegal): advanceLifecycle returns the ORIGINAL, non-null check with event
  // REFUSED_NO_FLOOR (only `decline` returns check:null). Guard on the EVENT and return BEFORE journal.step —
  // not recorded, no yaml — so a later floor-approved ratify can still proceed.
  if (event !== 'RATIFIED' || !check) return { check, event, landing, decision: null, mints: [] };

  return await journal.step('backward', journalKey, async () => {       // 4.3 — the atomic durable unit, keyed
    mkdirSync(checksDir, { recursive: true });
    writeFileSync(join(checksDir, `${id}.yaml`), stringify(check), 'utf8');

    const reconciled = check.provenance.lesson
      ? reconcileLesson({ lesson: check.provenance.lesson, check: id, transition: 'ratify', ratified: check.provenance.ratified, dossierRoot })
      : { lesson: null, mints: [] };

    const decision = {
      act: 'mint', transition: 'ratify', check: id, lesson: check.provenance.lesson ?? undefined,
      rationale: draft.rationale, provenance: check.provenance, decided_by: 'human',
      decided_at: check.provenance.ratified, journal_key: journalKey,
    };
    return { check, decision, landing, mints: reconciled.mints };
  });
}

function main() { console.error('register-ratified.mjs is a library; import registerRatified'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
