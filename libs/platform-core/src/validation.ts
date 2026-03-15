import { ZodSchema, type ZodError } from 'zod';
import { type BusEvent } from './bus';
import { logger } from './logger';

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  error?: ZodError;
}

/**
 * Validates an incoming event against the producer's exported Zod schema.
 * Used in Ingress handlers before passing events to the pipeline.
 */
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

