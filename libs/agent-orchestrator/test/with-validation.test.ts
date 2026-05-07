// libs/agent-core/test/with-validation.test.ts
import { withValidation } from '../src/with-validation';
import { ValidationError, type ValidationRule } from '../src/types';

describe('withValidation', () => {
  const passingRule: ValidationRule<{ value: string }> = {
    validate: (_output) => ({ valid: true, errors: [] }),
  };

  const failingRule: ValidationRule<{ value: string }> = {
    validate: (output) => ({
      valid: output.value.length > 0,
      errors: output.value.length > 0 ? [] : ['value must not be empty'],
    }),
  };

  it('passes output through when validation succeeds', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'hello' });
    const validated = withValidation(node, passingRule);
    const result = await validated({ input: 'test' });
    expect(result).toEqual({ value: 'hello' });
  });

  it('throws ValidationError when validation fails', async () => {
    const node = jest.fn().mockResolvedValue({ value: '' });
    const validated = withValidation(node, failingRule);
    await expect(validated({ input: 'test' })).rejects.toThrow(ValidationError);
    await expect(validated({ input: 'test' })).rejects.toThrow('value must not be empty');
  });

  it('calls the underlying node with the input', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'ok' });
    const validated = withValidation(node, passingRule);
    await validated({ some: 'state' });
    expect(node).toHaveBeenCalledWith({ some: 'state' }, undefined);
  });

  it('passes ctx={state, attempt} to the rule (attempt defaults to 0)', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'hello' });
    const validate = jest.fn().mockReturnValue({ valid: true, errors: [] });
    const rule = { validate };
    const validated = withValidation(node, rule);
    await validated({ input: 'test', operatingMode: 'CONSERVATIVE' });
    expect(validate).toHaveBeenCalledWith(
      { value: 'hello' },
      { state: { input: 'test', operatingMode: 'CONSERVATIVE' }, attempt: 0 },
    );
  });

  it('passes ctx.attempt from state.__retryAttempt when set', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'hello' });
    const validate = jest.fn().mockReturnValue({ valid: true, errors: [] });
    const rule = { validate };
    const validated = withValidation(node, rule);
    await validated({ input: 'test', __retryAttempt: 2 });
    expect(validate).toHaveBeenCalledWith(
      { value: 'hello' },
      { state: { input: 'test', __retryAttempt: 2 }, attempt: 2 },
    );
  });

  it('propagates result.feedback into the thrown ValidationError', async () => {
    const node = jest.fn().mockResolvedValue({ value: '' });
    const rule = {
      validate: () => ({
        valid: false,
        errors: ['empty value'],
        feedback: 'corrective: provide a non-empty value',
      }),
    };
    const validated = withValidation(node, rule);
    await expect(validated({ input: 'test' })).rejects.toMatchObject({
      name: 'ValidationError',
      errors: ['empty value'],
      feedback: 'corrective: provide a non-empty value',
    });
  });

  it('does not require result.feedback (backward-compatible)', async () => {
    const node = jest.fn().mockResolvedValue({ value: '' });
    const rule = {
      validate: () => ({ valid: false, errors: ['empty value'] }),
    };
    const validated = withValidation(node, rule);
    await expect(validated({ input: 'test' })).rejects.toMatchObject({
      name: 'ValidationError',
      errors: ['empty value'],
      feedback: undefined,
    });
  });
});
