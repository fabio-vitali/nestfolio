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

  return {
    tenantId: `integ-${timestamp}`,
    userId: `integ-user-${timestamp}`,
    prefix,
    region,
    ssm: new SsmCache(prefix, region),
    cleanup: new CleanupRegistry(),
  };
}
