// register-ratified.mjs — registerRatified(): §4 step 4, the ATOMIC journal-keyed unit.
// One journal_key ⇒ crash/clear replay is a no-op (§6.2). Order is load-bearing: land the scenario
// FIRST (so a judgment ratify guard is satisfiable), THEN advanceLifecycle('ratify') + persist,
// THEN reconcile the lesson. floorApproval is delegated to advanceLifecycle (REFUSED_NO_FLOOR).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { advanceLifecycle } from '../../lib/advance-lifecycle.mjs';
import { landEvalScenario } from './land-eval-scenario.mjs';
import { reconcileLesson } from './reconcile-lesson.mjs';
import { inMemoryJournal } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export function registerRatified({ draft, floorApproval, journal = inMemoryJournal(), checksDir, dossierRoot, scenariosDir }) {
  const id = draft.entry.id;
  const journalKey = `mint:${id}:ratify`;
  if (journal.has(journalKey)) return journal.get(journalKey);          // replay → no-op

  const landing = landEvalScenario({ draft, scenariosDir });            // step 4.1 (FIRST)

  const { check, event } = advanceLifecycle({ check: draft.entry, transition: 'ratify', floorApproval });   // 4.2
  if (event !== 'RATIFIED' || !check) return { check, event, landing, decision: null, mints: [] };
  mkdirSync(checksDir, { recursive: true });
  writeFileSync(join(checksDir, `${id}.yaml`), stringify(check), 'utf8');

  const reconciled = check.provenance.lesson                            // 4.3
    ? reconcileLesson({ lesson: check.provenance.lesson, check: id, transition: 'ratify', ratified: check.provenance.ratified, dossierRoot })
    : { lesson: null, mints: [] };

  const decision = {
    act: 'mint', transition: 'ratify', check: id, lesson: check.provenance.lesson ?? undefined,
    rationale: draft.rationale, provenance: check.provenance, decided_by: 'human',
    decided_at: check.provenance.ratified, journal_key: journalKey,
  };
  const result = { check, decision, landing, mints: reconciled.mints };
  journal.record(journalKey, result);
  return result;
}

function main() { console.error('register-ratified.mjs is a library; import registerRatified'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
