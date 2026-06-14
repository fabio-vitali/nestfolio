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

import { extractIngress } from './check-service-card-drift.mjs';

const STACK_INGRESS = `
class S {
  constructor() {
    const modeIngress = new Ingress(this, 'ModeIngress', {
      state,
      eventTypes: [FooInboundEventTypes.EXECUTION_MODE_CHANGED],
      entry: join(__dirname, 'handlers', 'mode-listener.ts'),
    });
    const CALLBACK_EVENT_TYPES = [
      FooInboundEventTypes.SIM_ORDER_FILLED,
      FooInboundEventTypes.SIM_ORDER_REJECTED,
    ];
    const cb = new Ingress(this, 'CallbackIngress', {
      state,
      eventTypes: CALLBACK_EVENT_TYPES,
      entry: join(__dirname, 'handlers', 'callback-resolver.ts'),
    });
  }
}
`;

const EVENTS_INGRESS = `
import { eventName } from '@nestfolio/event-types';
export const FooInboundEventTypes = {
  EXECUTION_MODE_CHANGED: eventName('EXECUTION_MODE_CHANGED'),
  SIM_ORDER_FILLED: eventName('SIM_ORDER_FILLED'),
  SIM_ORDER_REJECTED: eventName('SIM_ORDER_REJECTED'),
} as const;
`;

test('extractIngress: inline array + helper-const array, handler filenames', () => {
  withTree({
    'svc/src/domain/events.ts': EVENTS_INGRESS,
    'svc/src/service.stack.ts': STACK_INGRESS,
  }, (root) => {
    const { resolve } = _pe(join(root, 'svc/src/domain/events.ts'));
    const sf = sourceFileForTest(join(root, 'svc/src/service.stack.ts'));
    const ingress = extractIngress(sf, resolve);
    assert.deepEqual(ingress, [
      { label: 'CallbackIngress', handler: 'callback-resolver.ts', events: ['SIM_ORDER_FILLED', 'SIM_ORDER_REJECTED'] },
      { label: 'ModeIngress', handler: 'mode-listener.ts', events: ['EXECUTION_MODE_CHANGED'] },
    ]);
  });
});

import { extractForwarding } from './check-service-card-drift.mjs';

const EVENTS_FWD = `
import { eventName } from '@nestfolio/event-types';
export const InvestorIngestEventTypes = {
  ORDER_FILLED: eventName('ORDER_FILLED'),
  DEPOSIT_REQUESTED: eventName('DEPOSIT_REQUESTED'),
} as const;
`;
const STACK_FWD = `
class S {
  constructor() {
    const fromExecutionEvents = [
      InvestorIngestEventTypes.ORDER_FILLED,
      InvestorIngestEventTypes.DEPOSIT_REQUESTED,
    ];
    const r = new Rule(this, 'InvestorIngress-FromExecution', {
      eventBus: executionBus,
      eventPattern: { detailType: fromExecutionEvents },
      targets: [new EventBusTarget(investorBus)],
    });
  }
}
`;

test('extractForwarding: Rule detailType array → forwarded wire set', () => {
  withTree({
    'svc/src/domain/events.ts': EVENTS_FWD,
    'svc/src/service.stack.ts': STACK_FWD,
  }, (root) => {
    const { resolve } = _pe(join(root, 'svc/src/domain/events.ts'));
    const sf = sourceFileForTest(join(root, 'svc/src/service.stack.ts'));
    const fwd = extractForwarding(sf, resolve);
    assert.deepEqual(fwd, [
      { label: 'InvestorIngress-FromExecution', handler: null, events: ['DEPOSIT_REQUESTED', 'ORDER_FILLED'] },
    ]);
  });
});

import { parseStack, scanWriteTypenames, buildModel } from './check-service-card-drift.mjs';

test('scanWriteTypenames: intent-factory write literals', () => {
  withTree({
    'svc/src/handlers/h.ts': `
      project('BrokerOrder', x);
      record('FundingEvent', y);
      accumulate('NormalizedEvent', z);
      const s = obj.update('NotAFactoryMethod'); // method call, not factory
    `,
  }, (root) => {
    const got = scanWriteTypenames(join(root, 'svc/src'));
    assert.deepEqual(got.sort(), ['BrokerOrder', 'FundingEvent', 'NormalizedEvent']);
  });
});

test('parseStack + buildModel: ddb-entities = egress keys ∪ write typenames', () => {
  withTree({
    'svc/src/domain/events.ts': EVENTS_FOR_STACK,
    'svc/src/service.stack.ts': STACK_EGRESS + `
      const fn = new Ingress(this, 'In', { state, eventTypes: [], entry: join(__dirname,'handlers','x.ts') });`,
    'svc/src/handlers/x.ts': `record('ExtraRow', a);`,
  }, (root) => {
    const model = buildModel(join(root, 'svc'));
    assert.deepEqual(model.handlers, ['x.ts']);
    assert.deepEqual(model.ddbEntities, ['DepositIntent', 'ExtraRow', 'FundingEvent', 'NormalizedEvent']);
  });
});

import { renderBlock, wrapBlock, locateBlocks } from './check-service-card-drift.mjs';

