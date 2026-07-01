// curate-guard.mjs — curateGuard(): §5. Wraps advanceLifecycle('retire'|'supersede') + reconcileLesson.
// 'keep' is a procedure-level NO-OP (Δ3: merged advanceLifecycle LEGAL has no 'keep') — never advances state.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { advanceLifecycle } from '../../lib/advance-lifecycle.mjs';
import { reconcileLesson } from './reconcile-lesson.mjs';
import { inMemoryJournal } from './capabilities.mjs';
import { fileURLToPath } from 'node:url';

export function curateGuard({ guard, trigger, transition, successor, floorApproval, rationale, retiredReason, journal = inMemoryJournal(), checksDir, dossierRoot }) {
  if (transition === 'keep') {                                          // §5 keep — no state change, no persist
    return { check: guard, kept: true, decision: keepDecision(guard, trigger, rationale) };
  }
  const journalKey = `curate:${guard.id}:${transition}`;
  if (journal.has(journalKey)) return journal.get(journalKey);

  const res = advanceLifecycle({ check: guard, transition, floorApproval, successor, retiredReason });
  if (res.event !== 'RETIRED' && res.event !== 'SUPERSEDED') return { check: guard, event: res.event, decision: null };

  mkdirSync(checksDir, { recursive: true });
  writeFileSync(join(checksDir, `${res.check.id}.yaml`), stringify(res.check), 'utf8');
  if (res.successor) writeFileSync(join(checksDir, `${res.successor.id}.yaml`), stringify(res.successor), 'utf8');

  const lesson = guard.provenance.lesson;
  const reconciled = lesson
    ? reconcileLesson({ lesson, check: guard.id, transition, successor: successor?.id, dossierRoot })
    : { lesson: null, mints: [] };

  const decision = {
    act: 'curate', transition, check: guard.id, successor: successor?.id, lesson: lesson ?? undefined,
    rationale: rationale ?? '', provenance: res.check.provenance, decided_by: 'human',
    decided_at: new Date().toISOString(), journal_key: journalKey,
  };
  const result = { check: res.check, successor: res.successor, decision, mints: reconciled.mints };
  journal.record(journalKey, result);
  return result;
}

function keepDecision(guard, trigger, rationale) {
  return { act: 'curate', transition: 'keep', check: guard.id, rationale: rationale ?? '',
    provenance: guard.provenance, decided_by: 'human', decided_at: new Date().toISOString(),
    journal_key: `curate:${guard.id}:keep:${trigger}` };
}

function main() { console.error('curate-guard.mjs is a library; import curateGuard'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
