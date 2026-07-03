import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeJournal, inMemoryJournal, e2eIsFresh, isPaused, pendingDecisions, fulfilledChoices, askStep, PAUSE } from '../lib/journal.mjs';

const freshRoot = () => mkdtempSync(join(tmpdir(), 'jrnl-'));
const meta = (runId) => ({ runId, branch: 'feat/x', worktree: '.wt/x', auto: false });

test('A1: a keyed-effect step runs the effect once and records one complete line', async () => {
  const j = makeJournal({ root: freshRoot() });
  j.begin('item-a', meta('item-a'));
  let calls = 0;
  const v = await j.step('item-a', 'E1.promote', async () => { calls++; return 'sha1'; });
  assert.equal(v, 'sha1');
  assert.equal(calls, 1);
  assert.equal(j.read('item-a').steps.get('E1.promote').status, 'complete');
});

test('A2: resume replays a complete step — fn NOT invoked (no double-promote)', async () => {
  const root = freshRoot();
  const j1 = makeJournal({ root }); j1.begin('item-a', meta('item-a'));
  await j1.step('item-a', 'E1.promote', async () => 'sha1');
  const j2 = makeJournal({ root });                 // a fresh process/instance = resume
  let calls = 0;
  const v = await j2.step('item-a', 'E1.promote', async () => { calls++; return 'sha2'; });
  assert.equal(v, 'sha1');                          // recorded value returned
  assert.equal(calls, 0);                           // effect NOT re-run
});

test('A3: a pure-rederive step recomputes and is never ledgered', async () => {
  const j = makeJournal({ root: freshRoot() }); j.begin('item-a', meta('item-a'));
  let calls = 0;
  await j.step('item-a', 'select', async () => { calls++; return 'x'; }, 'pure-rederive');
  await j.step('item-a', 'select', async () => { calls++; return 'x'; }, 'pure-rederive');
  assert.equal(calls, 2);                           // recomputed each time
  assert.equal(j.read('item-a').steps.has('select'), false); // never written
});

test('A4: a torn final line is dropped; prior complete steps survive; no throw', async () => {
  const root = freshRoot(); const j = makeJournal({ root }); j.begin('item-a', meta('item-a'));
  await j.step('item-a', 'E1.promote', async () => 'sha1');
  const stepsFile = join(root, 'journal', 'item-a', 'steps.ndjson');
  writeFileSync(stepsFile, readFileSync(stepsFile, 'utf8') + '{ "key": "E2.torn", "sta');  // crash mid-append
  const ledger = j.read('item-a');                  // must not throw
  assert.equal(ledger.steps.get('E1.promote').value, 'sha1');
  assert.equal(ledger.steps.has('E2.torn'), false);
});

test('A5: a parked ask fulfilled by a Choice resumes with the recorded choice — no re-ask', async () => {
  const j = inMemoryJournal(); j.begin('item-a', meta('item-a'));
  const decision = { id: 'd', question: 'merge?', options: [{ label: 'Merge', value: 'merge', recommended: true }] };
  j.awaiting('item-a', 'ship.merge', decision);
  assert.equal(j.read('item-a').steps.get('ship.merge').status, 'awaiting');
  j.fulfil('item-a', 'ship.merge', { decisionId: 'd', value: 'merge' });
  let calls = 0;
  const v = await j.step('item-a', 'ship.merge', async () => { calls++; return 'x'; });
  assert.equal(v.value, 'merge');                   // the recorded choice
  assert.equal(calls, 0);                           // the human is NOT re-asked
});

test('A5b: a parked ask survives a process restart — awaiting→fulfil→step through the git-native NDJSON', async () => {
  const root = freshRoot();                         // durability is the load-bearing §4.3 guarantee — prove it on DISK, not in-memory
  const j1 = makeJournal({ root }); j1.begin('item-a', meta('item-a'));
  const decision = { id: 'd', question: 'merge?', options: [{ label: 'Merge', value: 'merge', recommended: true }] };
  j1.awaiting('item-a', 'ship.merge', decision);
  const j2 = makeJournal({ root });                 // fresh instance = process restart, reads NDJSON from disk
  j2.fulfil('item-a', 'ship.merge', { decisionId: 'd', value: 'merge' });
  const j3 = makeJournal({ root });                 // another restart — resume
  let calls = 0;
  const v = await j3.step('item-a', 'ship.merge', async () => { calls++; return 'x'; });
  assert.equal(v.value, 'merge');                   // recorded Choice survived NDJSON append + RecordedDecision validation
  assert.equal(calls, 0);                           // the human is NOT re-asked after a restart
});

