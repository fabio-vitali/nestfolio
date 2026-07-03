import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClaudeCodeCapabilities } from '../index.mjs';
import { PAUSE } from '../../../engine/backward/lib/capabilities.mjs';

test('ask degrades to a PAUSE-valued Choice when no interactive binding is present (headless)', async () => {
  const caps = makeClaudeCodeCapabilities({});
  const choice = await caps.ask({ id: 'd', question: 'q?', options: [{ label: 'A', value: 'a', recommended: true }] });
  assert.deepEqual(choice, { decisionId: 'd', value: PAUSE });
});

test('ask uses the interactive binding when present', async () => {
  const caps = makeClaudeCodeCapabilities({ interactive: async (d) => ({ decisionId: d.id, value: 'a' }) });
  assert.equal((await caps.ask({ id: 'd', question: 'q', options: [{ label: 'A', value: 'a', recommended: true }] })).value, 'a');
});

test('fanOut returns SUMMARIES ONLY — a transcript field never survives the boundary', async () => {
  const caps = makeClaudeCodeCapabilities({ runTask: async (t) => ({ taskId: t.id, status: 'done', summary: 's', transcript: 'LEAK' }) });
  const [s] = await caps.fanOut([{ id: 't1', prompt: 'p', scope: [] }]);
  assert.deepEqual(Object.keys(s).sort(), ['status', 'summary', 'taskId']);   // no 'transcript'
});

test('journal is the git-native ring-1 journal (has begin/step/read)', () => {
  const caps = makeClaudeCodeCapabilities({});
  assert.equal(typeof caps.journal.begin, 'function');
  assert.equal(typeof caps.journal.step, 'function');
});

test('AD-A no-runner execute PARKS (paused + Task-shaped decision keyed execute:<id>) — never lies done', async () => {
  const { execute } = makeClaudeCodeCapabilities({});
  const r = await execute({ id: 't1', prompt: 'do t1', scope: [] });
  assert.equal(r.status, 'paused');
  assert.equal(r.decision.id, 'execute:t1');
  assert.equal(r.decision.options.filter((o) => o.recommended).length, 1);
});

test('AD-B fanOut bubbles findings and paused decisions in the Summary (still transcript-free)', async () => {
  const { fanOut } = makeClaudeCodeCapabilities({ runTask: async (t) => t.id === 'a'
    ? { taskId: 'a', status: 'done', summary: 'ok', findings: [{ id: 'f', check: 'c', kind: 'drift', scope: [], detail: 'd', raised_at: 'now' }], transcript: 'SHOULD BE STRIPPED' }
    : { taskId: 'b', status: 'paused', summary: 'hit a decision', decision: { id: 'q1', question: 'q', options: [{ label: 'x', value: 'x', recommended: true }] } } });
  const [a, b] = await fanOut([{ id: 'a' }, { id: 'b' }]);
  assert.equal(a.findings.length, 1); assert.equal('transcript' in a, false);
  assert.equal(b.status, 'paused'); assert.equal(b.decision.id, 'q1');
});
