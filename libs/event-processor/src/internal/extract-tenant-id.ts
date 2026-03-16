import { NotRetryableError } from './errors';

/**
 * Extracts tenantId from a domain event, checking context first then subject as fallback.
 * Throws NotRetryableError if tenantId is missing or not a string.
 */
export function extractTenantId(event: Record<string, unknown>): string {
  const context = event.context as Record<string, unknown> | undefined;
  const subject = event.subject as Record<string, unknown> | undefined;

  const id = context?.tenantId ?? subject?.tenantId;

  if (!id || typeof id !== 'string') {
    throw new NotRetryableError('Missing tenantId');
  }

  return id;
}
