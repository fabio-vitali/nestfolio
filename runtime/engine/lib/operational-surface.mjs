// runtime/engine/lib/operational-surface.mjs — the §14 Option B operational surface, ring-1.
// ASSEMBLY over existing engine helpers, not new engine logic: deriveSurface composes planNext /
// computeImpact (§8) + the injected journal (§5) + the registry (SPEC 1 §4) into ONE read-time view
// (law §13.2: derived, never stored); renderSurface prints the §13.9 legibility spine (active /
// queued-and-why / open-findings / floor-pending / enforcement-and-why); executeOp is the executor —
// every mutation dispatches THROUGH the capability seam (runProcedure / execute), never by touching
// files, so the view cannot drift from the engine because it calls the engine. There is deliberately
// NO merge/ship op kind: ship + merge remain floor asks inside worker/orchestrator (§4.3 no-self-merge).
import { planNext, computeImpact } from './plan-next.mjs';
import { pendingDecisions } from './journal.mjs';

/** Read-time derivation over injected inputs — pure, stores nothing, journal reads are lease-free. */
export function deriveSurface({ backlog, registry, journal, runIds = [], env = {}, blastOf = null, refResolves } = {}) {
  const plan = planNext({ backlog, registry, env });
  const active = {
    item: backlog.find((i) => i.status === 'active' && i.type !== 'epic') ?? null,
    epics: backlog.filter((i) => i.status === 'active' && i.type === 'epic').map((i) => i.id),
  };
  const ranked = plan.ranked.map((i) => ({ id: i.id, rank: i.rank ?? null, type: i.type ?? null, epic: i.epic ?? null,
    impact: computeImpact({ item: i, backlog, blastOf, ...(refResolves ? { refResolves } : {}) }) }));
  const pending = []; const findings = [];
  for (const runId of runIds) {
    const ledger = journal.read(runId);
    if (!ledger) continue;                                             // FRESH / foreign dir — skip
    for (const rec of pendingDecisions(ledger)) pending.push({ runId, key: rec.key, decision: rec.decision, ts: rec.ts });
    for (const rec of ledger.steps.values()) {                          // open = the LATEST record for a key
      if (rec.status === 'complete' && Array.isArray(rec.value?.findings) && rec.value.findings.length) {
        findings.push({ runId, key: rec.key, findings: rec.value.findings });
      }
    }
  }
  const provenance = (registry.checks ?? []).map((c) => ({ id: c.id, status: c.status,
    minted_by: c.provenance?.minted_by ?? null, lesson: c.provenance?.lesson ?? null,
    ratified: c.provenance?.ratified ?? null, generation: c.provenance?.generation ?? 1,
    superseded_by: c.provenance?.superseded_by ?? null }));
  return { active, next: plan.next, redirect: plan.redirect ?? null, ranked, pending, findings, provenance };
}

const impactLine = (i) => `blast ${i.blast} | epicPull ${i.epicPull} | blocks ${i.blocks} | ${i.freshness}`;

/** The §13.9 legibility render. hints: optional runId → resume-command map (adapter knowledge, injected). */
export function renderSurface(surface, { hints = {} } = {}) {
  const L = [];
  L.push('## ACTIVE');
  L.push(surface.active.item ? `- ${surface.active.item.id} (${surface.active.item.type ?? 'item'})` : '- (none)');
  for (const e of surface.active.epics) L.push(`- ${e} (epic)`);
  L.push('', '## NEXT');
  L.push(surface.redirect ? `- redirect → ${surface.redirect.kind}: ${surface.redirect.id}`
    : `- ${surface.next ?? '(queue empty — promote at the boundary review)'}`);
  L.push('', '## QUEUE');
  if (!surface.ranked.length) L.push('- (empty)');
  for (const r of surface.ranked) L.push(`- ${r.rank ?? '·'}. ${r.id}${r.epic ? ` [epic ${r.epic}]` : ''} — ${impactLine(r.impact)}`);
  L.push('', '## FLOOR-PENDING');
  if (!surface.pending.length) L.push('- (none)');
  for (const p of surface.pending) {
    L.push(`- ${p.runId} :: ${p.key} — ${p.decision?.question ?? ''}`);
    if (hints[p.runId]) L.push(`  resume: ${hints[p.runId]}`);
  }
  L.push('', '## OPEN FINDINGS');
  if (!surface.findings.length) L.push('- (none)');
  for (const f of surface.findings) {
    L.push(`- ${f.runId} :: ${f.key} — ${f.findings.length} finding(s)`);
    for (const x of f.findings) L.push(`  - ${x.check ? `[${x.check}] ` : ''}${x.detail ?? x.id ?? ''}`);
  }
  L.push('', '## ENFORCEMENT');
  if (!surface.provenance.length) L.push('- (no checks registered)');
  for (const c of surface.provenance) {
    L.push(`- ${c.id} (${c.status}, g${c.generation}) ← ${c.minted_by}${c.lesson ? ` (${c.lesson})` : ''}${c.superseded_by ? ` → superseded by ${c.superseded_by}` : ''}`);
  }
  return L.join('\n') + '\n';
}

/** The executor: dispatch a mutating op ONLY through the seam. Verbatim TaskResult passthrough —
 *  a paused result bubbles with its Decision (the caller renders/parks; NEVER auto-resolved here). */
export async function executeOp({ capabilities, op }) {
  if (op?.kind === 'procedure') return capabilities.runProcedure(op.name, op.args);
  if (op?.kind === 'task') return capabilities.execute(op.task);
  throw new Error(`executeOp: unknown op kind: ${String(op?.kind)} — mutations go through the capability seam (procedure | task)`);
}
