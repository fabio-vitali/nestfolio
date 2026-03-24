import {
  BusEventSchema,
  RequestContextSchema,
  parseRequestContext,
} from '../../src/domain/schemas';
import { randomUUID } from 'crypto';

describe('BusEventSchema', () => {
  const validEvent = {
    id: randomUUID(),
    type: 'TEST_EVENT',
    timestamp: '2026-01-15T10:30:00.000Z',
    subject: { foo: 'bar' },
    context: { tenantId: randomUUID(), userId: randomUUID(), region: 'us-east-1' },
  };

  it('should parse a valid event', () => {
    const result = BusEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('TEST_EVENT');
      expect(result.data.context.tenantId).toBe(validEvent.context.tenantId);
    }
  });

  it('should reject an event with missing id', () => {
    const { id: _, ...noId } = validEvent;
    const result = BusEventSchema.safeParse(noId);
    expect(result.success).toBe(false);
  });

  it('should reject an event with invalid uuid for id', () => {
    const result = BusEventSchema.safeParse({ ...validEvent, id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('should reject an event with empty type', () => {
    const result = BusEventSchema.safeParse({ ...validEvent, type: '' });
    expect(result.success).toBe(false);
  });

  it('should reject an event with invalid timestamp', () => {
    const result = BusEventSchema.safeParse({
      ...validEvent,
      timestamp: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('should reject an event with missing context.tenantId', () => {
    const result = BusEventSchema.safeParse({
      ...validEvent,
      context: {},
    });
    expect(result.success).toBe(false);
  });

  it('should reject an event with invalid tenantId uuid', () => {
    const result = BusEventSchema.safeParse({
      ...validEvent,
      context: { tenantId: 'bad', userId: randomUUID(), region: 'us-east-1' },
    });
    expect(result.success).toBe(false);
  });
});

describe('RequestContextSchema', () => {
  it('should parse a valid request context', () => {
    const result = RequestContextSchema.safeParse({
      tenantId: randomUUID(),
      userId: randomUUID(),
      region: 'us-east-1',
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing tenantId', () => {
    const result = RequestContextSchema.safeParse({
      userId: randomUUID(),
      region: 'us-east-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing userId', () => {
    const result = RequestContextSchema.safeParse({
      tenantId: randomUUID(),
      region: 'us-east-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing region', () => {
    const result = RequestContextSchema.safeParse({
      tenantId: randomUUID(),
      userId: randomUUID(),
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid tenantId uuid', () => {
    const result = RequestContextSchema.safeParse({
      tenantId: 'bad',
      userId: randomUUID(),
      region: 'us-east-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('parseRequestContext', () => {
  it('should return branded RequestContext from valid input', () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const ctx = parseRequestContext({
      tenantId,
      userId,
      region: 'us-east-1',
    });
    expect(ctx.tenantId).toBe(tenantId);
    expect(ctx.userId).toBe(userId);
    expect(ctx.region).toBe('us-east-1');
  });

  it('should throw on invalid input', () => {
    expect(() => parseRequestContext({ tenantId: 'bad' })).toThrow();
  });
});
