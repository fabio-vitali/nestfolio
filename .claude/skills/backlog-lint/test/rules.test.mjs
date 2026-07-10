import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleIdMatchesFilename, ruleSingleActive, ruleQueuedRanks } from '../lib/rules.mjs';
import { ruleActiveOutOfScope, ruleShippedValidationGate } from '../lib/rules.mjs';
import { ruleReferencesValid, rulePromotionTriggerGated } from '../lib/rules.mjs';
import { ruleFrontmatterParseable, ruleItemSchemaValid } from '../lib/rules.mjs';

const fixturesDir = dirname(fileURLToPath(import.meta.url)) + '/fixtures';

const file = (id, fm = {}) => ({
  id, filename: `${id}.md`, path: `/dummy/${id}.md`,
  frontmatter: { id, status: 'parking', type: 'bug', notes: '', ...fm }, body: '',
});

test('rule 1: id matches filename — pass', () => {
  assert.deepEqual(ruleIdMatchesFilename(file('foo')), []);
});

test('rule 1: id matches filename — fail when frontmatter id differs', () => {
  const f = file('foo'); f.frontmatter.id = 'bar';
  const violations = ruleIdMatchesFilename(f);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /id.*does not match filename/i);
});

test('rule 2: at most one active — pass with one active', () => {
  const files = [file('a', { status: 'active', out_of_scope: ['x'] }), file('b'), file('c')];
  assert.deepEqual(ruleSingleActive(files), []);
});

test('rule 2: at most one active — pass with zero active', () => {
  const files = [file('a'), file('b')];
  assert.deepEqual(ruleSingleActive(files), []);
});

test('rule 2: at most one active — fail with two', () => {
  const files = [
    file('a', { status: 'active', out_of_scope: ['x'] }),
    file('b', { status: 'active', out_of_scope: ['x'] }),
  ];
  const violations = ruleSingleActive(files);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /multiple non-epic files with status: active/i);
});

test('rule 6: queued ⇒ rank set + unique', () => {
  const files = [
    file('a', { status: 'queued', rank: 1 }),
    file('b', { status: 'queued', rank: 2 }),
  ];
  assert.deepEqual(ruleQueuedRanks(files), []);
});

test('rule 6: queued ⇒ fail when rank missing', () => {
  const files = [file('a', { status: 'queued' })];
  const violations = ruleQueuedRanks(files);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /missing rank/i);
});

test('rule 6: queued ⇒ fail when ranks duplicate', () => {
  const files = [
    file('a', { status: 'queued', rank: 1 }),
    file('b', { status: 'queued', rank: 1 }),
  ];
  const violations = ruleQueuedRanks(files);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /duplicate rank/i);
});

test('rule 4: active ⇒ out_of_scope non-empty — pass', () => {
  const f = file('a', { status: 'active', out_of_scope: ['something'] });
  assert.deepEqual(ruleActiveOutOfScope(f), []);
});

test('rule 4: active ⇒ out_of_scope non-empty — fail when empty', () => {
  const f = file('a', { status: 'active', out_of_scope: [] });
  const violations = ruleActiveOutOfScope(f);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /out_of_scope.*empty/i);
});

test('rule 4: active ⇒ out_of_scope non-empty — fail when missing', () => {
  const f = file('a', { status: 'active' });
  const violations = ruleActiveOutOfScope(f);
  assert.equal(violations.length, 1);
});

test('rule 5: shipped ⇒ validation_gate non-empty — pass', () => {
  const f = file('a', { status: 'shipped', validation_gate: '5/5 e2e' });
  assert.deepEqual(ruleShippedValidationGate(f), []);
});

test('rule 5: shipped ⇒ validation_gate non-empty — fail when empty', () => {
  const f = file('a', { status: 'shipped', validation_gate: '' });
  const violations = ruleShippedValidationGate(f);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /validation_gate.*empty/i);
});

test('rule 3: design type with valid refs (path + anchor) — pass', () => {
  const f = file('a', {
    type: 'spec',
    references: ['sample-target.md#7.2-portfolio-construction'],
  });
  assert.deepEqual(ruleReferencesValid(f, fixturesDir), []);
});

test('rule 3: design type with empty references — fail', () => {
  const f = file('a', { type: 'design', references: [] });
  const violations = ruleReferencesValid(f, fixturesDir);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /references.*empty/i);
});

test('rule 3: design type with non-existent path — fail', () => {
  const f = file('a', { type: 'spec', references: ['nonexistent.md'] });
  const violations = ruleReferencesValid(f, fixturesDir);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /not found/i);
});

test('rule 3: design type with bad anchor — fail', () => {
  const f = file('a', { type: 'spec', references: ['sample-target.md#nope'] });
  const violations = ruleReferencesValid(f, fixturesDir);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /anchor.*not found/i);
});

test('rule 3: anchor matching only a `#` line INSIDE a code block — fail (not a real heading)', () => {
  // `# fake-heading-in-codeblock` lives inside a ```bash fence in the fixture — it is
  // a shell comment, not a markdown heading, so the anchor must NOT resolve.
  const f = file('a', { type: 'spec', references: ['sample-target.md#fake-heading-in-codeblock'] });
  const violations = ruleReferencesValid(f, fixturesDir);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /anchor.*not found/i);
});

test('rule 3: non-design types skip the check', () => {
  const f = file('a', { type: 'bug', references: [] });
  assert.deepEqual(ruleReferencesValid(f, fixturesDir), []);
});

