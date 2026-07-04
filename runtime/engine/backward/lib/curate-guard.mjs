// curate-guard.mjs — curateGuard(): §5. Wraps advanceLifecycle('retire'|'supersede') + reconcileLesson.
// 'keep' is a procedure-level NO-OP (Δ3: merged advanceLifecycle LEGAL has no 'keep') — never advances state,
// never journaled. retire/supersede run inside journal.step (SPEC 3): replay ⇒ the recorded result.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { advanceLifecycle } from '../../lib/advance-lifecycle.mjs';
import { reconcileLesson } from './reconcile-lesson.mjs';
import { inMemoryJournal } from './capabilities.mjs';
import { validateCheck } from '../../schema/check.schema.ts';
import { EvalScenarioDraftSchema } from '../schema/candidate-draft.ts';
import { formatZodError } from '../../schema/finding.schema.ts';
import { landEvalScenario } from './land-eval-scenario.mjs';
import { fileURLToPath } from 'node:url';

export async function curateGuard({ guard, trigger, transition, successor, floorApproval, rationale, retiredReason, journal = inMemoryJournal(), checksDir, dossierRoot, scenariosDir }) {
  if (transition === 'keep') {                                          // §5 keep — no state change, no persist, no journal
    return { check: guard, kept: true, decision: keepDecision(guard, trigger, rationale) };
  }

  const res = advanceLifecycle({ check: guard, transition, floorApproval, successor: successor?.entry, retiredReason });   // pure
  if (res.event !== 'RETIRED' && res.event !== 'SUPERSEDED') return { check: guard, event: res.event, decision: null };  // refusal BEFORE journal.step

  // §2.2: the successor gets the FULL mint guarantees — refusal BEFORE the journal step (no record, no disk),
  // the same discipline as ratify.
  if (res.event === 'SUPERSEDED') {
    const v = validateCheck(res.successor);
    if (!v.ok) return { check: guard, event: 'REFUSED_INVALID_SUCCESSOR', error: v.error, decision: null };
    const s = EvalScenarioDraftSchema.safeParse(successor.eval_scenario);
    if (!s.success) return { check: guard, event: 'REFUSED_INVALID_SUCCESSOR', error: formatZodError(s.error), decision: null };
  }

  const gen = guard.provenance.generation ?? 1;                    // §2.4 epoch
  const journalKey = `curate:${guard.id}:g${gen}:${transition}`;
  return await journal.step('backward', journalKey, async () => {
    // §2.1 order: land the successor scenario (idempotent by check id — same convergence argument), then
    // reconcile, then the YAML writes. reconcile throws → nothing touched disk → clean retry. A write-throw
    // after reconcile leaves the guard ACTIVE on disk, so the retry re-runs advanceLifecycle legally and
    // every reconcile branch is idempotent → retry converges.
    const landing = res.successor
      ? landEvalScenario({ draft: { entry: res.successor, eval_scenario: successor.eval_scenario }, scenariosDir })
      : undefined;

    const lesson = guard.provenance.lesson;
    const reconciled = lesson
      ? reconcileLesson({ lesson, check: guard.id, transition, successor: successor?.entry?.id, generation: gen, dossierRoot })
      : { lesson: null, mints: [] };

    // floor decision 2026-07-04: successor YAML FIRST, guard YAML LAST — the guard write is the commit
    // point of the act. A crash between the two writes leaves the guard ACTIVE on disk (plus a harmless
    // already-active successor), so a disk-reloading retry re-runs advanceLifecycle legally and converges;
    // guard-first would leave a superseded guard with no successor and a permanently-refused retry.
    mkdirSync(checksDir, { recursive: true });
    if (res.successor) writeFileSync(join(checksDir, `${res.successor.id}.yaml`), stringify(res.successor), 'utf8');
    writeFileSync(join(checksDir, `${res.check.id}.yaml`), stringify(res.check), 'utf8');   // guard LAST = commit point

    const decision = {
      act: 'curate', transition, check: guard.id, successor: successor?.entry?.id, lesson: lesson ?? undefined,
      rationale: rationale ?? '', provenance: res.check.provenance, decided_by: 'human',
      decided_at: new Date().toISOString(), journal_key: journalKey,
    };
    return { check: res.check, successor: res.successor, decision, mints: reconciled.mints, ...(landing ? { landing } : {}) };
  });
}

function keepDecision(guard, trigger, rationale) {
  return { act: 'curate', transition: 'keep', check: guard.id, rationale: rationale ?? '',
    provenance: guard.provenance, decided_by: 'human', decided_at: new Date().toISOString(),
    journal_key: `curate:${guard.id}:keep:${trigger}` };
}

function main() { console.error('curate-guard.mjs is a library; import curateGuard'); process.exit(2); }
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
