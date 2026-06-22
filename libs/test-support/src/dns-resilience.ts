import dns from 'node:dns';

import { jitter } from './timing';

/**
 * Process-wide DNS resilience for the integration / e2e test harness.
 *
 * Why: a high-parallelism `nx run-many -t test-integration` sweep starts ~20
 * suites (each a separate Jest worker process) at once, flooding the macOS DNS
 * resolver with concurrent `getaddrinfo` lookups. The resolver transiently fails
 * with `ENOTFOUND` / `EAI_AGAIN` (e.g. `events.us-east-1.amazonaws.com`,
 * `…appsync-api.us-east-1.amazonaws.com`), producing FALSE reds in the test
 * runner's OWN AWS access — not product code (see backlog
 * `test-integration-parallel-dns-exhaustion`). At `--parallel=1` the burst never
 * happens and the reds vanish.
 *
 * Fix: wrap `dns.lookup` (and `dns.promises.lookup`) so a transient name-resolution
 * failure retries with jittered backoff before surfacing. A `getaddrinfo` failure
 * means the request never left the machine, so retrying is always safe regardless
 * of the operation's idempotency.
 *
 * Why at the DNS layer (not per client): `node:net`'s `connect` resolves the
 * `dns.lookup` PROPERTY at call time, so patching it transparently covers BOTH
 * the AWS SDK v3 clients (`https` → `net.connect`) AND global `fetch`/undici —
 * every AWS access path in the harness, including raw-SigV4 `fetch` clients and
 * any directly-constructed SDK client, with no per-client wiring. The SDK's own
 * retry strategy does NOT classify `getaddrinfo` errors as retryable, which is
 * why the harness must.
 *
 * TEST HARNESS ONLY — product Lambdas are unaffected. Install once per worker
 * process from the Jest setup file; {@link uninstallDnsResilience} restores the
 * originals.
 */

const DNS_RETRY_ATTEMPTS = 5;
const DNS_RETRY_BASE_MS = 100;
const TRANSIENT_DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);

/** A transient name-resolution failure code (the request never left the machine). */
export function isTransientDnsCode(code: unknown): code is string {
  return typeof code === 'string' && TRANSIENT_DNS_CODES.has(code);
}

const backoffMs = (attempt: number): number => jitter(DNS_RETRY_BASE_MS * 2 ** attempt);

const logRetry = (hostname: string, code: string, attempt: number, delay: number): void => {
  // Harness observability: makes an absorbed DNS blip visible in CI / sweep logs.
  // eslint-disable-next-line no-console
  console.warn(`[test-support] transient DNS (${code}) for ${hostname}; retry ${attempt}/${DNS_RETRY_ATTEMPTS - 1} after ${Math.round(delay)}ms`);
};

let originalLookup: typeof dns.lookup | undefined;
let originalPromisesLookup: typeof dns.promises.lookup | undefined;

/** Install the DNS retry wrappers. Idempotent. */
export function installDnsResilience(): void {
  if (originalLookup) return;
  originalLookup = dns.lookup;
  originalPromisesLookup = dns.promises.lookup;
  const base = originalLookup;
  const basePromises = originalPromisesLookup;

  // Callback form — the one `net.connect` (AWS SDK https) and undici (fetch) use.
  function patchedLookup(hostname: string, optionsOrCallback: unknown, maybeCallback?: unknown): void {
    const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as (
      err: NodeJS.ErrnoException | null,
      ...rest: unknown[]
    ) => void;
    const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;

    let attempt = 0;
    const run = (): void => {
      const onResult = (err: NodeJS.ErrnoException | null, ...rest: unknown[]): void => {
        if (err && isTransientDnsCode(err.code) && attempt < DNS_RETRY_ATTEMPTS - 1) {
          const delay = backoffMs(attempt);
          attempt += 1;
          logRetry(hostname, err.code, attempt, delay);
          setTimeout(run, delay);
          return;
        }
        callback(err, ...rest);
      };
      if (options === undefined) base(hostname, onResult);
      else base(hostname, options as dns.LookupOptions, onResult);
    };
    run();
  }
  // Monkey-patching a built-in with many overloads — one localized cast is unavoidable.
  dns.lookup = patchedLookup as typeof dns.lookup;

  async function patchedPromisesLookup(hostname: string, options?: unknown): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return options === undefined
          ? await basePromises(hostname)
          : await basePromises(hostname, options as dns.LookupOptions);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt >= DNS_RETRY_ATTEMPTS - 1 || !isTransientDnsCode(code)) throw err;
        const delay = backoffMs(attempt);
        logRetry(hostname, code, attempt + 1, delay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  dns.promises.lookup = patchedPromisesLookup as typeof dns.promises.lookup;
}

/** Restore the original `dns.lookup` / `dns.promises.lookup`. Idempotent. */
export function uninstallDnsResilience(): void {
  if (originalLookup) dns.lookup = originalLookup;
  if (originalPromisesLookup) dns.promises.lookup = originalPromisesLookup;
  originalLookup = undefined;
  originalPromisesLookup = undefined;
}
