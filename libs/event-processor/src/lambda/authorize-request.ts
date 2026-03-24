import { AppSyncResolverEvent } from 'aws-lambda';
import { NotRetryableError } from '../internal';
import type { RequestContext } from '../domain/schemas';
import { asTenantId, asUserId } from '../platform/types/branded';

/**
 * Extracts and validates RequestContext from an AppSync resolver event's Cognito claims.
 * Throws NotRetryableError if tenantId or userId is missing.
 *
 * @param event - The AppSync resolver event
 * @param region - AWS region, injected via requireEnv('AWS_REGION') at wiring
 * @returns RequestContext with branded TenantId and UserId
 */
export function authorizeRequest(
  event: AppSyncResolverEvent<Record<string, unknown>>,
  region: string,
): RequestContext {
  const claims = event.identity as Record<string, unknown> | undefined;
  const claimsMap = claims?.['claims'] as Record<string, string> | undefined;
  const tenantId = claimsMap?.['custom:tenant_id'];
  const userId = claimsMap?.['sub'];

  if (!tenantId) {
    throw new NotRetryableError('UNAUTHORIZED: missing tenantId');
  }
  if (!userId) {
    throw new NotRetryableError('UNAUTHORIZED: missing userId');
  }

  return {
    tenantId: asTenantId(tenantId),
    userId: asUserId(userId),
    region,
  };
}
