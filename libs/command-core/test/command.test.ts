import { z } from 'zod';
import { defineCommand, applyCommand } from '../src/command';

interface CounterState {
  readonly count: number;
}

const IncrementSchema = z.object({ amount: z.number().positive() });
type IncrementPayload = z.infer<typeof IncrementSchema>;

const Increment = defineCommand<IncrementPayload, CounterState>({
  type: 'Increment',
  schema: IncrementSchema,
  apply: (state, payload) => ({ count: state.count + payload.amount }),
});

const ThrowingCommand = defineCommand<IncrementPayload, CounterState>({
  type: 'ThrowingCommand',
  schema: IncrementSchema,
  apply: () => {
    throw new Error('invariant violated');
  },
});

describe('defineCommand', () => {
  it('should return a frozen command definition', () => {
    expect(Object.isFrozen(Increment)).toBe(true);
    expect(Increment.type).toBe('Increment');
  });

  it('should preserve schema and apply function', () => {
    const result = Increment.apply({ count: 0 }, { amount: 5 });
    expect(result).toEqual({ count: 5 });
  });
});

describe('applyCommand', () => {
  it('should validate payload and apply to state on valid input', () => {
    const result = applyCommand(Increment, { amount: 3 }, { count: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nextState).toEqual({ count: 13 });
      expect(result.value.payload).toEqual({ amount: 3 });
    }
  });

  it('should return validation error for invalid payload', () => {
    const result = applyCommand(Increment, { amount: -1 }, { count: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('validation');
      expect(result.error.message).toBeDefined();
      expect((result.error as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    }
  });

  it('should return validation error for missing required fields', () => {
    const result = applyCommand(Increment, {}, { count: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('validation');
    }
  });

  it('should return validation error for wrong payload type', () => {
    const result = applyCommand(Increment, { amount: 'not-a-number' }, { count: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('validation');
    }
  });

  it('should return invariant error when apply throws', () => {
    const result = applyCommand(ThrowingCommand, { amount: 1 }, { count: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invariant');
      expect(result.error.message).toBe('invariant violated');
    }
  });

  it('should handle apply throwing a non-Error', () => {
    const BadCommand = defineCommand<IncrementPayload, CounterState>({
      type: 'BadCommand',
      schema: IncrementSchema,
      apply: () => {
        throw 'string-error'; // eslint-disable-line no-throw-literal
      },
    });
    const result = applyCommand(BadCommand, { amount: 1 }, { count: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invariant');
      expect(result.error.message).toBe('string-error');
    }
  });

  it('should strip extra fields from payload via Zod parsing', () => {
    const result = applyCommand(Increment, { amount: 2, extra: 'ignored' }, { count: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payload).toEqual({ amount: 2 });
    }
  });

  it('should not mutate the original state', () => {
    const original: CounterState = { count: 5 };
    const result = applyCommand(Increment, { amount: 3 }, original);
    expect(result.ok).toBe(true);
    expect(original.count).toBe(5);
  });
});
