// node:test sibling for check-service-card-drift.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseExclusions, isExcluded, SECTION_IDS,
} from './check-service-card-drift.mjs';

const SCRIPT = join(process.cwd(), 'tools/check-service-card-drift.mjs');

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'nf-carddrift-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }
  return root;
}
function withTree(files, fn) {
  const root = makeTree(files);
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('parseExclusions: whole-service and per-section', () => {
  withTree({
    'tools/service-card-exclusions.json': JSON.stringify({ exclusions: [
      { service: 'investor-web', reason: 'frontend stack — no event constructs' },
      { service: 'foo-ctrl', section: 'ddb-entities', reason: 'internal-only rows' },
    ]}),
  }, (root) => {
    const { exclusions } = parseExclusions(root);
    assert.ok(isExcluded(exclusions, 'investor-web', 'ingress'));
    assert.ok(isExcluded(exclusions, 'foo-ctrl', 'ddb-entities'));
    assert.ok(!isExcluded(exclusions, 'foo-ctrl', 'ingress'));
  });
});

test('parseExclusions: absent file → empty', () => {
  withTree({}, (root) => {
    const { exclusions, entries } = parseExclusions(root);
    assert.equal(exclusions.size, 0);
    assert.deepEqual(entries, []);
  });
});

test('parseExclusions: bad section rejected', () => {
  withTree({
    'tools/service-card-exclusions.json': JSON.stringify({ exclusions: [
      { service: 'x', section: 'not-a-section', reason: 'y' },
    ]}),
  }, (root) => {
    assert.throws(() => parseExclusions(root), /bad entry/);
  });
});

import { parseEvents } from './check-service-card-drift.mjs';

const EVENTS_TS = `
import { eventName } from '@nestfolio/event-types';
export const FooEventTypes = {
  ORDER_FILLED: eventName('ORDER_FILLED'),
  FETCH_REQUESTED: eventName('FETCH_FOO_REQUESTED'),
} as const;
export const FooInboundEventTypes = {
  EXECUTION_MODE_CHANGED: eventName('EXECUTION_MODE_CHANGED'),
} as const;
`;

test('parseEvents: groups + key≠wire resolution', () => {
  withTree({ 'services/d/foo-ctrl/src/domain/events.ts': EVENTS_TS }, (root) => {
    const { groups, resolve } = parseEvents(join(root, 'services/d/foo-ctrl/src/domain/events.ts'));
    assert.deepEqual(groups.map(g => g.constName).sort(), ['FooEventTypes', 'FooInboundEventTypes']);
    const foo = groups.find(g => g.constName === 'FooEventTypes');
    assert.deepEqual(foo.entries.find(e => e.key === 'FETCH_REQUESTED'), { key: 'FETCH_REQUESTED', wire: 'FETCH_FOO_REQUESTED' });
    assert.equal(resolve.get('FooEventTypes.ORDER_FILLED'), 'ORDER_FILLED');
    assert.equal(resolve.get('FooInboundEventTypes.EXECUTION_MODE_CHANGED'), 'EXECUTION_MODE_CHANGED');
  });
});

test('parseEvents: absent file → empty', () => {
  const { groups, resolve } = parseEvents('/no/such/events.ts');
  assert.deepEqual(groups, []);
  assert.equal(resolve.size, 0);
});

import { extractEgress, parseEvents as _pe } from './check-service-card-drift.mjs';
import { _sourceFileForTest as sourceFileForTest } from './check-service-card-drift.mjs';

const EVENTS_FOR_STACK = `
import { eventName } from '@nestfolio/event-types';
export const FooEventTypes = {
  ORDER_FILLED: eventName('ORDER_FILLED'),
  DEPOSIT_REQUESTED: eventName('DEPOSIT_REQUESTED'),
  DEPOSIT_INITIATED: eventName('DEPOSIT_INITIATED'),
} as const;
`;

const STACK_EGRESS = `
const egress = new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'NormalizedEvent': { insert: { field: 'sk', passthrough: true, emits: [
      FooEventTypes.ORDER_FILLED,
    ]}},
    'FundingEvent': { insert: { field: 'sk', passthrough: true, emits: [
      FooEventTypes.DEPOSIT_REQUESTED,
    ]}},
    'DepositIntent': { insert: FooEventTypes.DEPOSIT_INITIATED },
  },
});
`;

test('extractEgress: entity → emitted wire set (incl. insert: shorthand)', () => {
  withTree({
    'svc/src/domain/events.ts': EVENTS_FOR_STACK,
    'svc/src/service.stack.ts': STACK_EGRESS,
  }, (root) => {
    const { resolve } = _pe(join(root, 'svc/src/domain/events.ts'));
    const sf = sourceFileForTest(join(root, 'svc/src/service.stack.ts'));
    const egress = extractEgress(sf, resolve);
    assert.deepEqual(egress, [
      { entity: 'DepositIntent', events: ['DEPOSIT_INITIATED'] },
      { entity: 'FundingEvent', events: ['DEPOSIT_REQUESTED'] },
      { entity: 'NormalizedEvent', events: ['ORDER_FILLED'] },
    ]);
  });
});

test('parseEvents: bare top-level export const X = eventName(Y)', () => {
  const BARE = `
import { eventName } from '@nestfolio/event-types';
export const ONBOARDING_COMPLETED = eventName('ONBOARDING_COMPLETED');
export const GO_LIVE_CONFIRMED = eventName('GO_LIVE_CONFIRMED');
export const FooEventTypes = { X: eventName('X') } as const;
`;
  withTree({ 'svc/src/domain/events.ts': BARE }, (root) => {
    const { groups, resolve } = parseEvents(join(root, 'svc/src/domain/events.ts'));
    assert.equal(resolve.get('ONBOARDING_COMPLETED'), 'ONBOARDING_COMPLETED');
    const bare = groups.find(g => g.constName === '(top-level exports)');
    assert.deepEqual(bare.entries.map(e => e.key), ['GO_LIVE_CONFIRMED', 'ONBOARDING_COMPLETED']);
  });
});

test('extractEgress: bare-identifier insert ref resolves', () => {
  const EV = `
import { eventName } from '@nestfolio/event-types';
export const ONBOARDING_COMPLETED = eventName('ONBOARDING_COMPLETED');
`;
  const STACK = `
new Egress(this, 'Egress', {
  state,
  eventTypes: { 'OnboardingCompleted': { insert: ONBOARDING_COMPLETED } },
});
`;
  withTree({ 'svc/src/domain/events.ts': EV, 'svc/src/service.stack.ts': STACK }, (root) => {
    const { resolve } = _pe(join(root, 'svc/src/domain/events.ts'));
    const sf = sourceFileForTest(join(root, 'svc/src/service.stack.ts'));
    assert.deepEqual(extractEgress(sf, resolve), [{ entity: 'OnboardingCompleted', events: ['ONBOARDING_COMPLETED'] }]);
  });
});
