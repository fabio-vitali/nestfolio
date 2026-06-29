import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIndex, resolveShippedDate } from '../lib/index-render.mjs';

const file = (id, fm) => ({
  id, filename: `${id}.md`, path: `/dummy/${id}.md`,
  frontmatter: { id, type: 'bug', notes: '', ...fm }, body: '',
});

// Hermetic git stub — injected so renderIndex never shells out to real git during tests
// (previously a per-fixture `git log -- /dummy/...` spewed `fatal: Invalid path`). F-31.
const NO_GIT = { dirty: new Set(), dateMap: new Map() };

test('renderIndex includes all four sections in order', () => {
  const files = [
    file('act-x', { status: 'active', out_of_scope: ['y'], type: 'spec', notes: 'in flight' }),
    file('q-1', { status: 'queued', rank: 1, notes: 'next up' }),
    file('q-2', { status: 'queued', rank: 2, notes: 'after that' }),
    file('park-a', { status: 'parking', notes: 'someday' }),
    file('ship-1', { status: 'shipped', validation_gate: '5/5', notes: 'done', closed: '2026-05-06' }),
  ];
  const out = renderIndex(files, NO_GIT);
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
  const out = renderIndex(files, NO_GIT);
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
  const out = renderIndex(files, NO_GIT);
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
  const out = renderIndex(files, NO_GIT);
  const section = out.split('## Recently Shipped')[1];
  const matches = section.match(/\[s-\d+\]/g) ?? [];
  assert.ok(matches.length <= 10, `expected ≤10, got ${matches.length}`);
});

