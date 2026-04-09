import { eventName, assertEventName } from '../src/index';
import type { EventName } from '../src/index';

describe('eventName', () => {
  it('returns the string value unchanged', () => {
    const result = eventName('ORDER_FILLED');
    expect(result).toBe('ORDER_FILLED');
  });

  it('preserves the literal type at runtime', () => {
    const result = eventName('GOAL_CREATED');
    expect(typeof result).toBe('string');
  });

  it('can be used as a Record key', () => {
    const handlers: Partial<Record<EventName, () => void>> = {
      [eventName('ORDER_FILLED')]: () => {},
    };
    expect(handlers['ORDER_FILLED']).toBeDefined();
  });
});

describe('assertEventName', () => {
  it('returns the value when non-null', () => {
    const result = assertEventName('ORDER_FILLED', 'test context');
    expect(result).toBe('ORDER_FILLED');
  });

  it('throws when value is null', () => {
    expect(() => assertEventName(null, 'unmapped CDC')).toThrow(
      'Event name resolution failed: unmapped CDC',
    );
  });

  it('throws when value is undefined', () => {
    expect(() => assertEventName(undefined, 'missing field')).toThrow(
      'Event name resolution failed: missing field',
    );
  });

  it('throws when value is empty string', () => {
    expect(() => assertEventName('', 'empty passthrough')).toThrow(
      'Event name resolution failed: empty passthrough',
    );
  });
});
