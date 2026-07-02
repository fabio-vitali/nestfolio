import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeJournal, inMemoryJournal, e2eIsFresh } from '../lib/journal.mjs';

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
