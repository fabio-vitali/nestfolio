import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntry, appendEntry, renderEntries, localDateStamp, SECTION_HEADING } from '../decision-log.mjs';

const ENTRY = {
  decision: 'label formatting approach',
  options: ['extract generic helper', 'inline per call site'],
  chosen: 'extract generic helper',
  rationale: 'reusable across the two future call sites; reusability breaks ties',
  rejected: 'inline duplicates the format rule',
};
const DOC = '---\nid: x\nstatus: active\n---\n\n# X\n\nBody text.\n';

test('validateEntry: closed schema — unknown keys and missing required fields rejected', () => {
  assert.throws(() => validateEntry({ ...ENTRY, member: 'x' }), /unknown entry key "member"/);
  assert.throws(() => validateEntry({ ...ENTRY, decision: '' }), /decision/);
  assert.throws(() => validateEntry({ ...ENTRY, options: [] }), /options/);
  const { rejected, ...noRejected } = ENTRY;
  assert.deepEqual(validateEntry(noRejected), noRejected); // rejected is optional
});

test('appendEntry: creates the section once, numbers entries D1, D2, appends at section end', () => {
  const one = appendEntry(DOC, ENTRY, '2026-07-04');
  assert.ok(one.includes(SECTION_HEADING));
  assert.ok(one.includes('### D1 — 2026-07-04'));
  const two = appendEntry(one, { ...ENTRY, decision: 'second fork' }, '2026-07-05');
  assert.ok(two.includes('### D2 — 2026-07-05'));
  assert.equal(two.split(SECTION_HEADING).length, 2); // section created exactly once
  assert.ok(two.indexOf('### D1') < two.indexOf('### D2'));
});

test('appendEntry is append-only: the prior document is a byte prefix of the new one (F-6)', () => {
  const one = appendEntry(DOC, ENTRY, '2026-07-04');
  const two = appendEntry(one, { ...ENTRY, decision: 'second fork' }, '2026-07-05');
  assert.ok(two.startsWith(one.trimEnd())); // never rewrites existing entries
});

test('appendEntry keeps the section self-contained when other ## sections follow it', () => {
  const withTail = appendEntry(DOC + '\n## Out of scope\n\n- tail\n', ENTRY, '2026-07-04');
  // new section is inserted before EOF; a second append lands INSIDE the section, not after the tail
  const two = appendEntry(withTail, { ...ENTRY, decision: 'second' }, '2026-07-04');
  assert.ok(two.indexOf('### D2') < two.indexOf('## Out of scope') || two.indexOf('## Out of scope') < two.indexOf(SECTION_HEADING));
});

test('localDateStamp: stamps the local calendar date, not the UTC one (evening-CET regression)', () => {
  // 2026-07-04 23:30 CET local time is already 2026-07-05 in UTC — the stamp must stay on the
  // local day, matching the session the entry was actually appended in.
  const eveningLocal = new Date(2026, 6, 4, 23, 30);
  assert.equal(localDateStamp(eveningLocal), '2026-07-04');
  const midday = new Date(2026, 6, 5, 12, 0);
  assert.equal(localDateStamp(midday), '2026-07-05');
});

test('renderEntries: extracts the section body; null when absent', () => {
  assert.equal(renderEntries(DOC), null);
  const one = appendEntry(DOC, ENTRY, '2026-07-04');
  assert.ok(renderEntries(one).includes('### D1'));
});
