import { parseError, isGraphQLErrorResponse } from './parse-error';

describe('isGraphQLErrorResponse', () => {
  it('returns true for valid GraphQL error response', () => {
    expect(isGraphQLErrorResponse({ errors: [{ message: 'fail' }] })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isGraphQLErrorResponse(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isGraphQLErrorResponse(undefined)).toBe(false);
  });

  it('returns false for plain object without errors', () => {
    expect(isGraphQLErrorResponse({ data: null })).toBe(false);
  });

  it('returns false for empty errors array', () => {
    expect(isGraphQLErrorResponse({ errors: [] })).toBe(false);
  });

  it('returns false for non-array errors', () => {
    expect(isGraphQLErrorResponse({ errors: 'string' })).toBe(false);
  });
});

describe('parseError', () => {
  it('returns i18n key for Unauthorized errorType', () => {
    const error = { errors: [{ errorType: 'Unauthorized', message: 'Not allowed' }] };
    expect(parseError(error)).toBe('errors.unauthorized');
  });

  it('returns i18n key for ValidationError errorType', () => {
    const error = { errors: [{ errorType: 'ValidationError', message: 'Bad input' }] };
    expect(parseError(error)).toBe('errors.validation');
  });

  it('returns i18n key for ConditionalCheckFailedException', () => {
    const error = { errors: [{ errorType: 'ConditionalCheckFailedException', message: 'Conflict' }] };
    expect(parseError(error)).toBe('errors.conflict');
  });

  it('returns i18n key for ThrottlingException', () => {
    const error = { errors: [{ errorType: 'ThrottlingException', message: 'Too fast' }] };
    expect(parseError(error)).toBe('errors.throttled');
  });

  it('returns message for unknown errorType', () => {
    const error = { errors: [{ errorType: 'UnknownType', message: 'Something happened' }] };
    expect(parseError(error)).toBe('Something happened');
  });

  it('returns message when no errorType', () => {
    const error = { errors: [{ message: 'Field not found' }] };
    expect(parseError(error)).toBe('Field not found');
  });

  it('returns fallbackKey when message is empty', () => {
    const error = { errors: [{ message: '' }] };
    expect(parseError(error)).toBe('errors.unexpected');
  });

  it('returns custom fallbackKey when message is empty', () => {
    const error = { errors: [{ message: '' }] };
    expect(parseError(error, 'custom.fallback')).toBe('custom.fallback');
  });

  it('returns Error.message for Error instances', () => {
    expect(parseError(new Error('Network failure'))).toBe('Network failure');
  });

  it('returns fallbackKey for non-Error, non-GraphQL values', () => {
    expect(parseError('string error')).toBe('errors.unexpected');
    expect(parseError(42)).toBe('errors.unexpected');
    expect(parseError(null)).toBe('errors.unexpected');
    expect(parseError(undefined)).toBe('errors.unexpected');
  });

  it('uses first error from errors array', () => {
    const error = {
      errors: [
        { errorType: 'Unauthorized', message: 'First' },
        { errorType: 'ValidationError', message: 'Second' },
      ],
    };
    expect(parseError(error)).toBe('errors.unauthorized');
  });
});
