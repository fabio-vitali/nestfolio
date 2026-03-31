// libs/cdk-constructs/test/core/event-types.test.ts
import {
  buildRuntimeConfig,
  collectAllEventTypes,
  extractFilters,
} from '../../src/core/event-types';

describe('buildRuntimeConfig', () => {
  it('expands base name string to _CREATED and _UPDATED', () => {
    const result = buildRuntimeConfig({ 'DecisionPacket': 'DECISION_PACKET' });
    expect(result).toEqual({
      'DecisionPacket:INSERT': 'DECISION_PACKET_CREATED',
      'DecisionPacket:MODIFY': 'DECISION_PACKET_UPDATED',
    });
  });

  it('maps explicit per-action strings', () => {
    const result = buildRuntimeConfig({
      'BalanceEvent': { insert: 'BALANCE_UPDATED', modify: 'BALANCE_EVENT_UPDATED' },
    });
    expect(result).toEqual({
      'BalanceEvent:INSERT': 'BALANCE_UPDATED',
      'BalanceEvent:MODIFY': 'BALANCE_EVENT_UPDATED',
    });
  });

  it('maps insert-only config (no modify)', () => {
    const result = buildRuntimeConfig({
      'OnboardingCompleted': { insert: 'ONBOARDING_COMPLETED' },
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
          map: { SUBMITTED: 'ORDER_SUBMITTED', REJECTED: 'ORDER_REJECTED' },
          default: 'ORDER_CREATED',
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
        insert: { field: 'sk', passthrough: true, emits: ['ORDER_FILLED', 'ORDER_REJECTED'] },
      },
    });
    expect(result).toEqual({
      'NormalizedEvent:INSERT': { field: 'sk', passthrough: true },
    });
  });

  it('handles mixed config with multiple record types', () => {
    const result = buildRuntimeConfig({
      'Goal': 'GOAL',
      'Deposit': { insert: 'DEPOSIT_INITIATED', modify: 'DEPOSIT_UPDATED' },
    });
    expect(result).toEqual({
      'Goal:INSERT': 'GOAL_CREATED',
      'Goal:MODIFY': 'GOAL_UPDATED',
      'Deposit:INSERT': 'DEPOSIT_INITIATED',
      'Deposit:MODIFY': 'DEPOSIT_UPDATED',
    });
  });
});

describe('collectAllEventTypes', () => {
  it('expands base name to _CREATED and _UPDATED', () => {
    expect(collectAllEventTypes({ 'Foo': 'FOO' })).toEqual(
      expect.arrayContaining(['FOO_CREATED', 'FOO_UPDATED']),
    );
  });

  it('collects explicit per-action strings', () => {
    const result = collectAllEventTypes({
      'Bar': { insert: 'BAR_INSERTED', modify: 'BAR_MODIFIED' },
    });
    expect(result).toEqual(expect.arrayContaining(['BAR_INSERTED', 'BAR_MODIFIED']));
  });

  it('collects all field dispatch map values and default', () => {
    const result = collectAllEventTypes({
      'Order': {
        insert: {
          field: 'status',
          map: { A: 'EVENT_A', B: 'EVENT_B' },
          default: 'EVENT_DEFAULT',
        },
      },
    });
    expect(result).toEqual(expect.arrayContaining(['EVENT_A', 'EVENT_B', 'EVENT_DEFAULT']));
  });

  it('collects passthrough emits array', () => {
    const result = collectAllEventTypes({
      'NE': {
        insert: { field: 'sk', passthrough: true, emits: ['X', 'Y'] },
      },
    });
    expect(result).toEqual(expect.arrayContaining(['X', 'Y']));
  });

  it('deduplicates across record types', () => {
    const result = collectAllEventTypes({
      'A': { insert: 'SHARED' },
      'B': { insert: 'SHARED' },
    });
    expect(result.filter(t => t === 'SHARED')).toHaveLength(1);
  });
});

describe('extractFilters', () => {
  it('returns INSERT + MODIFY for base name string', () => {
    const result = extractFilters({ 'Foo': 'FOO' });
    expect(result).toEqual([
      { typeName: 'Foo', action: 'INSERT' },
      { typeName: 'Foo', action: 'MODIFY' },
    ]);
  });

  it('returns only defined actions for per-action config', () => {
    const result = extractFilters({
      'Bar': { insert: 'BAR_CREATED' },
    });
    expect(result).toEqual([
      { typeName: 'Bar', action: 'INSERT' },
    ]);
  });

  it('includes REMOVE when defined', () => {
    const result = extractFilters({
      'Baz': { insert: 'BAZ_CREATED', remove: 'BAZ_DELETED' },
    });
    expect(result).toEqual([
      { typeName: 'Baz', action: 'INSERT' },
      { typeName: 'Baz', action: 'REMOVE' },
    ]);
  });

  it('handles field dispatch and passthrough same as strings', () => {
    const result = extractFilters({
      'Order': {
        insert: { field: 'status', map: { A: 'X' } },
        modify: { field: 'status', map: { A: 'Y' } },
      },
    });
    expect(result).toEqual([
      { typeName: 'Order', action: 'INSERT' },
      { typeName: 'Order', action: 'MODIFY' },
    ]);
  });
});