test('renderIndex shows EPICS rollup; ACTIVE-epic members are NOT duplicated into flat sections', () => {
  const files = [
    file('e1', { type: 'epic', status: 'active', notes: 'cleanup',
      done_when: 'all core shipped', scope: 'tsc', out_of_scope: ['x'] }),
    file('m1', { status: 'shipped', epic: 'e1', epic_role: 'core', validation_gate: 'ok', notes: 'fix a' }),
    file('m2', { status: 'parking', epic: 'e1', epic_role: 'captured', notes: 'fix b' }),
    file('q-mem', { status: 'queued', rank: 1, epic: 'e1', epic_role: 'core', notes: 'fix c' }),
    file('orphan', { status: 'parking', notes: 'lonely' }),
  ];
  const out = renderIndex(files, NO_GIT);
  assert.match(out, /## EPICS/);
  assert.match(out, /\[e1\]\(backlog\/e1\.md\) `\[epic · active\]`/);
  assert.match(out, /done_when: all core shipped/);
  assert.match(out, /rollup: core 1\/2 done · captured 0\/1 done/);
  // health line: e1 is active (not a parking theme epic) → 0 theme epics, 1 orphan
  assert.match(out, /Parking health:\*\* 0 theme epic\(s\), 1 orphan\(s\)/);
  // members of the ACTIVE epic appear in the rollup...
  assert.match(out, /- captured · parking · \[m2\]\(backlog\/m2\.md\)/);
  assert.match(out, /- core · queued · \[q-mem\]\(backlog\/q-mem\.md\)/);
  // ...and are NOT duplicated into the flat QUEUED/LATER sections (orchestrated by
  // /backlog-next-epic; must not be picked standalone by /backlog-next).
  const queuedSection = out.split('## QUEUED')[1].split('## LATER')[0];
  const laterSection = out.split('## LATER')[1].split('## Recently Shipped')[0];
  assert.ok(!queuedSection.includes('(backlog/q-mem.md)'), 'active-epic member must not appear flat in QUEUED');
  assert.ok(!laterSection.includes('(backlog/m2.md)'), 'active-epic member must not appear flat in LATER');
  // a true orphan still appears flat in LATER
  assert.ok(laterSection.includes('(backlog/orphan.md)'));
  // the epic file itself is NOT duplicated into ACTIVE (lives only in EPICS)
  const activeSection = out.split('## ACTIVE')[1].split('## QUEUED')[0];
  assert.ok(!activeSection.includes('(backlog/e1.md)'));
});

test('renderIndex hides epic-assigned PARKING members from LATER but keeps queued-epic members in QUEUED', () => {
  const files = [
    file('theme', { type: 'epic', status: 'parking', notes: 'bucket' }),
    file('tm-mem', { status: 'parking', epic: 'theme', epic_role: 'core', notes: 'theme member' }),
    file('qe', { type: 'epic', status: 'queued', rank: 1, notes: 'queued bucket' }),
    file('qe-mem', { status: 'queued', rank: 1, epic: 'qe', epic_role: 'core', notes: 'queued member' }),
    file('orphan', { status: 'parking', notes: 'lonely' }),
  ];
  const out = renderIndex(files, NO_GIT);
  const laterSection = out.split('## LATER')[1].split('## Recently Shipped')[0];
  const queuedSection = out.split('## QUEUED')[1].split('## LATER')[0];
  const epicsSection = out.split('## EPICS')[1].split('## ACTIVE')[0];
  // an epic-assigned PARKING member is NOT duplicated into the flat LATER list...
  assert.ok(!laterSection.includes('(backlog/tm-mem.md)'), 'epic-assigned parking member must not appear flat in LATER');
  // ...it appears only under its epic's rollup in EPICS.
  assert.ok(epicsSection.includes('(backlog/tm-mem.md)'), 'epic member must appear under its epic rollup');
  // a true orphan still appears flat in LATER.
  assert.ok(laterSection.includes('(backlog/orphan.md)'));
  // only the parking/LATER half is de-duplicated — queued-epic members still appear in QUEUED, tagged.
  assert.ok(queuedSection.includes('(backlog/qe-mem.md)'), 'queued-epic member still appears flat in QUEUED');
  assert.match(out, /\[epic:qe · core\]/);
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
  const out = renderIndex(files, NO_GIT);
  // 1 parking theme epic; orphan count excludes the member that belongs to the theme
  assert.match(out, /Parking health:\*\* 1 theme epic\(s\), 1 orphan\(s\)/);
  // no *-leftovers bucket present → no dissolution warning
  assert.ok(!out.includes('awaiting dissolution'), 'no leftovers warning when none present');
});

test('renderIndex flags parking *-leftovers buckets awaiting dissolution in the health line', () => {
  const files = [
    file('foo-leftovers', { type: 'epic', status: 'parking', notes: 'holding bucket' }),
    file('bar-leftovers', { type: 'epic', status: 'parking', notes: 'holding bucket' }),
    // a terminal leftovers bucket must NOT be counted (already dissolved)
    file('baz-leftovers', { type: 'epic', status: 'dropped', notes: 'dissolved' }),
    file('orphan', { status: 'parking', notes: '' }),
  ];
  const out = renderIndex(files, NO_GIT);
  // 2 parking leftovers buckets are flagged; the dropped one is excluded
  assert.match(out, /⚠ 2 `\*-leftovers` bucket\(s\) awaiting dissolution/);
});

test('renderIndex is total: a non-string notes (YAML list) does not crash the render', () => {
  const files = [
    file('a', { status: 'active', out_of_scope: ['y'], notes: '' }),
    // notes written as a list — e.g. a backlog-add one-liner starting with "-"
    file('park', { status: 'parking', notes: ['- accidental', '- list'] }),
  ];
  const out = renderIndex(files, NO_GIT);                  // must not throw
  assert.match(out, /## LATER/);
  assert.match(out, /\(backlog\/park\.md\)/);
});

test('renderIndex excludes a null-frontmatter (unparseable) record without throwing', () => {
  const files = [
    file('a', { status: 'active', out_of_scope: ['y'], notes: '' }),
    { id: 'broken', filename: 'broken.md', path: '/dummy/broken.md', frontmatter: null, body: '', parseError: 'boom' },
  ];
  const out = renderIndex(files, NO_GIT);                  // must not throw
  assert.ok(!out.includes('(backlog/broken.md)'), 'unparseable file must not appear in the index');
});

// Regression for the F-29/F-31 refactor: shipped dates come from the injected dateMap
// (one batched git pass), not a per-file git spawn — and injection makes it fully hermetic.
test('renderIndex resolves shipped dates from the injected gitInfo.dateMap', () => {
  const files = [
    file('a', { status: 'active', out_of_scope: ['y'], notes: '' }),
    file('ship-x', { status: 'shipped', validation_gate: 'ok', notes: 'done' }),
  ];
  const gitInfo = { dirty: new Set(), dateMap: new Map([['/dummy/ship-x.md', '2026-06-15']]) };
  const out = renderIndex(files, gitInfo);
  assert.match(out, /2026-06-15 — \[ship-x\]\(backlog\/ship-x\.md\)/);
});
