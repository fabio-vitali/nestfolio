import { tracer } from './tracer';

/**
 * Adds X-Ray annotations for the current event being processed.
 * Call this in event handlers to enable filtering traces by event type and tenant.
 */
export function traceEvent(eventType: string, eventId: string, tenantId?: string): void {
  try {
    tracer.putAnnotation('EventType', eventType);
    tracer.putAnnotation('EventId', eventId);
    if (tenantId) {
      tracer.putAnnotation('TenantId', tenantId);
    }
  } catch {
    // Silently ignore tracing errors (e.g., when running locally without X-Ray daemon)
  }
}
