import { tracer } from './tracer';

/**
 * Adds X-Ray annotations for the current event being processed.
 * Call this in event handlers to enable filtering traces by event type, tenant, and user.
 */
export function traceEvent(eventType: string, eventId: string, tenantId?: string, userId?: string): void {
  try {
    tracer.putAnnotation('EventType', eventType);
    tracer.putAnnotation('EventId', eventId);
    if (tenantId) {
      tracer.putAnnotation('TenantId', tenantId);
    }
    if (userId) {
      tracer.putAnnotation('UserId', userId);
    }
  } catch {
    // Silently ignore tracing errors (e.g., when running locally without X-Ray daemon)
  }
}
