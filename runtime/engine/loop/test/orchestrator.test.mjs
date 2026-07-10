import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOrchestrator } from '../orchestrator.mjs';
import { inMemoryJournal, PAUSE } from '../../lib/journal.mjs';

const EPIC = { id: 'e' };
const MEMBERS = [
  { id: 'm1', epic_role: 'core', scope: 'a/**' },
  { id: 'm2', epic_role: 'core', scope: 'b/**' },
  { id: 'cap', epic_role: 'captured' },
];

function fakeCaps(overrides = {}) {
  const calls = [];
  return { calls, journal: inMemoryJournal(),
    execute: async (t) => { calls.push(['execute', t.id]); return { taskId: t.id, status: 'done', summary: 'ok' }; },
    // default ask answers whatever option is recommended — untouched cases still merge without wiring a bespoke ask.
    ask: async (d) => { calls.push(['ask', d.id]); return { decisionId: d.id, value: d.options.find((o) => o.recommended)?.value ?? d.options[0].value }; },
    fanOut: async (tasks) => { calls.push(['fanOut']); return tasks.map((t) => ({ taskId: t.id, status: 'done', summary: 's' })); },
    runProcedure: undefined,
    ...overrides };
}
function emptyRegistry() { return { checks: [], byId: new Map(), errors: [] }; }
// two always-failing GATE/AUDIT checks (NOT invariants — invariants bypass scoping) in disjoint scopes,
// so a narrow changedScope selects exactly one and the whole-repo fallback selects both.
function scopedRegistry() {
  const check = (id, ctx, path) => ({ id, property: 'p', kind: 'gap', cost_tier: 'expensive', contexts: [ctx],
    status: 'active', scope: { paths: [path] }, evaluator: { type: 'deterministic', run: 'cmd:false' }, provenance: { minted_by: 'x' } });
  return { checks: [check('A-runtime', 'audit', 'runtime/**'), check('B-services', 'gate', 'services/**')], byId: new Map(), errors: [] };
}

test('orchestrator drives CORE members inline via execute (never fanOut) and asks to merge once', async () => {
  const caps = fakeCaps();
  const r = await runOrchestrator({ epic: EPIC, members: MEMBERS, capabilities: caps, registry: emptyRegistry(), headSha: 'sha1' });
  assert.equal(r.status, 'done');
  const executes = caps.calls.filter((c) => c[0] === 'execute').map((c) => c[1]);
  assert.deepEqual(executes, ['m1', 'm2']);                         // both core, in order; captured excluded
  assert.equal(caps.calls.some((c) => c[0] === 'fanOut'), false);    // the member loop is NOT fanned out
  assert.equal(caps.calls.filter((c) => c[0] === 'ask').length, 1);  // one merge ask
});

test('epic-pre-done is sha-conditional — a FRESH recorded e2e is REPLAYED, not re-run', async () => {
  const caps = fakeCaps();
  caps.journal.begin(`epic-${EPIC.id}`, { runId: `epic-${EPIC.id}`, auto: false });
  caps.journal.record(`epic-${EPIC.id}`, 'e2e', { sha: 'sha1', green: false, findings: [{ id: 'recorded#0', check: 'x', kind: 'gap', detail: 'd', raised_at: 't' }] });
  const r = await runOrchestrator({ epic: EPIC, members: [], capabilities: caps, registry: emptyRegistry(), headSha: 'sha1' });
  assert.equal(r.status, 'failed');                    // replayed the recorded finding (fresh vs HEAD) — did NOT re-run to []
  assert.equal(r.findings[0].id, 'recorded#0');
});

test('epic-pre-done RE-RUNS when the recorded e2e sha is STALE (HEAD moved)', async () => {
  const caps = fakeCaps();
  caps.journal.begin(`epic-${EPIC.id}`, { runId: `epic-${EPIC.id}`, auto: false });
  caps.journal.record(`epic-${EPIC.id}`, 'e2e', { sha: 'sha1', green: false, findings: [{ id: 'stale#0', check: 'x', kind: 'gap', detail: 'd', raised_at: 't' }] });
  const r = await runOrchestrator({ epic: EPIC, members: [], capabilities: caps, registry: emptyRegistry(), headSha: 'sha2' });   // HEAD advanced past the recorded sha1
  assert.equal(r.status, 'done');                      // did NOT replay the stale finding; re-ran (empty registry → []) → merge ask
});

