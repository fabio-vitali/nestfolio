import { ZodSchema, type ZodError } from 'zod';
import { type BusEvent } from './bus';
import { logger } from '../internal';

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  error?: ZodError;
}

export function validateIncomingEvent<T>(
  event: BusEvent,
  schema: ZodSchema<T>,
): ValidationResult<T> {
  const result = schema.safeParse(event);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  logger.error('Consumer-side schema validation failed', {
    eventType: event.type,
    eventId: event.id,
    errors: result.error.issues,
  });
  return { valid: false, error: result.error };
}