test('A6: e2e freshness — a recorded e2e sha not matching HEAD is stale (forces return to E6)', () => {
  const j = inMemoryJournal(); j.begin('epic-b', meta('epic-b'));
  j.record('epic-b', 'e2e', { sha: 'abc', green: true });
  assert.equal(e2eIsFresh(j.read('epic-b'), 'abc'), true);
  assert.equal(e2eIsFresh(j.read('epic-b'), 'def'), false);
});

const DEC = { id: 'ship-x', question: 'Ship x?', options: [{ label: 'Ship', value: 'ship', recommended: true }, { label: 'Hold', value: 'hold' }] };
const PAUSED_RESULT = { taskId: 'x', status: 'paused', summary: 'parked', decision: { id: 'execute:x', question: 'Perform x', options: [{ label: 'Fulfil', value: 'fulfil', recommended: true }] } };

test('JP1 step parks a paused TaskResult: awaiting under the STEP key, no complete record', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  const v = await j.step('item-x', 'execute:x', async () => PAUSED_RESULT);
  assert.equal(v.status, 'paused');
  const rec = j.read('item-x').steps.get('execute:x');
  assert.equal(rec.status, 'awaiting');
  assert.equal(rec.decision.id, 'execute:x');
});
test('JP2 a parked step re-invokes fn on replay (not short-circuited)', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  let calls = 0;
  const fn = async () => { calls++; return PAUSED_RESULT; };
  await j.step('item-x', 'execute:x', fn); await j.step('item-x', 'execute:x', fn);
  assert.equal(calls, 2);
});
test('JP3 fulfil completes the parked key; replay short-circuits with the fulfilled value', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  await j.step('item-x', 'execute:x', async () => PAUSED_RESULT);
  j.fulfil('item-x', 'execute:x', { taskId: 'x', status: 'done', summary: 'performed by session' });
  let calls = 0;
  const v = await j.step('item-x', 'execute:x', async () => { calls++; return PAUSED_RESULT; });
  assert.equal(calls, 0); assert.equal(v.status, 'done');
});
test('JP4 pendingDecisions lists awaiting-only; fulfilment removes it', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  await j.step('item-x', 'execute:x', async () => PAUSED_RESULT);
  assert.equal(pendingDecisions(j.read('item-x')).length, 1);
  j.fulfil('item-x', 'execute:x', { taskId: 'x', status: 'done', summary: 'ok' });
  assert.equal(pendingDecisions(j.read('item-x')).length, 0);
});
test('JP5 fulfilledChoices returns Choice-shaped completions only', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  j.fulfil('item-x', 'ship-x', { decisionId: 'ship-x', value: 'ship' });
  j.record('item-x', 'gate.start', { passed: true, findings: [] });
  const cs = fulfilledChoices(j.read('item-x'));
  assert.equal(cs.length, 1); assert.equal(cs[0].value, 'ship');
});
test('JP6 askStep: PAUSE parks and returns null; fulfil then replay returns the Choice without re-asking', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  let asks = 0;
  const pausingAsk = async (d) => { asks++; return { decisionId: d.id, value: PAUSE }; };
  assert.equal(await askStep({ journal: j, runId: 'item-x', decision: DEC, ask: pausingAsk }), null);
  assert.equal(j.read('item-x').steps.get('ship-x').status, 'awaiting');
  j.fulfil('item-x', 'ship-x', { decisionId: 'ship-x', value: 'ship' });
  const c = await askStep({ journal: j, runId: 'item-x', decision: DEC, ask: pausingAsk });
  assert.equal(c.value, 'ship'); assert.equal(asks, 1);
});
test('JP7 askStep recordWhen: a non-terminal answer (hold) is NOT recorded complete — re-asked next wake', async () => {
  const j = inMemoryJournal(); j.begin('item-x', { runId: 'item-x', auto: false });
  let asks = 0;
  const holdAsk = async (d) => { asks++; return { decisionId: d.id, value: 'hold' }; };
  const rw = (c) => c.value === 'ship';
  const c1 = await askStep({ journal: j, runId: 'item-x', decision: DEC, ask: holdAsk, recordWhen: rw });
  assert.equal(c1.value, 'hold');
  assert.equal(j.read('item-x').steps.get('ship-x').status, 'awaiting');
  const c2 = await askStep({ journal: j, runId: 'item-x', decision: DEC, ask: holdAsk, recordWhen: rw });
  assert.equal(c2.value, 'hold'); assert.equal(asks, 2);
});
test('JP8 isPaused guards shape', () => {
  assert.equal(isPaused(PAUSED_RESULT), true);
  assert.equal(isPaused({ status: 'paused' }), false);
  assert.equal(isPaused({ status: 'done', summary: 'x' }), false);
});
