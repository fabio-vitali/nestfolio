import { ErrorEventSubjectSchema } from '../../src';

describe('ErrorEventSubjectSchema', () => {
  it('parses the shape ErrorEventPublisher emits (with groupKey)', () => {
    const subject = {
      error: 'boom',
      stack: 'Error: boom\n    at x',
      causedBy: { name: 'TypeError' },
      groupKey: 'tenant#123',
    };
    expect(ErrorEventSubjectSchema.parse(subject)).toEqual(subject);
  });

  it('parses without optional stack/groupKey', () => {
    const subject = { error: 'boom', causedBy: undefined };
    const parsed = ErrorEventSubjectSchema.parse(subject);
    expect(parsed.error).toBe('boom');
    expect(parsed.causedBy).toBeUndefined();
    expect(parsed.groupKey).toBeUndefined();
  });

  it('rejects a missing error message', () => {
    expect(() => ErrorEventSubjectSchema.parse({ causedBy: 1 })).toThrow();
  });
});
