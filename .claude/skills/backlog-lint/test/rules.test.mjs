import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleIdMatchesFilename, ruleSingleActive, ruleQueuedRanks } from '../lib/rules.mjs';

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

test('rule 2: exactly one active — pass with one active', () => {
  const files = [file('a', { status: 'active', out_of_scope: ['x'] }), file('b'), file('c')];
  assert.deepEqual(ruleSingleActive(files), []);
});

test('rule 2: exactly one active — fail with zero', () => {
  const files = [file('a'), file('b')];
  const violations = ruleSingleActive(files);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /no file with status: active/i);
});

test('rule 2: exactly one active — fail with two', () => {
  const files = [
    file('a', { status: 'active', out_of_scope: ['x'] }),
    file('b', { status: 'active', out_of_scope: ['x'] }),
  ];
  const violations = ruleSingleActive(files);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /multiple files with status: active/i);
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