const MODEL = {
  eventTypes: [{ constName: 'FooEventTypes', entries: [
    { key: 'ORDER_FILLED', wire: 'ORDER_FILLED' },
    { key: 'FETCH_REQUESTED', wire: 'FETCH_FOO_REQUESTED' },
  ]}],
  ingress: [{ label: 'ModeIngress', handler: 'mode-listener.ts', events: ['EXECUTION_MODE_CHANGED'] }],
  egress: [{ entity: 'NormalizedEvent', events: ['ORDER_FILLED'] }],
  handlers: ['mode-listener.ts'],
  ddbEntities: ['NormalizedEvent'],
};

test('renderBlock: event-types shows KEY and KEY (WIRE)', () => {
  assert.equal(renderBlock('event-types', MODEL),
    '- FooEventTypes: FETCH_REQUESTED (FETCH_FOO_REQUESTED), ORDER_FILLED');
});

test('renderBlock: ingress with handler', () => {
  assert.equal(renderBlock('ingress', MODEL),
    '- ModeIngress (mode-listener.ts): EXECUTION_MODE_CHANGED');
});

test('locateBlocks: tolerates hint text in start marker, captures body', () => {
  const card = [
    '## Egress',
    wrapBlock('egress', '- NormalizedEvent: ORDER_FILLED'),
    'prose after',
  ].join('\n');
  const blocks = locateBlocks(card);
  assert.equal(blocks.get('egress').body, '- NormalizedEvent: ORDER_FILLED');
});

import { expectedSections, applyFix, evaluate } from './check-service-card-drift.mjs';

test('expectedSections: only sections with a source signal', () => {
  assert.deepEqual(expectedSections(MODEL).sort(),
    ['ddb-entities', 'egress', 'event-types', 'handlers', 'ingress']);
  const hub = { eventTypes: [], ingress: [], egress: [], handlers: [], ddbEntities: [] };
  assert.deepEqual(expectedSections(hub), []);
});

test('applyFix: inserts block under matching heading', () => {
  const card = '# foo-ctrl\n\n## Egress\n\nprose\n';
  const out = applyFix(card, 'egress', '- NormalizedEvent: ORDER_FILLED');
  assert.match(out, /## Egress\n<!-- card-drift:egress[^>]*-->\n- NormalizedEvent: ORDER_FILLED\n<!-- \/card-drift:egress -->/);
});

test('applyFix: updates existing block in place', () => {
  const card = '## Egress\n' + wrapBlock('egress', '- Old: X') + '\nprose';
  const out = applyFix(card, 'egress', '- New: Y');
  assert.match(out, /- New: Y/);
  assert.doesNotMatch(out, /- Old: X/);
});

test('evaluate: drift error + fix produced', () => {
  withTree({
    'services/d/foo-ctrl/src/domain/events.ts': EVENTS_FOR_STACK,
    'services/d/foo-ctrl/src/service.stack.ts': STACK_EGRESS,
    'services/d/foo-ctrl/CLAUDE.md': '## Egress\n' + wrapBlock('egress', '- NormalizedEvent: WRONG') + '\n',
  }, (root) => {
    const { errors } = evaluate(root, new Set());
    const egErr = errors.find(e => e.service === 'foo-ctrl' && e.section === 'egress');
    assert.ok(egErr, 'expected an egress drift error');
    assert.equal(egErr.kind, 'drift');
  });
});

test('evaluate: missing-block error when section expected but no block', () => {
  withTree({
    'services/d/foo-ctrl/src/domain/events.ts': EVENTS_FOR_STACK,
    'services/d/foo-ctrl/src/service.stack.ts': STACK_EGRESS,
    'services/d/foo-ctrl/CLAUDE.md': '# foo-ctrl\n\n## Egress\n\nprose only, no block\n',
  }, (root) => {
    const { errors } = evaluate(root, new Set());
    assert.ok(errors.some(e => e.service === 'foo-ctrl' && e.section === 'egress' && e.kind === 'missing'));
  });
});

test('evaluate: stale-block error when block present but no source signal', () => {
  withTree({
    'services/d/foo-hub/src/service.stack.ts': 'export class S {}',
    'services/d/foo-hub/CLAUDE.md': '## Egress\n' + wrapBlock('egress', '- Ghost: X') + '\n',
  }, (root) => {
    const { errors } = evaluate(root, new Set());
    assert.ok(errors.some(e => e.service === 'foo-hub' && e.section === 'egress' && e.kind === 'stale'));
  });
});

test('evaluate: exclusion suppresses the error', () => {
  withTree({
    'services/d/foo-ctrl/src/domain/events.ts': EVENTS_FOR_STACK,
    'services/d/foo-ctrl/src/service.stack.ts': STACK_EGRESS,
    'services/d/foo-ctrl/CLAUDE.md': '## Egress\n' + wrapBlock('egress', '- NormalizedEvent: WRONG') + '\n',
  }, (root) => {
    const { errors } = evaluate(root, new Set(['foo-ctrl::egress']));
    assert.ok(!errors.some(e => e.service === 'foo-ctrl' && e.section === 'egress'));
  });
});

test('evaluate: hub with no event constructs → no errors', () => {
  withTree({
    'services/d/foo-hub/src/service.stack.ts': 'export class S {}',
    'services/d/foo-hub/CLAUDE.md': '# foo-hub\n\n## State\nNone (stateless hub)\n',
  }, (root) => {
    const { errors } = evaluate(root, new Set());
    assert.deepEqual(errors, []);
  });
});
