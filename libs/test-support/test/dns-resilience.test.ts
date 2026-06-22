import dns from 'node:dns';

import { installDnsResilience, uninstallDnsResilience, isTransientDnsCode } from '../src/dns-resilience';

const dnsError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`getaddrinfo ${code} host`), { code, syscall: 'getaddrinfo' });

// Invoke the (patched) callback-form dns.lookup as a promise.
const lookup = (hostname: string): Promise<string> =>
  new Promise((resolve, reject) => {
    (dns.lookup as unknown as (h: string, cb: (e: Error | null, a?: string) => void) => void)(
      hostname,
      (err, addr) => (err ? reject(err) : resolve(addr as string)),
    );
  });

describe('isTransientDnsCode', () => {
  it('is true only for getaddrinfo ENOTFOUND / EAI_AGAIN', () => {
    expect(isTransientDnsCode('ENOTFOUND')).toBe(true);
    expect(isTransientDnsCode('EAI_AGAIN')).toBe(true);
    expect(isTransientDnsCode('ECONNREFUSED')).toBe(false);
    expect(isTransientDnsCode(undefined)).toBe(false);
  });
});

describe('installDnsResilience', () => {
  let realLookup: typeof dns.lookup;

  beforeEach(() => {
    realLookup = dns.lookup;
  });

  afterEach(() => {
    uninstallDnsResilience();
    dns.lookup = realLookup; // restore the fake we may have swapped in pre-install
  });

  // The patched lookup is exercised via a fake "original" that fails a fixed
  // number of times before resolving — no real network.
  const installWithFake = (fake: typeof dns.lookup): void => {
    dns.lookup = fake;
    installDnsResilience();
  };

  it('retries a transient getaddrinfo failure, then resolves', async () => {
    let calls = 0;
    installWithFake(((hostname: string, optsOrCb: unknown, maybeCb?: unknown): void => {
      const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as (e: Error | null, a?: string, f?: number) => void;
      calls += 1;
      if (calls < 3) cb(dnsError('ENOTFOUND'));
      else cb(null, '1.2.3.4', 4);
    }) as unknown as typeof dns.lookup);

    await expect(lookup('example.com')).resolves.toBe('1.2.3.4');
    expect(calls).toBe(3);
  });

  it('does NOT retry a non-transient error — surfaces it on the first attempt', async () => {
    let calls = 0;
    installWithFake(((hostname: string, optsOrCb: unknown, maybeCb?: unknown): void => {
      const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as (e: Error | null) => void;
      calls += 1;
      cb(Object.assign(new Error('refused'), { code: 'ECONNREFUSED', syscall: 'getaddrinfo' }));
    }) as unknown as typeof dns.lookup);

    await expect(lookup('example.com')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(calls).toBe(1);
  });

  it('uninstall restores the original lookup', () => {
    const sentinel = ((): void => undefined) as unknown as typeof dns.lookup;
    dns.lookup = sentinel;
    installDnsResilience();
    expect(dns.lookup).not.toBe(sentinel);
    uninstallDnsResilience();
    expect(dns.lookup).toBe(sentinel);
  });
});
