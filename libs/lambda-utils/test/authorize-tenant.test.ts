import { AppSyncResolverEvent } from 'aws-lambda';

jest.mock('@nestfolio/platform-core', () => ({
  NotRetryableError: class NotRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },
}));

import { authorizeTenant } from '../src/authorize-tenant';

function buildEvent(
  tenantId?: string,
): AppSyncResolverEvent<Record<string, unknown>> {
  const claims: Record<string, string> = {};
  if (tenantId !== undefined) {
    claims['custom:tenant_id'] = tenantId;
  }
  return {
    info: { fieldName: 'test', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
    arguments: {},
    identity: { claims },
    source: null,
    request: { headers: {} },
    prev: null,
    stash: {},
  } as unknown as AppSyncResolverEvent<Record<string, unknown>>;
}

describe('authorizeTenant', () => {
  it('should return tenantId when present in claims', () => {
    const event = buildEvent('tenant-123');
    expect(authorizeTenant(event)).toBe('tenant-123');
  });

  it('should throw NotRetryableError when tenantId is missing from claims', () => {
    const event = buildEvent(undefined);
    expect(() => authorizeTenant(event)).toThrow('UNAUTHORIZED: missing tenantId');
  });

  it('should throw NotRetryableError when tenantId is empty string', () => {
    const event = buildEvent('');
    expect(() => authorizeTenant(event)).toThrow('UNAUTHORIZED: missing tenantId');
  });

  it('should throw NotRetryableError when identity is undefined', () => {
    const event = {
      info: { fieldName: 'test', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
      arguments: {},
      identity: undefined,
      source: null,
      request: { headers: {} },
      prev: null,
      stash: {},
    } as unknown as AppSyncResolverEvent<Record<string, unknown>>;

    expect(() => authorizeTenant(event)).toThrow('UNAUTHORIZED: missing tenantId');
  });
});
