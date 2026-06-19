// tools/check-typed-fixtures.test.mjs — node:test sibling for check-typed-fixtures.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanFile } from './check-typed-fixtures.mjs';

const REG = new Set(['BALANCE_UPDATED', 'ALPACA_ORDER_FILLED']);
const F = 'services/x/x-ctrl/test/integration/x.integration.test.ts';

test('registered literal detailType + detail: → violation', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'BALANCE_UPDATED', detail: { x: 1 } });`;
  const { violations } = scanFile(F, src, REG);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /BALANCE_UPDATED — legacy putEvent/);
});

test('member detailType whose trailing name is not registered → clean (note only)', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: BrokerCtrlEventTypes.ORDER_FILLED, detail: { x: 1 } });`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /compound detailType 'BrokerCtrlEventTypes.ORDER_FILLED'/);
});

test('typed form (registered literal, no detail:) → clean', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'BALANCE_UPDATED', subject: { cashBalanceCents: 1 } });`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 0);
});

test('bare literal not in registry + detail: → clean', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'ORDER_REJECTED', detail: { x: 1 } });`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 0);
});

test('.subject as T cast inside putEvent → violation', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'BALANCE_UPDATED', subject: payload.subject as Foo });`;
  const { violations } = scanFile(F, src, REG);
  assert.ok(violations.some((v) => /cast inside putEvent fixture/.test(v)));
});

test('CLI exits 0 on the real repo (gate currently green)', () => {
  const r = spawnSync('node', [join(process.cwd(), 'tools/check-typed-fixtures.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0);
});
