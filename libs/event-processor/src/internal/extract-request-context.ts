import { NotRetryableError } from './errors';
import type { RequestContext } from '../domain/schemas';
import { asTenantId, asUserId } from '../platform/types/branded';

/**
 * Extracts RequestContext from a domain event's context field.
 * Throws NotRetryableError if any required field is missing.
 */
export function extractRequestContext(event: Record<string, unknown>): RequestContext {
  const context = event.context as Record<string, unknown> | undefined;

  const tenantId = context?.tenantId;
  const userId = context?.userId;
  const region = context?.region;

  if (!tenantId || typeof tenantId !== 'string') {
    throw new NotRetryableError('Missing tenantId in event context');
  }
  if (!userId || typeof userId !== 'string') {
    throw new NotRetryableError('Missing userId in event context');
  }
  if (!region || typeof region !== 'string') {
    throw new NotRetryableError('Missing region in event context');
  }

  return {
    tenantId: asTenantId(tenantId),
    userId: asUserId(userId),
    region,
  };
}
