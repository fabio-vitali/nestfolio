import { AppSyncResolverEvent } from 'aws-lambda';
import { NotRetryableError } from '../internal';

/**
 * Extracts and validates the tenantId from an AppSync resolver event's Cognito claims.
 * Throws NotRetryableError if the tenantId is missing or empty.
 *
 * @returns The validated tenantId string
 */
export function authorizeTenant(
  event: AppSyncResolverEvent<Record<string, unknown>>,
): string {
  const claims = event.identity as Record<string, unknown> | undefined;
  const tenantId = (claims?.['claims'] as Record<string, string>)?.['custom:tenant_id'];

  if (!tenantId) {
    throw new NotRetryableError('UNAUTHORIZED: missing tenantId');
  }

  return tenantId;
}

export type AuthorizedIdentity = {
  tenantId: string;
  userId: string;
};

/**
 * Extracts and validates both tenantId and userId from Cognito claims.
 * userId is extracted from the 'sub' claim.
 * Throws NotRetryableError if either value is missing.
 */
export function authorizeUser(
  event: AppSyncResolverEvent<Record<string, unknown>>,
): AuthorizedIdentity {
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

  return { tenantId, userId };
}
