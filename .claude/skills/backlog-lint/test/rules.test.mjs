import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleIdMatchesFilename, ruleSingleActive, ruleQueuedRanks } from '../lib/rules.mjs';
import { ruleActiveOutOfScope, ruleShippedValidationGate } from '../lib/rules.mjs';
import { ruleReferencesValid, rulePromotionTriggerGated } from '../lib/rules.mjs';

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
