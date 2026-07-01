import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceLifecycle } from '../lib/advance-lifecycle.mjs';
import { validCheck } from './_fixtures.mjs';

const candidate = (o = {}) => validCheck({ status: 'candidate', provenance: { minted_by: 'item-x' }, ...o });
const active = (o = {}) => validCheck({ status: 'active', provenance: { minted_by: 'item-x', ratified: '2026-07-01' }, ...o });

// C1 — ratify a candidate with floor → active + ratified set
test('C1 ratify candidate (floor) → active, provenance.ratified set, event RATIFIED', () => {
  const r = advanceLifecycle({ check: candidate(), transition: 'ratify', floorApproval: true });
  assert.equal(r.check.status, 'active');
  assert.ok(r.check.provenance.ratified);
  assert.equal(r.event, 'RATIFIED');
});

// C2 — ratify without floor → unchanged, REFUSED_NO_FLOOR
test('C2 ratify candidate (no floor) → unchanged, REFUSED_NO_FLOOR', () => {
  const c = candidate();
  const r = advanceLifecycle({ check: c, transition: 'ratify', floorApproval: false });
  assert.equal(r.check.status, 'candidate');
  assert.equal(r.event, 'REFUSED_NO_FLOOR');
});

// C3 — decline a candidate (floor) → check null, DISCARDED
test('C3 decline candidate (floor) → check:null, DISCARDED', () => {
  const r = advanceLifecycle({ check: candidate(), transition: 'decline', floorApproval: true });
  assert.equal(r.check, null);
  assert.equal(r.event, 'DISCARDED');
});

// C4 — supersede active with a successor → superseded + chained both sides
test('C4 supersede active (floor + successor) → superseded, chain both sides', () => {
  const succ = active({ id: 'successor' });
  const r = advanceLifecycle({ check: active({ id: 'old' }), transition: 'supersede', floorApproval: true, successor: succ });
  assert.equal(r.check.status, 'superseded');
  assert.equal(r.check.provenance.superseded_by, 'successor');
  assert.equal(r.successor.provenance.supersedes, 'old');
  assert.equal(r.event, 'SUPERSEDED');
});

// C5 — retire active (floor) → retired, retired_reason recorded
test('C5 retire active (floor) → retired, retired_reason recorded', () => {
  const r = advanceLifecycle({ check: active({ id: 'r' }), transition: 'retire', floorApproval: true, retiredReason: 'property changed' });
  assert.equal(r.check.status, 'retired');
  assert.equal(r.check.provenance.retired_reason, 'property changed');
  assert.equal(r.event, 'RETIRED');
});

// C6 — ratify already-active WITH floor → REFUSED_ILLEGAL_TRANSITION (from-state guard bites)
test('C6 ratify already-active (floor present) → REFUSED_ILLEGAL_TRANSITION', () => {
  const r = advanceLifecycle({ check: active(), transition: 'ratify', floorApproval: true });
  assert.equal(r.event, 'REFUSED_ILLEGAL_TRANSITION');
});

// C7 — ratify already-active WITHOUT floor → REFUSED_NO_FLOOR (floor guard precedence)
test('C7 floorless AND illegal → REFUSED_NO_FLOOR (floor precedence, not ILLEGAL)', () => {
  const r = advanceLifecycle({ check: active(), transition: 'ratify', floorApproval: false });
  assert.equal(r.event, 'REFUSED_NO_FLOOR');
});
