import { jitter } from './timing';

/**
 * Minimal PUBLIC surface of an AWS SDK v3 client needed to register middleware.
 *
 * Deliberately structural rather than `import`ing `@smithy/smithy-client`'s base
 * `Client`: different `@aws-sdk/client-*` versions in this workspace bundle
 * different `@smithy/smithy-client` versions, and `Client`'s PRIVATE `handlers`
 * field makes two such `Client` declarations nominally incompatible — so a
 * `Client`-typed constraint rejects any client built against a different smithy
 * version. Referencing only the public `middlewareStack` keeps this
 * version-agnostic. The `any`s mirror the SDK's own middleware typing.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- mirrors the SDK's own middleware-stack typing; only the public surface is referenced */
interface AwsClientLike {
  readonly middlewareStack: {
    add(
      middleware: (next: (args: any) => Promise<any>) => (args: any) => Promise<any>,
      options: {
        step: 'initialize';
        name: string;
        priority?: 'high' | 'normal' | 'low';
        tags?: string[];
        override?: boolean;
      },
    ): void;
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Shared AWS SDK client configuration for the integration / e2e test harness.
 *
 * Why this exists: under a high-parallelism `nx run-many -t test-integration`
 * sweep, ~20 suites (each a separate Jest worker process) fire their first
 * requests at once, flooding the macOS DNS resolver with concurrent
 * `getaddrinfo` lookups. The resolver transiently returns `ENOTFOUND` (e.g.
 * `<account>.ddb.us-east-1.amazonaws.com`), producing FALSE reds in the test
 * runner's OWN clients (see backlog `test-integration-parallel-dns-exhaustion`).
 * At `--parallel=1` the burst never happens and the reds vanish.
 *
 * Fix: a bounded retry on the transient resolver failures (see
 * {@link createTestAwsClient}). Connection pooling is already handled by the SDK
 * — `@smithy/node-http-handler` defaults to `keepAlive: true`, so sockets and
 * the DNS they resolved are reused per client; the gap was purely that a
 * transient `getaddrinfo` is NOT classified as retryable by the SDK's own retry
 * strategy, so it failed the assertion instead of retrying.
 *
 * This is for the TEST HARNESS only — product Lambdas configure their own clients.
 */
export const testAwsClientConfig = (region: string) => ({
  region,
  // The SDK does not retry `getaddrinfo ENOTFOUND` (see {@link isTransientDnsError});
  // this only adds headroom for throttling/transient HTTP errors under load.
  maxAttempts: 4,
});

const DNS_RETRY_ATTEMPTS = 5;
const DNS_RETRY_BASE_MS = 100;
const TRANSIENT_DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);
// Matches the message of a name-resolution failure even after it has been
// re-wrapped (see below).
const DNS_FAILURE_MESSAGE = /getaddrinfo (ENOTFOUND|EAI_AGAIN)/;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A `getaddrinfo ENOTFOUND` / `EAI_AGAIN` is a name-resolution failure: the
 * request never left the machine, so retrying it is always safe regardless of
 * the operation's idempotency. The SDK's retry strategy does NOT classify these
 * as retryable, which is why the harness retries them itself.
 *
 * Detection must be resilient to error re-wrapping. Under Jest's VM realms the
 * raw `getaddrinfo` error thrown by `node:net` fails BOTH `instanceof Error` and
 * `instanceof Object` inside `@smithy/middleware-retry`, so its `asSdkError`
 * helper re-wraps it as `new Error("AWS SDK error wrapper for Error: getaddrinfo
 * ENOTFOUND …")` — a plain Error with NO `.code`/`.syscall`. So we match the
 * structured shape when present, fall back to the message, and walk `.cause`.
 */
export function isTransientDnsError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (typeof current === 'string') return DNS_FAILURE_MESSAGE.test(current);
    if (typeof current !== 'object') return false;
    const e = current as { syscall?: unknown; code?: unknown; message?: unknown; cause?: unknown };
    if (e.syscall === 'getaddrinfo' && typeof e.code === 'string' && TRANSIENT_DNS_CODES.has(e.code)) return true;
    if (typeof e.message === 'string' && DNS_FAILURE_MESSAGE.test(e.message)) return true;
    current = e.cause;
  }
  return false;
}

interface DnsRetryOptions {
  /** Total attempts including the first. Defaults to {@link DNS_RETRY_ATTEMPTS}. */
  attempts?: number;
  /** Injectable for deterministic tests; defaults to a real `setTimeout` sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Wrap an async handler so transient DNS-resolution failures retry with jittered
 * exponential backoff. Non-DNS errors propagate immediately so real test
 * failures are never masked.
 */
export function retryTransientDns<A, R>(
  handler: (args: A) => Promise<R>,
  options: DnsRetryOptions = {},
): (args: A) => Promise<R> {
  const attempts = options.attempts ?? DNS_RETRY_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;
  return async (args: A): Promise<R> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await handler(args);
      } catch (error) {
        if (attempt >= attempts - 1 || !isTransientDnsError(error)) throw error;
        const delay = jitter(DNS_RETRY_BASE_MS * 2 ** attempt);
        // Harness observability: makes an absorbed DNS blip visible in CI / sweep logs.
        // eslint-disable-next-line no-console
        console.warn(`[test-support] transient DNS failure; retry ${attempt + 1}/${attempts - 1} after ${Math.round(delay)}ms`);
        await sleep(delay);
      }
    }
  };
}

/**
 * Install the transient-DNS retry onto a test AWS SDK client's middleware stack.
 * Added at the outermost (`initialize`) step so it wraps the SDK's own retry — a
 * DNS failure the SDK does not classify as retryable still gets retried here.
 */
export function installDnsRetry<C extends AwsClientLike>(client: C): C {
  // Some fixture unit tests `jest.mock()` the SDK clients; those auto-mocked
  // doubles have no middleware stack — and make no real network call — so there
  // is nothing to install. Real SDK clients always have it.
  if (typeof client.middlewareStack?.add !== 'function') return client;
  client.middlewareStack.add((next) => retryTransientDns(next), {
    step: 'initialize',
    priority: 'high',
    name: 'transientDnsRetry',
    tags: ['DNS_RETRY'],
    override: true,
  });
  return client;
}

/**
 * Build an AWS SDK client wired for the test harness: the SDK's default
 * keep-alive connection pool + a transient-DNS retry. Use this in place of
 * `new XClient({ region })` in every fixture.
 *
 * The client type `C` is inferred from the constructor's return, so a caller
 * gets back the concrete client (`DynamoDBClient`, `SSMClient`, …). The structural
 * `AwsClientLike` constraint (rather than the base `Client`) is what makes this
 * work uniformly across the workspace's mixed `@aws-sdk/client-*` versions.
 */
export function createTestAwsClient<C extends AwsClientLike>(
  ClientCtor: new (config: ReturnType<typeof testAwsClientConfig>) => C,
  region: string,
): C {
  const client = new ClientCtor(testAwsClientConfig(region));
  installDnsRetry(client);
  return client;
}
