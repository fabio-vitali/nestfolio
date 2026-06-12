import { z, type ZodTypeAny } from 'zod';
import type { EventPayload } from '../types/handler-config';
import type { UnitOfWork, BusEvent } from '../platform';

/**
 * Validate and type an event's subject at the consumer's deserialization seam.
 *
 * Accepts a UnitOfWork (reads `uow.event.subject`), a bare `BusEvent` (reads
 * `event.subject`), or an EventPayload (reads `payload.subject`), runs
 * `schema.parse`, and returns the inferred type. Throws `ZodError` on a contract
 * violation — the producer emitted a shape that does not match its own declared
 * contract — which the event-processor poison-pill / DLQ path then catches.
 *
 * The `'event' in carrier` guard uniquely identifies the UnitOfWork (neither
 * BusEvent nor EventPayload has an `.event` field); BusEvent and EventPayload both
 * expose `.subject`, so the else-branch handles both — no cast needed at the call
 * site for a bare BusEvent carrier (e.g. an SF trigger event).
 *
 * This is the only place a consumer should read `event.subject`. Importing the
 * producer's schema makes a payload-shape change a compile error (z.infer field
 * reads) and a runtime error (this parse).
 */
export function parseSubject<S extends ZodTypeAny>(
  carrier: UnitOfWork<BusEvent<unknown>> | BusEvent<unknown> | EventPayload,
  schema: S,
): z.infer<S> {
  const subject = 'event' in carrier ? carrier.event.subject : carrier.subject;
  return schema.parse(subject) as z.infer<S>;
}
