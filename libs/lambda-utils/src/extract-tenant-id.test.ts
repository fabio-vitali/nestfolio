jest.mock('@nestfolio/platform-core', () => ({
  NotRetryableError: class NotRetryableError extends Error {
    constructor(
      public readonly message: string,
      public readonly details?: Record<string, unknown>,
    ) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },
}));

import { extractTenantId } from './extract-tenant-id';

describe('extractTenantId', () => {
  it('should extract tenantId from context', () => {
    const event = {
      id: 'evt-1',
      type: 'TEST',
      context: { tenantId: 'tenant-1' },
      subject: { orderId: 'o1' },
    };

    expect(extractTenantId(event)).toBe('tenant-1');
  });

  it('should fall back to subject.tenantId when context.tenantId is missing', () => {
    const event = {
      id: 'evt-2',
      type: 'TEST',
      context: {},
      subject: { tenantId: 'tenant-from-subject' },
    };

    expect(extractTenantId(event)).toBe('tenant-from-subject');
  });

  it('should throw NotRetryableError when tenantId is missing from both context and subject', () => {
    const event = {
      id: 'evt-3',
      type: 'TEST',
      context: {},
      subject: { orderId: 'o1' },
    };

    expect(() => extractTenantId(event)).toThrow('Missing tenantId');
  });

  it('should throw NotRetryableError when tenantId is not a string', () => {
    const event = {
      id: 'evt-4',
      type: 'TEST',
      context: { tenantId: 123 },
      subject: {},
    };

    expect(() => extractTenantId(event)).toThrow('Missing tenantId');
  });

  it('should throw NotRetryableError when context and subject are undefined', () => {
    const event = {
      id: 'evt-5',
      type: 'TEST',
    };

    expect(() => extractTenantId(event)).toThrow('Missing tenantId');
  });
});
