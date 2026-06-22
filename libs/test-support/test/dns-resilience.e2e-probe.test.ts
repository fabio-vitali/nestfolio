import dns from 'node:dns';
import https from 'node:https';

import { installDnsResilience, uninstallDnsResilience } from '../src/dns-resilience';

/**
 * Deterministic end-to-end proof that the DNS retry (the REAL lib code) absorbs
 * transient getaddrinfo failures on a REAL network request — without relying on
 * the stochastic resolver-exhaustion burst actually recurring.
 *
 * Gated behind DNS_E2E_PROBE=1 (real network) so it never runs in normal CI.
 * Run: DNS_E2E_PROBE=1 pnpm nx run test-support:test
 */
const RUN = process.env.DNS_E2E_PROBE === '1';

(RUN ? describe : describe.skip)('dns-resilience e2e (real network — DNS_E2E_PROBE=1)', () => {
  it('absorbs 2 injected transient getaddrinfo failures on a real https request', async () => {
    const realLookup = dns.lookup;
    const failsLeft = new Map<string, number>();
    const INJECT = 2;

    // Inject INJECT transient failures per host, then delegate to the real resolver.
    // installDnsResilience() wraps THIS, so its retry must drive past the injected
    // failures for the request to ever connect.
    const faulty = ((hostname: string, optsOrCb: unknown, maybeCb?: unknown): void => {
      const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as (e: NodeJS.ErrnoException | null, ...r: unknown[]) => void;
      const remaining = failsLeft.get(hostname) ?? INJECT;
      if (remaining > 0) {
        failsLeft.set(hostname, remaining - 1);
        cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', syscall: 'getaddrinfo' }));
        return;
      }
      if (typeof optsOrCb === 'function') realLookup(hostname, cb);
      else realLookup(hostname, optsOrCb as dns.LookupOptions, cb);
    }) as unknown as typeof dns.lookup;

    dns.lookup = faulty;
    installDnsResilience();
    try {
      const statusCode = await new Promise<number>((resolve, reject) => {
        const req = https.get('https://dynamodb.us-east-1.amazonaws.com/', (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.setTimeout(15_000, () => req.destroy(new Error('probe timeout')));
      });
      // Any HTTP status means DNS resolved and the socket connected — i.e. the
      // retry drove past the 2 injected ENOTFOUNDs.
      expect(statusCode).toBeGreaterThan(0);
      expect(failsLeft.get('dynamodb.us-east-1.amazonaws.com')).toBe(0);
    } finally {
      uninstallDnsResilience();
      dns.lookup = realLookup;
    }
  }, 30_000);
});
