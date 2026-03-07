import { ZodSchema, type ZodError } from 'zod';
import { type BusEvent, type Bus } from './bus';
import { logger } from './logger';
import { getUUID, getTime } from './core';

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

/**
 * Highland.js stream operator that validates and filters events.
 * Invalid events are published as error events and dropped from the stream.
 */
export function withSchemaValidation<T>(
  schema: ZodSchema<T>,
  bus: Bus,
  errorEventType: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const _ = require('highland') as HighlandStatic;

  return (source: Highland.Stream<{ event: BusEvent; [key: string]: unknown }>) =>
    source.flatMap((uow) => {
      const result = validateIncomingEvent(uow.event, schema);
      if (result.valid) {
        return _([uow]);
      }
      // Publish error event, drop from stream (message goes to DLQ via SQS)
      return _(
        bus
          .publish({
            id: getUUID(),
            type: errorEventType,
            timestamp: getTime(),
            error: {
              name: 'SchemaValidationError',
              message: `Event ${uow.event.type} failed consumer schema validation`,
              details: { eventId: uow.event.id, issues: result.error!.issues },
            },
          })
          .then(() => []),
      ).flatten();
    });
}
