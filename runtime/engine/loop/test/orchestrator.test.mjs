import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOrchestrator } from '../orchestrator.mjs';
import { inMemoryJournal } from '../../lib/journal.mjs';

function spyCaps() {
  const calls = [];
  return { calls, journal: inMemoryJournal(),
    execute: async (t) => { calls.push(['execute', t.id]); return { taskId: t.id, status: 'done', summary: 'ok' }; },
    fanOut: async (tasks) => { calls.push(['fanOut', tasks.length]); return tasks.map((t) => ({ taskId: t.id, status: 'done', summary: 's' })); },
    ask: async (d) => { calls.push(['ask', d.id]); return { decisionId: d.id, value: 'merge' }; } };
}
const registry = { checks: [], byId: new Map(), errors: [] };

test('orchestrator drives CORE members inline via execute (never fanOut) and asks to merge once', async () => {
  const caps = spyCaps();
  const members = [{ id: 'm1', epic_role: 'core', scope: 'a/**' }, { id: 'm2', epic_role: 'core', scope: 'b/**' }, { id: 'cap', epic_role: 'captured' }];
  const r = await runOrchestrator({ epic: { id: 'e' }, members, capabilities: caps, registry });
  assert.equal(r.status, 'done');
  const executes = caps.calls.filter((c) => c[0] === 'execute').map((c) => c[1]);
  assert.deepEqual(executes, ['m1', 'm2']);                         // both core, in order; captured excluded
  assert.equal(caps.calls.some((c) => c[0] === 'fanOut'), false);    // the member loop is NOT fanned out
  assert.equal(caps.calls.filter((c) => c[0] === 'ask').length, 1);  // one merge ask
});

test('epic-pre-done is sha-conditional — a FRESH recorded e2e is REPLAYED, not re-run', async () => {
  const caps = spyCaps(); caps.gitHeadSha = () => 'sha1';
  caps.journal.begin('epic-e', { runId: 'epic-e', branch: 'b', worktree: 'w', auto: false });
  caps.journal.record('epic-e', 'e2e', { sha: 'sha1', green: false, findings: [{ id: 'recorded#0', check: 'x', kind: 'gap', detail: 'd', raised_at: 't' }] });
  const r = await runOrchestrator({ epic: { id: 'e' }, members: [], capabilities: caps, registry });
  assert.equal(r.status, 'failed');                    // replayed the recorded finding (fresh vs HEAD) — did NOT re-run to []
  assert.equal(r.findings[0].id, 'recorded#0');
});

test('epic-pre-done RE-RUNS when the recorded e2e sha is STALE (HEAD moved)', async () => {
  const caps = spyCaps(); caps.gitHeadSha = () => 'sha2';   // HEAD advanced past the recorded sha1
  caps.journal.begin('epic-e', { runId: 'epic-e', branch: 'b', worktree: 'w', auto: false });
  caps.journal.record('epic-e', 'e2e', { sha: 'sha1', green: false, findings: [{ id: 'stale#0', check: 'x', kind: 'gap', detail: 'd', raised_at: 't' }] });
  const r = await runOrchestrator({ epic: { id: 'e' }, members: [], capabilities: caps, registry });
  assert.equal(r.status, 'done');                      // did NOT replay the stale finding; re-ran (empty registry → []) → merge ask
});