// ── Rule 8: promotion-trigger gating (notes AND body) ──────────────────────
test('rule 8: queued + trigger in body — fail', () => {
  const f = file('a', { status: 'queued', rank: 1 });
  f.body = 'Some context. Promote when the dev env recovers.';
  const v = rulePromotionTriggerGated(f);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /unmet promotion trigger/i);
});

test('rule 8: queued + trigger in NOTES — fail (notes must not escape)', () => {
  const f = file('a', { status: 'queued', rank: 1, notes: 'Runtime verify. Promote after Phase 4 ships.' });
  const v = rulePromotionTriggerGated(f);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /unmet promotion trigger/i);
});

test('rule 8: queued + no trigger anywhere — pass', () => {
  const f = file('a', { status: 'queued', rank: 1, notes: 'Next-up work, ready to pick up.' });
  f.body = 'No gating language here.';
  assert.deepEqual(rulePromotionTriggerGated(f), []);
});

test('rule 8: parking + trigger in notes — skipped (only queued is gated)', () => {
  const f = file('a', { status: 'parking', notes: 'Promote when the forks resolve.' });
  assert.deepEqual(rulePromotionTriggerGated(f), []);
});

test('rule 8: "Promote only" inside the Decision log section — pass (resolved option, not a trigger)', () => {
  const f = file('a', { status: 'queued', rank: 1 });
  f.body = [
    'Real context, trigger already documented as fired.',
    '',
    '## Decision log',
    '',
    '### D1 — 2026-07-05',
    '- **Options:** Promote & run --auto | Promote only | Leave parked',
    '- **Chosen:** Promote & run --auto',
  ].join('\n');
  assert.deepEqual(rulePromotionTriggerGated(f), []);
});

test('rule 8: trigger BEFORE a Decision log section still fails (strip is section-scoped)', () => {
  const f = file('a', { status: 'queued', rank: 1 });
  f.body = 'Promote once the migration lands.\n\n## Decision log\n\n### D1\n- **Chosen:** x';
  const v = rulePromotionTriggerGated(f);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /unmet promotion trigger/i);
});

test('rule 8: trigger in a section AFTER the Decision log still fails', () => {
  const f = file('a', { status: 'queued', rank: 1 });
  f.body = 'Context.\n\n## Decision log\n\n### D1\n- **Chosen:** x\n\n## Later\nPromote after Phase 4 ships.';
  const v = rulePromotionTriggerGated(f);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /unmet promotion trigger/i);
});

// ── frontmatter-parseable: located gate for malformed YAML ─────────────────
test('frontmatter-parseable: located violation naming the file when parseError set', () => {
  const f = { id: 'bad', filename: 'bad.md', path: '/dummy/bad.md',
              frontmatter: null, body: '', parseError: 'Map keys must be unique' };
  const violations = ruleFrontmatterParseable(f);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'frontmatter-parseable');
  assert.equal(violations[0].file, 'bad.md');
  assert.match(violations[0].message, /bad\.md.*malformed YAML/i);
});

test('frontmatter-parseable: no violation for a cleanly parsed file', () => {
  assert.deepEqual(ruleFrontmatterParseable(file('ok')), []);
});

// ── item-schema-valid: element-shape validation against the ring-1 ItemSchema ──
// Structural precondition (not a numbered rule): catches element-shape corruption
// the 11 relational rules are blind to, via the SAME validateItem the runtime read
// path uses (single source of truth — no second schema).
test('item-schema-valid: clean frontmatter — pass', () => {
  assert.deepEqual(ruleItemSchemaValid(file('ok')), []);
});

test('item-schema-valid: out_of_scope corrupted to a one-key mapping — fail', () => {
  // The canonical bug: an unquoted scalar with an embedded colon parses as a
  // one-key mapping, so out_of_scope silently becomes an object, not a string[].
  const f = file('a', { status: 'active', out_of_scope: { 'the raw `modelId': 'string` everywhere' } });
  const v = ruleItemSchemaValid(f);
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, 'item-schema-valid');
  assert.equal(v[0].file, 'a.md');
  assert.match(v[0].message, /out_of_scope/i);
});

test('item-schema-valid: out_of_scope array holding a non-string element — fail', () => {
  const f = file('a', { out_of_scope: [{ modelId: 'string everywhere' }] });
  const v = ruleItemSchemaValid(f);
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, 'item-schema-valid');
  assert.match(v[0].message, /out_of_scope/i);
});

test('item-schema-valid: references holding a non-string/non-object element — fail', () => {
  const f = file('a', { type: 'spec', references: [42] });
  const v = ruleItemSchemaValid(f);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /references/i);
});

test('item-schema-valid: epic_role outside the enum — fail', () => {
  const f = file('a', { epic: 'e', epic_role: 'bogus' });
  const v = ruleItemSchemaValid(f);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /epic_role/i);
});

test('item-schema-valid: already parse-errored file — skip (ruleFrontmatterParseable owns it)', () => {
  const f = { id: 'bad', filename: 'bad.md', path: '/dummy/bad.md',
              frontmatter: null, body: '', parseError: 'Map keys must be unique' };
  assert.deepEqual(ruleItemSchemaValid(f), []);
});

test('item-schema-valid: missing id in frontmatter does not trip this rule (id-matches-filename owns id)', () => {
  // Injecting the filename-derived id keeps this rule focused on element SHAPES,
  // not on the id/filename relationship (rule 1's job).
  const f = { id: 'noid', filename: 'noid.md', path: '/dummy/noid.md',
              frontmatter: { status: 'parking', type: 'bug' }, body: '' };
  assert.deepEqual(ruleItemSchemaValid(f), []);
});
