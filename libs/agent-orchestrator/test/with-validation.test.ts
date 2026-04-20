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
});
