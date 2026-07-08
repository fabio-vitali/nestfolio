// runtime/engine/test/operational-surface.test.mjs — §14 Option B ring-1 core: deriveSurface
// (read-time derivation, stores nothing), renderSurface (legibility law §13.9), executeOp (every
// mutation through the capability seam). OS1–OS6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSurface, renderSurface, executeOp } from '../lib/operational-surface.mjs';
import { inMemoryJournal } from '../lib/journal.mjs';

const BACKLOG = [
  { id: 'a1', status: 'active', type: 'fix', epic: 'e1', epic_role: 'core', scope: 'src/a.mjs' },
  { id: 'q1', status: 'queued', rank: 1, type: 'bug', references: ['docs/x.md#s'] },
  { id: 'q2', status: 'queued', rank: 2, type: 'tooling', epic: 'e1', epic_role: 'core' },
  { id: 'p1', status: 'parking', type: 'refactor', references: ['docs/backlog/q1.md'] },
  { id: 'e1', status: 'parking', type: 'epic' },
  { id: 's1', status: 'shipped', type: 'fix' },
];

const REGISTRY = { checks: [
  { id: 'c1', status: 'active', provenance: { minted_by: 'starter-pack' } },
  { id: 'c2', status: 'superseded', provenance: { minted_by: 'lesson-x', lesson: 'docs/lessons/x.md', generation: 2, superseded_by: 'c3' } },
], byId: new Map(), errors: [] };

function seededJournal() {
  const journal = inMemoryJournal();
  journal.begin('item-a1', { runId: 'item-a1', auto: false });
  journal.awaiting('item-a1', 'execute:a1', { id: 'execute:a1', question: 'Perform a1', options: [{ label: 'Fulfil', value: 'fulfil', recommended: true }] });
  // findings evidence: a first red gate superseded by a green one (NOT open), and a red ship gate (open)
  journal.record('item-a1', 'gate.start', { passed: false, findings: [{ id: 'f0', detail: 'stale' }] });
  journal.record('item-a1', 'gate.start', { passed: true, findings: [] });
  journal.record('item-a1', 'gate.ship', { passed: false, findings: [{ id: 'f1', check: 'c1', detail: 'broken prop' }] });
  journal.begin('epic-e1', { runId: 'epic-e1', auto: false });
  journal.awaiting('epic-e1', 'ship-e1', { id: 'ship-e1', question: 'Ship?', options: [{ label: 'Ship', value: 'ship', recommended: true }] });
  journal.fulfil('epic-e1', 'ship-e1', { decisionId: 'ship-e1', value: 'ship' });   // fulfilled → NOT pending
  return journal;
}

const surface = () => deriveSurface({
  backlog: BACKLOG, registry: REGISTRY, journal: seededJournal(), runIds: ['item-a1', 'epic-e1', 'item-ghost'],
  blastOf: (globs) => globs.length, refResolves: (p) => !p.startsWith('docs/x.md'),   // refPath keeps the "#anchor" suffix on string refs
});

test('OS1 active + ranked queue with read-time impact (blast/epicPull/freshness/blocks)', () => {
  const s = surface();
  assert.equal(s.active.item.id, 'a1');
  assert.deepEqual(s.active.epics, []);
  assert.equal(s.next, 'a1');                       // planNext resumes the single active
  assert.deepEqual(s.ranked.map((r) => r.id), ['q1', 'q2']);
  const q1 = s.ranked.find((r) => r.id === 'q1');
  assert.equal(q1.impact.freshness, 'stale');        // docs/x.md does not resolve
  assert.equal(q1.impact.blocks, 1);                 // p1 references docs/backlog/q1.md
  const q2 = s.ranked.find((r) => r.id === 'q2');
  assert.equal(q2.impact.epicPull, 1);               // a1 is the other OPEN core member of e1
  assert.equal(q2.impact.freshness, 'fresh');
});

test('OS2 floor-pending decisions across ledgers: awaiting surfaces, fulfilled does not, missing runId skipped', () => {
  const s = surface();
  assert.deepEqual(s.pending.map((p) => [p.runId, p.key]), [['item-a1', 'execute:a1']]);
  assert.equal(s.pending[0].decision.question, 'Perform a1');
});

test('OS3 open findings from ledger evidence: last-write-wins per key, empty-findings records excluded', () => {
  const s = surface();
  assert.deepEqual(s.findings.map((f) => [f.runId, f.key]), [['item-a1', 'gate.ship']]);
  assert.equal(s.findings[0].findings[0].id, 'f1');
});

test('OS4 enforcement provenance rows from the registry (which lesson minted which check)', () => {
  const s = surface();
  const c2 = s.provenance.find((c) => c.id === 'c2');
  assert.deepEqual(c2, { id: 'c2', status: 'superseded', minted_by: 'lesson-x', lesson: 'docs/lessons/x.md', ratified: null, generation: 2, superseded_by: 'c3' });
  const c1 = s.provenance.find((c) => c.id === 'c1');
  assert.equal(c1.generation, 1);                    // absent generation defaults to 1 (§2.4)
});

test('OS5 renderSurface: the §13.9 legibility sections, pending rows with resume hints, enforcement arrows', () => {
  const out = renderSurface(surface(), { hints: { 'item-a1': 'node run-next.mjs a1 --fulfil <key> --value <json>' } });
  for (const section of ['## ACTIVE', '## NEXT', '## QUEUE', '## FLOOR-PENDING', '## OPEN FINDINGS', '## ENFORCEMENT']) {
    assert.ok(out.includes(section), `missing section ${section}`);
  }
  assert.match(out, /item-a1 :: execute:a1 — Perform a1/);
  assert.match(out, /resume: node run-next\.mjs a1/);
  assert.match(out, /q1 .*stale/);
  assert.match(out, /c2 \(superseded, g2\) ← lesson-x \(docs\/lessons\/x\.md\)/);
});

test('OS6 executeOp dispatches ONLY through the seam: procedure→runProcedure, task→execute, verbatim passthrough', async () => {
  const calls = [];
  const capabilities = {
    runProcedure: async (name, args) => { calls.push(['procedure', name, args]); return { taskId: name, status: 'done', summary: 'ok' }; },
    execute: async (task) => { calls.push(['task', task.id]); return { taskId: task.id, status: 'paused', summary: 'parked', decision: { id: 'd1', question: 'q', options: [] } }; },
  };
  const r1 = await executeOp({ capabilities, op: { kind: 'procedure', name: 'audit-service', args: { svc: 'x' } } });
  assert.equal(r1.status, 'done');
  const r2 = await executeOp({ capabilities, op: { kind: 'task', task: { id: 't1', prompt: 'p', scope: [] } } });
  assert.equal(r2.status, 'paused');
  assert.equal(r2.decision.id, 'd1');                // paused bubbles with its Decision — never auto-resolved here
  assert.deepEqual(calls.map((c) => c[0]), ['procedure', 'task']);
  await assert.rejects(() => executeOp({ capabilities, op: { kind: 'merge' } }), /unknown op kind/);
});
