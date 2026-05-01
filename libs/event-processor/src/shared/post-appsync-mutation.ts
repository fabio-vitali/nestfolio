import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { logger } from '../internal';

export interface PostAppSyncMutationArgs {
  appsyncUrl: string;
  region?: string;
  mutation: string;
  variables: Record<string, unknown>;
}

/**
 * SigV4-signed POST to AppSync. Used by broadcast pipelines to fire
 * @aws_iam-protected mutations that trigger @aws_subscribe broadcasts.
 *
 * Behavior contract (matches dashboard-publisher precedent shipped 2026-04-30):
 * - Missing appsyncUrl: warn + return (no throw).
 * - HTTP non-2xx: log + return (no throw).
 * - GraphQL errors[]: log + return (no throw).
 *
 * Broadcast loss is non-fatal — the engine's at-least-once retry budget
 * is reserved for genuinely transient failures, not silent broadcast drops.
 */
export async function postAppSyncMutation(args: PostAppSyncMutationArgs): Promise<void> {
  const { appsyncUrl, region = 'us-east-1', mutation, variables } = args;
  if (!appsyncUrl) {
    logger.warn('postAppSyncMutation: appsyncUrl empty — skipping');
    return;
  }

  const url = new URL(appsyncUrl);
  const body = JSON.stringify({ query: mutation, variables });

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service: 'appsync',
    sha256: Sha256,
  });

  const signed = await signer.sign({
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    protocol: url.protocol,
    headers: { 'Content-Type': 'application/json', host: url.hostname },
    body,
  });

  // SignatureV4 returns "authorization" (lowercase); promote to "Authorization"
  // so callers see the canonical header name. All other signed headers remain as-is.
  const rawHeaders = signed.headers as Record<string, string>;
  const normalizedHeaders: Record<string, string> = {
    ...rawHeaders,
    ...(rawHeaders['authorization'] !== undefined && {
      Authorization: rawHeaders['authorization'],
    }),
  };
  delete normalizedHeaders['authorization'];

  const response = await fetch(appsyncUrl, {
    method: 'POST',
    headers: normalizedHeaders,
    body,
  });

  if (!response.ok) {
    logger.error('postAppSyncMutation: HTTP failure', { status: response.status });
    return;
  }
  const json = (await response.json()) as { errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    logger.error('postAppSyncMutation: GraphQL errors', { errors: json.errors });
  }
}
