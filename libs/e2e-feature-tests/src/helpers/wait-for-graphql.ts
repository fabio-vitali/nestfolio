import type { AppSyncClient } from '@nestfolio/integration-testing';

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Poll a GraphQL query until `predicate(result) === true` or timeout.
 * Defaults: 60 s timeout, 2 s interval. Used for every assertion that
 * depends on CDC -> read-model projection lag.
 */
export async function waitForGraphQL<T>(
  client: AppSyncClient,
  operation: string,
  variables: Record<string, unknown>,
  predicate: (result: T) => boolean,
  opts: WaitOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await client.query<T>(operation, variables);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForGraphQL timed out after ${timeoutMs}ms. Last result: ${JSON.stringify(last)}`,
  );
}
