import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkKey, canonicalSubject } from '../fork-key.mjs';

test('forkKey is deterministic for identical structured inputs', () => {
  const a = forkKey('m1', canonicalSubject({ reason: 'floor:scope', symbol: 'quantity' }));
  const b = forkKey('m1', canonicalSubject({ reason: 'floor:scope', symbol: 'quantity' }));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('forkKey differs by member and by subject', () => {
  const base = canonicalSubject({ reason: 'floor:scope', symbol: 'quantity' });
  assert.notEqual(forkKey('m1', base), forkKey('m2', base));
  assert.notEqual(forkKey('m1', base), forkKey('m1', canonicalSubject({ reason: 'floor:scope', symbol: 'amountCents' })));
});

test('design-approval subject is stable by design-slice id, ignoring prose', () => {
  const x = canonicalSubject({ reason: 'design-approval', designSliceId: 'slice-7' });
  const y = canonicalSubject({ reason: 'design-approval', designSliceId: 'slice-7' });
  assert.equal(x, y);
  assert.equal(x, 'design-approval:slice-7');
});

test('canonicalSubject throws on missing structured input', () => {
  assert.throws(() => canonicalSubject({ reason: 'floor:scope' }), /symbol/);
  assert.throws(() => canonicalSubject({ reason: 'design-approval' }), /designSliceId/);
});
