import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIndex, resolveShippedDate } from '../lib/index-render.mjs';

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

test('renderIndex shows EPICS block with rollup, and tags members in LATER', () => {
  const files = [
    file('e1', { type: 'epic', status: 'active', notes: 'cleanup',
      done_when: 'all core shipped', scope: 'tsc', out_of_scope: ['x'] }),
    file('m1', { status: 'shipped', epic: 'e1', epic_role: 'core', validation_gate: 'ok', notes: 'fix a' }),
    file('m2', { status: 'parking', epic: 'e1', epic_role: 'captured', notes: 'fix b' }),
    file('orphan', { status: 'parking', notes: 'lonely' }),
  ];
  const out = renderIndex(files);
  assert.match(out, /## EPICS/);
  assert.match(out, /\[e1\]\(backlog\/e1\.md\) `\[epic · active\]`/);
  assert.match(out, /done_when: all core shipped/);
  assert.match(out, /rollup: core 1\/1 done · captured 0\/1 done/);
  // health line: e1 is active (not a parking theme epic) → 0 theme epics, 1 orphan
  assert.match(out, /Parking health:\*\* 0 theme epic\(s\), 1 orphan\(s\)/);
  // captured member carries an epic tag in its LATER listing
  assert.match(out, /\[epic:e1 · captured\]/);
  // the epic file itself is NOT duplicated into ACTIVE (lives only in EPICS)
  const activeSection = out.split('## ACTIVE')[1].split('## QUEUED')[0];
  assert.ok(!activeSection.includes('(backlog/e1.md)'));
});

test('resolveShippedDate: explicit closed wins over dirty/git/today', () => {
  assert.equal(
    resolveShippedDate({ closed: '2026-01-01', dirty: true, gitDate: '2026-02-02', today: '2026-03-03' }),
    '2026-01-01',
  );
});

// The settle-fix invariant: a dirty file (ship being committed now) resolves to today,
// NOT its stale last-commit date — so --fix yields the same date before & after commit.
test('resolveShippedDate: dirty file resolves to today, ignoring stale git date', () => {
  assert.equal(
    resolveShippedDate({ closed: undefined, dirty: true, gitDate: '2026-06-19', today: '2026-06-20' }),
    '2026-06-20',
  );
});

test('resolveShippedDate: clean file uses its last-commit date', () => {
  assert.equal(
    resolveShippedDate({ closed: undefined, dirty: false, gitDate: '2026-06-19', today: '2026-06-20' }),
    '2026-06-19',
  );
});

test('resolveShippedDate: clean file with no git history falls back to sentinel', () => {
  assert.equal(
    resolveShippedDate({ closed: undefined, dirty: false, gitDate: null, today: '2026-06-20' }),
    '0000-00-00',
  );
});

test('renderIndex counts parking theme epics and orphans in health line', () => {
  const files = [
    file('theme', { type: 'epic', status: 'parking', notes: 'bucket' }),
    file('member', { status: 'parking', epic: 'theme', epic_role: 'core', notes: '' }),
    file('orphan', { status: 'parking', notes: '' }),
  ];
  const out = renderIndex(files);
  // 1 parking theme epic; orphan count excludes the member that belongs to the theme
  assert.match(out, /Parking health:\*\* 1 theme epic\(s\), 1 orphan\(s\)/);
});
