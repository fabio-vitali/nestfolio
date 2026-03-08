import { AppSyncResolverEvent } from 'aws-lambda';
import { NotRetryableError } from '@nestfolio/platform-core';

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
