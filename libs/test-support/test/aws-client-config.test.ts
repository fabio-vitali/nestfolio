import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

import {
  createTestAwsClient,
  installDnsRetry,
  isTransientDnsError,
  retryTransientDns,
  testAwsClientConfig,
} from '../src/aws-client-config';

const dnsError = (code: string): Error => Object.assign(new Error(`getaddrinfo ${code} host`), { code, syscall: 'getaddrinfo' });

const noSleep = { sleep: () => Promise.resolve() };

describe('isTransientDnsError', () => {
  it('is true for getaddrinfo ENOTFOUND / EAI_AGAIN', () => {
    expect(isTransientDnsError(dnsError('ENOTFOUND'))).toBe(true);
    expect(isTransientDnsError(dnsError('EAI_AGAIN'))).toBe(true);
  });

  it('detects the @smithy/middleware-retry asSdkError-wrapped form (message only, no code/syscall)', () => {
    // The real failure mode: under Jest VM realms the raw getaddrinfo error fails
    // instanceof Error AND instanceof Object inside @smithy/middleware-retry, so it
    // is re-wrapped as a plain Error whose message is the only surviving signal.
    const wrapped = new Error('AWS SDK error wrapper for Error: getaddrinfo ENOTFOUND events.us-east-1.amazonaws.com');
    expect((wrapped as { code?: unknown }).code).toBeUndefined();
    expect(isTransientDnsError(wrapped)).toBe(true);
  });

  it('detects a DNS failure nested in error.cause', () => {
    const outer = new Error('upstream failed', { cause: dnsError('ENOTFOUND') });
    expect(isTransientDnsError(outer)).toBe(true);
  });

  it('is false for non-DNS syscalls, other codes, and non-errors', () => {
    expect(isTransientDnsError(Object.assign(new Error('reset'), { code: 'ECONNRESET', syscall: 'read' }))).toBe(false);
    expect(isTransientDnsError(dnsError('ECONNREFUSED'))).toBe(false);
    expect(isTransientDnsError(new Error('plain'))).toBe(false);
    expect(isTransientDnsError(null)).toBe(false);
    expect(isTransientDnsError('ENOTFOUND')).toBe(false);
  });
});

describe('retryTransientDns', () => {
  it('retries a transient DNS failure and then succeeds, passing args through', async () => {
    let calls = 0;
    const wrapped = retryTransientDns(async (args: { id: string }) => {
      calls += 1;
      if (calls < 3) throw dnsError('ENOTFOUND');
      return `ok:${args.id}`;
    }, noSleep);

    await expect(wrapped({ id: 'x' })).resolves.toBe('ok:x');
    expect(calls).toBe(3);
  });

  it('retries the asSdkError-wrapped form (the real production failure path)', async () => {
    let calls = 0;
    const wrapped = new Error('AWS SDK error wrapper for Error: getaddrinfo ENOTFOUND events.us-east-1.amazonaws.com');
    const fn = retryTransientDns(async () => {
      calls += 1;
      if (calls < 2) throw wrapped;
      return 'ok';
    }, noSleep);

    await expect(fn(undefined)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('gives up after the attempt budget and rethrows the DNS error', async () => {
    let calls = 0;
    const wrapped = retryTransientDns(async () => {
      calls += 1;
      throw dnsError('ENOTFOUND');
    }, { attempts: 4, sleep: () => Promise.resolve() });

    await expect(wrapped(undefined)).rejects.toMatchObject({ code: 'ENOTFOUND' });
    expect(calls).toBe(4);
  });

  it('rethrows a non-DNS error immediately without retrying', async () => {
    let calls = 0;
    const wrapped = retryTransientDns(async () => {
      calls += 1;
      throw new Error('real failure');
    }, noSleep);

    await expect(wrapped(undefined)).rejects.toThrow('real failure');
    expect(calls).toBe(1);
  });
});

describe('testAwsClientConfig', () => {
  it('carries region and a bounded maxAttempts', () => {
    const cfg = testAwsClientConfig('us-east-1');
    expect(cfg.region).toBe('us-east-1');
    expect(cfg.maxAttempts).toBeGreaterThan(1);
  });
});

describe('installDnsRetry / createTestAwsClient', () => {
  it('registers the transient-DNS retry on a real client middleware stack', () => {
    const client = createTestAwsClient(DynamoDBClient, 'us-east-1');
    expect(client.middlewareStack.identify().some((entry) => entry.includes('transientDnsRetry'))).toBe(true);
    client.destroy();
  });

  it('installDnsRetry returns the same client instance it was given', () => {
    const client = new DynamoDBClient(testAwsClientConfig('us-east-1'));
    expect(installDnsRetry(client)).toBe(client);
    client.destroy();
  });
});
