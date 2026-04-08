import { CleanupRegistry } from './cleanup';
import { SsmCache } from './ssm-cache';

export interface IntegrationContext {
  tenantId: string;
  userId: string;
  prefix: string;
  region: string;
  ssm: SsmCache;
  cleanup: CleanupRegistry;
}

export async function createIntegrationContext(options?: {
  prefix?: string;
  region?: string;
}): Promise<IntegrationContext> {
  const prefix = options?.prefix ?? 'dev';
  const region = options?.region ?? 'us-east-1';
  const timestamp = Date.now();
  const cleanup = new CleanupRegistry();
  const ssm = new SsmCache(prefix, region);

  cleanup.register('SsmCache', () => {
    ssm.destroy();
    return Promise.resolve();
  });

  return {
    tenantId: `integ-${timestamp}`,
    userId: `integ-user-${timestamp}`,
    prefix,
    region,
    ssm,
    cleanup,
  };
}
