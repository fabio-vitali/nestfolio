// libs/agent-core/test/types.test.ts
import { ValidationError } from '../src/types';

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
