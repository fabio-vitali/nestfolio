import type { AppSyncResolverEvent } from 'aws-lambda';
import { authorizeRequest } from '../../src/lambda/authorize-request';

describe('authorizeRequest', () => {
  const mockEvent = (tenantId?: string, sub?: string): AppSyncResolverEvent<Record<string, unknown>> => ({
    identity: {
      claims: {
        ...(tenantId ? { 'custom:tenant_id': tenantId } : {}),
        ...(sub ? { sub } : {}),
      },
      defaultAuthStrategy: 'ALLOW',
      groups: null,
      issuer: '',
      sourceIp: ['127.0.0.1'],
      sub: sub ?? '',
      username: sub ?? '',
    },
    info: { fieldName: 'test', selectionSetGraphQL: '', selectionSetList: [], parentTypeName: 'Query', variables: {} },
    arguments: {},
    source: null,
    request: { headers: {}, domainName: null },
    prev: null,
    stash: {},
  });

  it('should return RequestContext with branded types', () => {
    const ctx = authorizeRequest(mockEvent('tenant-123', 'user-456'), 'us-east-1');
    expect(ctx.tenantId).toBe('tenant-123');
    expect(ctx.userId).toBe('user-456');
    expect(ctx.region).toBe('us-east-1');
  });

  it('should throw NotRetryableError when tenantId is missing', () => {
    expect(() => authorizeRequest(mockEvent(undefined, 'user-456'), 'us-east-1'))
      .toThrow('UNAUTHORIZED: missing tenantId');
  });

  it('should throw NotRetryableError when userId is missing', () => {
    expect(() => authorizeRequest(mockEvent('tenant-123', undefined), 'us-east-1'))
      .toThrow('UNAUTHORIZED: missing userId');
  });
});
