import { randomUUID } from 'node:crypto';
import { CleanupRegistry } from './cleanup';
import { SsmCache } from './ssm-cache';

export interface TimingConfig {
  /** Default timeout for waitForEvent / waitForItem (ms) */
  eventTimeout: number;
  /** Poll interval for SQS / DDB polling (ms) */
  pollInterval: number;
  /** Canary warmup timeout (ms) */
  canaryTimeout: number;
  /** Number of retries for putEvent */
  putEventRetries: number;
  /** Base backoff for putEvent retries (ms) */
  putEventBackoffMs: number;
}

export interface TestContext {
  tenantId: string;
  userId: string;
  prefix: string;
  region: string;
  ssm: SsmCache;
  cleanup: CleanupRegistry;
  timings: TimingConfig;
}

function createTimingConfig(overrides?: Partial<TimingConfig>): TimingConfig {
  const multiplier = Number(process.env.INTEG_TIMEOUT_MULTIPLIER) || 1;
  return {
    eventTimeout: overrides?.eventTimeout ?? 90_000 * multiplier,
    pollInterval: overrides?.pollInterval ?? 500,
    canaryTimeout: overrides?.canaryTimeout ?? 60_000 * multiplier,
    putEventRetries: overrides?.putEventRetries ?? 3,
    putEventBackoffMs: overrides?.putEventBackoffMs ?? 500,
  };
}

export async function createTestContext(options?: {
  prefix?: string;
  region?: string;
  timings?: Partial<TimingConfig>;
}): Promise<TestContext> {
  if (
    process.env.CI === 'true' &&
    !options?.prefix &&
    !process.env.PREFIX
  ) {
    throw new Error(
      'createTestContext: running in CI (CI=true) but PREFIX is unset. ' +
        'Refusing to fall back to the shared "dev" prefix. ' +
        'Set PREFIX in the CI job env (e.g. sandbox-pr-${PR_NUMBER}) or pass options.prefix explicitly.',
    );
  }
  const prefix = options?.prefix ?? process.env.PREFIX ?? 'dev';
  const region = options?.region ?? 'us-east-1';
  const timestamp = Date.now();
  // Date.now() alone collides under --parallel=N when two test workers create a
  // context within the same millisecond. The trap's EB rule filters by
  // detail.context.tenantId, so a collision causes one trap to capture the
  // other test's events. Suffix with UUID entropy. The `integ-` prefix is
  // load-bearing: CDC publishers test-tag events on it (see change-data-capture.ts).
  const entropy = randomUUID().slice(0, 8);
  const cleanup = new CleanupRegistry();
  const ssm = new SsmCache(prefix, region);

  cleanup.register('SsmCache', () => {
    ssm.destroy();
    return Promise.resolve();
  });

  return {
    tenantId: `integ-${timestamp}-${entropy}`,
    userId: `integ-user-${timestamp}-${entropy}`,
    prefix,
    region,
    ssm,
    cleanup,
    timings: createTimingConfig(options?.timings),
  };
}
