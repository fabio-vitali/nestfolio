import { z } from 'zod';
import { validateIncomingEvent } from '../src/validation';
import { type BusEvent } from '../src/bus';
import { logger } from '../src/logger';

jest.spyOn(logger, 'error').mockImplementation();

describe('validateIncomingEvent', () => {
  const TestEventSchema = z.object({
    id: z.string(),
    type: z.literal('TEST_EVENT'),
    timestamp: z.string(),
    subject: z.object({
      value: z.number().positive(),
    }),
    context: z.object({
      tenantId: z.string(),
    }),
  });

  it('should return valid=true for a conforming event', () => {
    const event: BusEvent = {
      id: 'evt-1',
      type: 'TEST_EVENT',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: { value: 42 },
      context: { tenantId: 't-1' },
    };

    const result = validateIncomingEvent(event, TestEventSchema);

    expect(result.valid).toBe(true);
    expect(result.data).toEqual(event);
    expect(result.error).toBeUndefined();
  });

  it('should return valid=false for a non-conforming event', () => {
    const event: BusEvent = {
      id: 'evt-2',
      type: 'TEST_EVENT',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: { value: -1 }, // negative — fails positive() check
      context: { tenantId: 't-1' },
    };

    const result = validateIncomingEvent(event, TestEventSchema);

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.issues.length).toBeGreaterThan(0);
  });

  it('should return valid=false for wrong event type', () => {
    const event: BusEvent = {
      id: 'evt-3',
      type: 'WRONG_TYPE',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: { value: 1 },
      context: { tenantId: 't-1' },
    };

    const result = validateIncomingEvent(event, TestEventSchema);

    expect(result.valid).toBe(false);
  });
});
