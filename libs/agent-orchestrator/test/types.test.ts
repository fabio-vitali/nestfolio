// libs/agent-core/test/types.test.ts
import { ValidationError } from '../src/types';
import type { ValidationContext, ValidationResult, ValidationRule } from '../src/types';

describe('types', () => {
  describe('ValidationError', () => {
    it('is an instance of Error', () => {
      const err = new ValidationError(['field required']);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ValidationError');
      expect(err.errors).toEqual(['field required']);
      expect(err.message).toBe('Validation failed: field required');
    });

    it('joins multiple errors', () => {
      const err = new ValidationError(['err1', 'err2']);
      expect(err.message).toBe('Validation failed: err1; err2');
    });
  });
});

describe('ValidationError feedback overload', () => {
  it('constructs with errors only (backward-compatible)', () => {
    const e = new ValidationError(['oops']);
    expect(e.errors).toEqual(['oops']);
    expect(e.feedback).toBeUndefined();
    expect(e.message).toContain('oops');
  });

  it('constructs with errors + opts.feedback', () => {
    const e = new ValidationError(['oops'], { feedback: 'try again differently' });
    expect(e.errors).toEqual(['oops']);
    expect(e.feedback).toBe('try again differently');
  });
});

describe('ValidationContext + ValidationRule signature', () => {
  it('ValidationRule accepts a single-arg validate (backward-compatible)', () => {
    const rule: ValidationRule<{ v: string }> = {
      validate: (output) => ({ valid: output.v.length > 0, errors: [] }),
    };
    expect(rule.validate({ v: 'x' }).valid).toBe(true);
  });

  it('ValidationRule accepts a (output, ctx) validate that reads ctx.state + ctx.attempt', () => {
    const rule: ValidationRule<{ v: string }> = {
      validate: (output, ctx) => {
        const mode = ctx?.state['operatingMode'] as string | undefined;
        const attempt = ctx?.attempt ?? -1;
        return {
          valid: output.v === mode,
          errors: output.v === mode ? [] : [`wrong mode at attempt ${attempt}`],
          feedback: output.v === mode ? undefined : `expected ${mode}, got ${output.v}`,
        };
      },
    };
    const ctx: ValidationContext = { state: { operatingMode: 'CONSERVATIVE' }, attempt: 1 };
    const result: ValidationResult = rule.validate({ v: 'BALANCED' }, ctx);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('attempt 1');
    expect(result.feedback).toBe('expected CONSERVATIVE, got BALANCED');
  });
});
