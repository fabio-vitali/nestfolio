// runtime/content/test/auto-resolve-policy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoResolvePolicy } from '../lib/auto-resolve-policy.mjs';

test('ARP1 design approval → always pause', () => {
  assert.equal(autoResolvePolicy({ kind: 'design-approval' }), 'pause');
});
test('ARP2 irreversible/outward → hard-floor', () => {
  assert.equal(autoResolvePolicy({ kind: 'architectural', irreversible: true }), 'hard-floor');
  assert.equal(autoResolvePolicy({ kind: 'architectural', outwardFacing: true }), 'hard-floor');
});
test('ARP3 shared blast radius → hard-floor', () => {
  assert.equal(autoResolvePolicy({ kind: 'architectural', blastRadius: 'shared' }), 'hard-floor');
});
test('ARP4 local architectural fork → auto-resolve', () => {
  assert.equal(autoResolvePolicy({ kind: 'architectural', blastRadius: 'local' }), 'auto-resolve');
});
test('ARP5 unknown fork → conservative pause', () => {
  assert.equal(autoResolvePolicy({ kind: 'mystery' }), 'pause');
});
