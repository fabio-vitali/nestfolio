import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globsOverlap } from '../lib/glob-overlap.mjs';

test('identical globs overlap', () => assert.equal(globsOverlap('services/**/*.ts', 'services/**/*.ts'), true));
test('** absorbs intermediate segments: services/**/*.ts vs services/investor-ctrl/** overlap', () =>
  assert.equal(globsOverlap('services/**/*.ts', 'services/investor-ctrl/**'), true));
test('disjoint literal roots do not overlap', () =>
  assert.equal(globsOverlap('services/**', 'docs/**'), false));
test('intra-segment *.ts vs a non-.ts literal path do not overlap', () =>
  assert.equal(globsOverlap('services/*/x/*.ts', 'services/a/x/readme.md'), false));
test('intra-segment *.ts vs a concrete .ts path overlap', () =>
  assert.equal(globsOverlap('services/*/*.ts', 'services/a/main.ts'), true));
test('single * matches exactly one segment (not across /)', () => {
  assert.equal(globsOverlap('services/*', 'services/a/b'), false);
  assert.equal(globsOverlap('services/*', 'services/a'), true);
});
test('** matches zero segments: a/**/b vs a/b overlap', () => assert.equal(globsOverlap('a/**/b', 'a/b'), true));
test('two-* intra-segment intersection: a* vs *b overlap via "ab"', () =>
  assert.equal(globsOverlap('a*', '*b'), true));
