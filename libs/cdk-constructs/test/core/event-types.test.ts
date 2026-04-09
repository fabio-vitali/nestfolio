// libs/cdk-constructs/test/core/event-types.test.ts
import { eventName } from '@nestfolio/event-types';
import {
  buildRuntimeConfig,
  collectAllEventTypes,
  extractFilters,
} from '../../src/core/event-types';

describe('buildRuntimeConfig', () => {
  it('maps explicit per-action EventName strings', () => {
    const result = buildRuntimeConfig({
      'BalanceEvent': {
        insert: eventName('BALANCE_UPDATED'),
        modify: eventName('BALANCE_EVENT_UPDATED'),
      },
    });
    expect(result).toEqual({
      'BalanceEvent:INSERT': 'BALANCE_UPDATED',
      'BalanceEvent:MODIFY': 'BALANCE_EVENT_UPDATED',
    });
  });

  it('maps insert-only config (no modify)', () => {
    const result = buildRuntimeConfig({
      'OnboardingCompleted': { insert: eventName('ONBOARDING_COMPLETED') },
    });
    expect(result).toEqual({
      'OnboardingCompleted:INSERT': 'ONBOARDING_COMPLETED',
    });
  });

  it('serializes field dispatch to runtime format', () => {
    const result = buildRuntimeConfig({
      'Order': {
        insert: {
          field: 'status',
          map: {
            SUBMITTED: eventName('ORDER_SUBMITTED'),
            REJECTED: eventName('ORDER_REJECTED'),
          },
          default: eventName('ORDER_CREATED'),
        },
      },
    });
    expect(result).toEqual({
      'Order:INSERT': {
        field: 'status',
        map: { SUBMITTED: 'ORDER_SUBMITTED', REJECTED: 'ORDER_REJECTED' },
        default: 'ORDER_CREATED',
      },
    });
  });

  it('serializes passthrough to runtime format (without emits)', () => {
    const result = buildRuntimeConfig({
      'NormalizedEvent': {
        insert: {
          field: 'sk',
          passthrough: true,
          emits: [eventName('ORDER_FILLED'), eventName('ORDER_REJECTED')],
        },
      },
    });
    expect(result).toEqual({
      'NormalizedEvent:INSERT': { field: 'sk', passthrough: true },
    });
  });

  it('handles multiple record types with mixed configs', () => {
    const result = buildRuntimeConfig({
      'Goal': {
        insert: eventName('GOAL_CREATED'),
        modify: eventName('GOAL_UPDATED'),
      },
      'Deposit': {
        insert: eventName('DEPOSIT_INITIATED'),
        modify: eventName('DEPOSIT_UPDATED'),
      },
    });
    expect(result).toEqual({
      'Goal:INSERT': 'GOAL_CREATED',
      'Goal:MODIFY': 'GOAL_UPDATED',
      'Deposit:INSERT': 'DEPOSIT_INITIATED',
      'Deposit:MODIFY': 'DEPOSIT_UPDATED',
    });
  });

  it('includes remove action when defined', () => {
    const result = buildRuntimeConfig({
      'Session': {
        insert: eventName('SESSION_CREATED'),
        remove: eventName('SESSION_DELETED'),
      },
    });
    expect(result).toEqual({
      'Session:INSERT': 'SESSION_CREATED',
      'Session:REMOVE': 'SESSION_DELETED',
    });
  });
});

describe('collectAllEventTypes', () => {
  it('collects explicit per-action EventName strings', () => {
    const result = collectAllEventTypes({
      'Bar': {
        insert: eventName('BAR_INSERTED'),
        modify: eventName('BAR_MODIFIED'),
      },
    });
    expect(result).toEqual(expect.arrayContaining(['BAR_INSERTED', 'BAR_MODIFIED']));
  });

  it('collects all field dispatch map values and default', () => {
    const result = collectAllEventTypes({
      'Order': {
        insert: {
          field: 'status',
          map: {
            A: eventName('EVENT_A'),
            B: eventName('EVENT_B'),
          },
          default: eventName('EVENT_DEFAULT'),
        },
      },
    });
    expect(result).toEqual(expect.arrayContaining(['EVENT_A', 'EVENT_B', 'EVENT_DEFAULT']));
  });

  it('collects passthrough emits array', () => {
    const result = collectAllEventTypes({
      'NE': {
        insert: {
          field: 'sk',
          passthrough: true,
          emits: [eventName('X'), eventName('Y')],
        },
      },
    });
    expect(result).toEqual(expect.arrayContaining(['X', 'Y']));
  });

  it('deduplicates across record types', () => {
    const result = collectAllEventTypes({
      'A': { insert: eventName('SHARED') },
      'B': { insert: eventName('SHARED') },
    });
    expect(result.filter(t => t === 'SHARED')).toHaveLength(1);
  });
});

describe('extractFilters', () => {
  it('returns only defined actions', () => {
    const result = extractFilters({
      'Bar': { insert: eventName('BAR_CREATED') },
    });
    expect(result).toEqual([
      { typeName: 'Bar', action: 'INSERT' },
    ]);
  });

  it('returns INSERT and MODIFY when both defined', () => {
    const result = extractFilters({
      'Foo': {
        insert: eventName('FOO_CREATED'),
        modify: eventName('FOO_UPDATED'),
      },
    });
    expect(result).toEqual([
      { typeName: 'Foo', action: 'INSERT' },
      { typeName: 'Foo', action: 'MODIFY' },
    ]);
  });

  it('includes REMOVE when defined', () => {
    const result = extractFilters({
      'Baz': {
        insert: eventName('BAZ_CREATED'),
        remove: eventName('BAZ_DELETED'),
      },
    });
    expect(result).toEqual([
      { typeName: 'Baz', action: 'INSERT' },
      { typeName: 'Baz', action: 'REMOVE' },
    ]);
  });

  it('handles field dispatch and passthrough same as strings', () => {
    const result = extractFilters({
      'Order': {
        insert: { field: 'status', map: { A: eventName('X') } },
        modify: { field: 'status', map: { A: eventName('Y') } },
      },
    });
    expect(result).toEqual([
      { typeName: 'Order', action: 'INSERT' },
      { typeName: 'Order', action: 'MODIFY' },
    ]);
  });
});
