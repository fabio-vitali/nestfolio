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
