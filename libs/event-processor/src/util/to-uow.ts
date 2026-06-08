import type { EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import { pickRequestContext } from '../domain/schemas';
import type { UnitOfWork, BusEvent } from '../platform';

export function toUow(payload: EventPayload, ctx: EventContext): UnitOfWork<BusEvent<Record<string, unknown>>> {
  const event: BusEvent<Record<string, unknown>> = {
    id: ctx.eventId,
    type: ctx.eventType,
    timestamp: ctx.timestamp,
    subject: payload.subject as Record<string, unknown>,
    context: pickRequestContext(ctx),
  };
  return { event, payload: payload.subject as Record<string, unknown>, record: {} };
}
