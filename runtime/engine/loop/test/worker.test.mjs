import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runWorker } from '../worker.mjs';
import { inMemoryJournal } from '../../lib/journal.mjs';
import { setGateGetter } from './fixtures/dynamic-gate.mjs';

const DYNAMIC_GATE_MODULE = fileURLToPath(new URL('./fixtures/dynamic-gate.mjs', import.meta.url));
const ITEM = { id: 'i1', scope: 'a/**' };

function fakeCaps(overrides = {}) {
  const calls = [];
  return { calls, journal: inMemoryJournal(),
    execute: async (t) => { calls.push(['execute', t.id]); return { taskId: t.id, status: 'done', summary: 'did it' }; },
    // default ask answers whatever option is recommended — untouched cases still ship/fulfil without wiring a bespoke ask.
    ask: async (d) => { calls.push(['ask', d.id]); return { decisionId: d.id, value: d.options.find((o) => o.recommended)?.value ?? d.options[0].value }; },
    fanOut: async () => { calls.push(['fanOut']); return []; },
    runProcedure: undefined,
    ...overrides };
}
function emptyRegistry() { return { checks: [], byId: new Map(), errors: [] }; }

// A registry with one 'gate' check whose findings come from calling `getter()` at EVERY runGate — via the
// module: scheme (the only evaluator that can run injected JS), never snapshotted at construction time.
function fakeRegistryWithGate(getter) {
  setGateGetter(getter);
  const check = { id: 'g', property: 'p', kind: 'drift', cost_tier: 'cheap', contexts: ['gate'], status: 'active',
    scope: { paths: ['**/*'] }, evaluator: { type: 'deterministic', run: `module:${DYNAMIC_GATE_MODULE}#check` },
    provenance: { minted_by: 'test' } };
  return { checks: [check], byId: new Map([[check.id, check]]), errors: [] };
}

test('worker drives execute then asks to ship — never auto-merges, uses journal', async () => {
  const caps = fakeCaps();
  const r = await runWorker({ item: ITEM, capabilities: caps, registry: emptyRegistry() });
  assert.equal(r.status, 'done');
  assert.deepEqual(caps.calls, [['execute', ITEM.id], ['ask', `ship-${ITEM.id}`]]);   // execute → ask, no fanOut
  assert.ok(caps.journal.read(`item-${ITEM.id}`));                                    // journal began
});

test('a paused execute (carrying a decision) short-circuits to paused — the floor bubbles up', async () => {
  const decision = { id: `execute:${ITEM.id}`, question: 'do it', options: [{ label: 'Fulfil', value: 'fulfil', recommended: true }] };
  const caps = fakeCaps({ execute: async (t) => ({ taskId: t.id, status: 'paused', summary: 'parked', decision }) });
  const r = await runWorker({ item: ITEM, capabilities: caps, registry: emptyRegistry() });
  assert.equal(r.status, 'paused');
  assert.equal(r.decision.id, decision.id);
});

// W-A failed gate re-runs after the tree is fixed (the replay-forever regression)
test('W-A a failed start gate is NOT journaled as an effect — a re-run re-verifies', async () => {
  let gateFindings = [{ id: 'g#0', check: 'g', kind: 'drift', scope: [], detail: 'bad', raised_at: 'now' }];
  const registry = fakeRegistryWithGate(() => gateFindings);
  const caps = fakeCaps({ journal: inMemoryJournal() });
  const r1 = await runWorker({ item: ITEM, capabilities: caps, registry });
  assert.equal(r1.status, 'failed');
  gateFindings = [];                                            // the tree is fixed
  const r2 = await runWorker({ item: ITEM, capabilities: caps, registry });
  assert.notEqual(r2.status, 'failed');                         // gate re-ran and passed
});

// W-B paused execute parks; fulfil resumes with the recorded TaskResult
test('W-B paused execute parks under execute:<id>; fulfil + re-run reaches the ship gate', async () => {
  const j = inMemoryJournal();
  const caps = fakeCaps({ journal: j, execute: async (t) => ({ taskId: t.id, status: 'paused', summary: 'parked', decision: { id: `execute:${t.id}`, question: 'do it', options: [{ label: 'Fulfil', value: 'fulfil', recommended: true }] } }) });
  const r1 = await runWorker({ item: ITEM, capabilities: caps, registry: emptyRegistry() });
  assert.equal(r1.status, 'paused'); assert.equal(r1.decision.id, `execute:${ITEM.id}`);
  j.fulfil(`item-${ITEM.id}`, `execute:${ITEM.id}`, { taskId: ITEM.id, status: 'done', summary: 'session did it' });
  const r2 = await runWorker({ item: ITEM, capabilities: caps, registry: emptyRegistry() });
  assert.notEqual(r2.status, 'paused');                         // execute replayed complete; flow advanced
});

// W-C ship honesty: sentinel parks, hold defers, ship completes
test('W-C ship=paused on sentinel; hold re-asks next run; ship → done', async () => {
  const j = inMemoryJournal();
  const answers = ['hold', 'ship']; let i = 0;
  const caps = fakeCaps({ journal: j, ask: async (d) => ({ decisionId: d.id, value: answers[i++] }) });
  const r1 = await runWorker({ item: ITEM, capabilities: caps, registry: emptyRegistry() });
  assert.equal(r1.status, 'paused');                            // hold = defer
  const r2 = await runWorker({ item: ITEM, capabilities: caps, registry: emptyRegistry() });
  assert.equal(r2.status, 'done');                              // re-asked, shipped
});

// W-D choices thread into the Task; locus feeds RunMeta
test('W-D fulfilled choices reach Task.choices; locus lands in RunMeta', async () => {
  const j = inMemoryJournal(); const seen = [];
  // NOTE: no manual j.begin() here — journal.begin is idempotent (existing run → NOOP, Task 2 §5), so
  // pre-seeding meta would make runWorker's own begin(...) a no-op and the locus-in-meta assertion below
  // vacuous. fulfil() appends a step line without requiring meta to exist yet; runWorker's begin (the
  // first for this runId) is what actually writes branch into RunMeta — that's the behavior under test.
  j.fulfil('item-i1', 'mid-task-q', { decisionId: 'mid-task-q', value: 'optionA' });
  const caps = fakeCaps({ journal: j, execute: async (t) => { seen.push(t); return { taskId: t.id, status: 'done', summary: 'ok' }; } });
  await runWorker({ item: ITEM, capabilities: caps, registry: emptyRegistry(), locus: { branch: 'feat/x' } });
  assert.equal(seen[0].choices.find((c) => c.decisionId === 'mid-task-q').value, 'optionA');
  assert.equal(seen[0].locus.branch, 'feat/x');
  assert.equal(j.read('item-i1').meta.branch, 'feat/x');
});
