import { BusEventSchema, TenantContextSchema } from '../../src/domain/schemas';
import { randomUUID } from 'crypto';

describe('BusEventSchema', () => {
  const validEvent = {
    id: randomUUID(),
    type: 'TEST_EVENT',
    timestamp: '2026-01-15T10:30:00.000Z',
    subject: { foo: 'bar' },
    context: { tenantId: randomUUID() },
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
      context: { tenantId: 'bad' },
    });
    expect(result.success).toBe(false);
  });
});

describe('TenantContextSchema', () => {
  it('should parse a valid tenant context', () => {
    const result = TenantContextSchema.safeParse({
      tenantId: randomUUID(),
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing tenantId', () => {
    const result = TenantContextSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
