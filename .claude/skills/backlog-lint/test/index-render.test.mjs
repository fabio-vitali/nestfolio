import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIndex } from '../lib/index-render.mjs';

const file = (id, fm) => ({
  id, filename: `${id}.md`, path: `/dummy/${id}.md`,
  frontmatter: { id, type: 'bug', notes: '', ...fm }, body: '',
});

test('renderIndex includes all four sections in order', () => {
  const files = [
    file('act-x', { status: 'active', out_of_scope: ['y'], type: 'spec', notes: 'in flight' }),
    file('q-1', { status: 'queued', rank: 1, notes: 'next up' }),
    file('q-2', { status: 'queued', rank: 2, notes: 'after that' }),
    file('park-a', { status: 'parking', notes: 'someday' }),
    file('ship-1', { status: 'shipped', validation_gate: '5/5', notes: 'done', closed: '2026-05-06' }),
  ];
  const out = renderIndex(files);
  assert.match(out, /## ACTIVE/);
  assert.match(out, /## QUEUED/);
  assert.match(out, /## LATER/);
  assert.match(out, /## Recently Shipped/);
  // section order
  assert.ok(out.indexOf('## ACTIVE') < out.indexOf('## QUEUED'));
  assert.ok(out.indexOf('## QUEUED') < out.indexOf('## LATER'));
  assert.ok(out.indexOf('## LATER') < out.indexOf('## Recently Shipped'));
});

test('renderIndex links by id-relative path and includes notes one-liner', () => {
  const files = [
    file('act-x', { status: 'active', out_of_scope: ['y'], type: 'spec', notes: 'in flight' }),
  ];
  const out = renderIndex(files);
  assert.match(out, /\[act-x\]\(backlog\/act-x\.md\)/);
  assert.match(out, /in flight/);
  assert.match(out, /\[spec\]/);
});

test('renderIndex orders QUEUED by rank', () => {
  const files = [
    file('z', { status: 'active', out_of_scope: ['y'], notes: '' }),
    file('q-3', { status: 'queued', rank: 3, notes: 'third' }),
    file('q-1', { status: 'queued', rank: 1, notes: 'first' }),
    file('q-2', { status: 'queued', rank: 2, notes: 'second' }),
  ];
  const out = renderIndex(files);
  const queuedSection = out.split('## QUEUED')[1].split('## LATER')[0];
  assert.ok(queuedSection.indexOf('q-1') < queuedSection.indexOf('q-2'));
  assert.ok(queuedSection.indexOf('q-2') < queuedSection.indexOf('q-3'));
});

test('renderIndex caps Recently Shipped at 10', () => {
  const shipped = [];
  for (let i = 0; i < 15; i++) {
    shipped.push(file(`s-${i}`, { status: 'shipped', validation_gate: 'ok', notes: '' }));
  }
  const files = [file('a', { status: 'active', out_of_scope: ['y'], notes: '' }), ...shipped];
  const out = renderIndex(files);
  const section = out.split('## Recently Shipped')[1];
  const matches = section.match(/\[s-\d+\]/g) ?? [];
  assert.ok(matches.length <= 10, `expected ≤10, got ${matches.length}`);
});
