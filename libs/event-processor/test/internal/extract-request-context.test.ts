import { extractRequestContext } from '../../src/internal/extract-request-context';
import { randomUUID } from 'crypto';

describe('extractRequestContext', () => {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const region = 'us-east-1';

  it('should extract full RequestContext from event.context', () => {
    const ctx = extractRequestContext({
      context: { tenantId, userId, region },
      subject: {},
    });
    expect(ctx.tenantId).toBe(tenantId);
    expect(ctx.userId).toBe(userId);
    expect(ctx.region).toBe(region);
  });

  it('should throw NotRetryableError when tenantId is missing', () => {
    expect(() =>
      extractRequestContext({ context: { userId, region }, subject: {} }),
    ).toThrow('Missing tenantId');
  });

  it('should throw NotRetryableError when userId is missing', () => {
    expect(() =>
      extractRequestContext({ context: { tenantId, region }, subject: {} }),
    ).toThrow('Missing userId');
  });

  it('should throw NotRetryableError when region is missing', () => {
    expect(() =>
      extractRequestContext({ context: { tenantId, userId }, subject: {} }),
    ).toThrow('Missing region');
  });
});