// O-A THE WEDGE REGRESSION (red-team scenario A): paused member parks; fulfil resumes the epic
test('O-A paused member parks under member.<id>; fulfil + re-run completes the epic', async () => {
  const j = inMemoryJournal();
  let m2Paused = true;
  const caps = fakeCaps({ journal: j, execute: async (t) => (t.id === 'm2' && m2Paused)
    ? { taskId: t.id, status: 'paused', summary: 'floor act', decision: { id: `execute:${t.id}`, question: 'q', options: [{ label: 'F', value: 'f', recommended: true }] } }
    : { taskId: t.id, status: 'done', summary: 'ok' } });
  const r1 = await runOrchestrator({ epic: EPIC, members: MEMBERS, capabilities: caps, registry: emptyRegistry(), headSha: 'sha1' });
  assert.equal(r1.status, 'paused'); assert.equal(r1.decision.id, 'execute:m2');
  assert.equal(j.read(`epic-${EPIC.id}`).steps.get('member.m2').status, 'awaiting');
  j.fulfil(`epic-${EPIC.id}`, 'member.m2', { taskId: 'm2', status: 'done', summary: 'answered + done' });
  m2Paused = false;
  const r2 = await runOrchestrator({ epic: EPIC, members: MEMBERS, capabilities: caps, registry: emptyRegistry(), headSha: 'sha1' });
  assert.equal(r2.status, 'done');
});

// O-B no 'done' on an unanswered merge
test('O-B merge PAUSE sentinel ⇒ epic result is paused, not done', async () => {
  const caps = fakeCaps({ journal: inMemoryJournal(), ask: async (d) => ({ decisionId: d.id, value: PAUSE }) });
  const r = await runOrchestrator({ epic: EPIC, members: MEMBERS, capabilities: caps, registry: emptyRegistry(), headSha: 'sha1' });
  assert.equal(r.status, 'paused'); assert.equal(r.decision.id, `merge-${EPIC.id}`);
});

// O-C gitHeadSha is NOT read from capabilities
test('O-C headSha comes from the param (capabilities carries no gitHeadSha)', async () => {
  const caps = fakeCaps({ journal: inMemoryJournal() });
  assert.equal('gitHeadSha' in caps, false);
  const r = await runOrchestrator({ epic: EPIC, members: MEMBERS, capabilities: caps, registry: emptyRegistry(), headSha: 'sha-abc' });
  assert.equal(r.status, 'done');
});

// O-D the epic-pre-done batch is SCOPED to the injected branch delta (the fix) — NOT the whole repo
test('O-D epic-pre-done is scoped to changedScope: a check outside the branch delta is not selected', async () => {
  const caps = fakeCaps();
  const r = await runOrchestrator({ epic: EPIC, members: [], capabilities: caps, registry: scopedRegistry(),
    headSha: 'sha1', changedScope: ['runtime/engine/loop/orchestrator.mjs'] });
  assert.equal(r.status, 'failed');
  assert.equal(r.findings.length, 1);              // only the runtime-scoped check ran…
  assert.equal(r.findings[0].check, 'A-runtime');   // …the services-scoped check was OUT of the delta
});

// O-E fail-broad: an absent/empty delta must NOT silently under-scope a ship gate
test('O-E absent/empty changedScope falls back to the whole repo (both checks run)', async () => {
  const noDelta = await runOrchestrator({ epic: EPIC, members: [], capabilities: fakeCaps(), registry: scopedRegistry(), headSha: 'sha1' });
  assert.equal(noDelta.findings.length, 2);        // undefined ⇒ ['**/*'] ⇒ both selected
  const emptyDelta = await runOrchestrator({ epic: EPIC, members: [], capabilities: fakeCaps(), registry: scopedRegistry(), headSha: 'sha1', changedScope: [] });
  assert.equal(emptyDelta.findings.length, 2);     // [] ⇒ ['**/*'] too (git-failure/no-diff never narrows)
});
