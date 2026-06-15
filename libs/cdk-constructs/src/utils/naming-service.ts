import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';

export interface NamingServiceConfig {
  /** Environment prefix (e.g. 'dev', 'staging', 'sandbox-pr-42') */
  prefix: string;
  /** Domain subsystem (e.g. 'investor', 'advisory', 'execution') */
  subsystem: string;
  /** Service name (e.g. 'investor-bff', 'advisory-ctrl') */
  service: string;
}

/** Discovers the subsystem for a service by scanning the services directory. */
export function discoverSubsystem(serviceName: string): string {
  const servicesDir = path.resolve(__dirname, '..', '..', '..', '..', 'services');
  if (!fs.existsSync(servicesDir)) {
    throw new Error(`Services directory not found: ${servicesDir}`);
  }

  for (const subsystem of fs.readdirSync(servicesDir)) {
    const subsystemDir = path.join(servicesDir, subsystem);
    if (!fs.statSync(subsystemDir).isDirectory()) continue;
    const mainTs = path.join(subsystemDir, serviceName, 'src', 'main.ts');
    if (fs.existsSync(mainTs)) return subsystem;
  }

  throw new Error(
    `Cannot discover subsystem for "${serviceName}". ` +
      `Expected a directory at services/{subsystem}/${serviceName}/src/main.ts`,
  );
}

/**
 * Generates consistent, prefixed resource names across all services.
 * Adapted from event-lab naming conventions.
 *
 * Pattern examples:
 *   eventBusName()    -> "dev-investor-event-bus"
 *   tableName()       -> "dev-investor-bff-table"
 *   queueName(suffix) -> "dev-investor-bff-queue" or "dev-investor-bff-suffix-queue"
 *   functionName(fn)  -> "dev-investor-bff-fn"
 *   ssmParameterPath('event-hub/busArn') -> "/nestfolio/dev-investor/event-hub/busArn"
 */
export class NamingService {
  readonly prefix: string;
  readonly subsystem: string;
  readonly service: string;

  constructor(config: NamingServiceConfig) {
    this.prefix = config.prefix;
    this.subsystem = config.subsystem;
    this.service = config.service;
  }

  /** Event bus name for the subsystem: "{prefix}-{subsystem}-event-bus" */
  eventBusName(): string {
    return `${this.prefix}-${this.subsystem}-event-bus`;
  }

  /** DynamoDB table name for the service: "{prefix}-{service}-table" */
  tableName(): string {
    return `${this.prefix}-${this.service}-table`;
  }

  /** SSM parameter path (subsystem-scoped): "/nestfolio/{prefix}-{subsystem}/{resourcePath}" */
  ssmParameterPath(resourcePath: string): string {
    return `/nestfolio/${this.prefix}-${this.subsystem}/${resourcePath}`;
  }

  /** SSM parameter path (service-scoped): "/nestfolio/{prefix}-{service}/{resourcePath}" */
  ssmServicePath(resourcePath: string): string {
    return `/nestfolio/${this.prefix}-${this.service}/${resourcePath}`;
  }

  /** SQS queue name for the service: "{prefix}-{service}-queue" or "{prefix}-{service}-{suffix}-queue" */
  queueName(suffix?: string): string {
    const base = `${this.prefix}-${this.service}`;
    return suffix ? `${base}-${suffix}-queue` : `${base}-queue`;
  }

  /** Knowledge Base S3 bucket name: "{account}-{prefix}-nestfolio-kb-{kbName}" */
  kbBucketName(kbName: string, account: string): string {
    return `${account}-${this.prefix}-nestfolio-kb-${kbName}`;
  }

  /**
   * MFE hosting S3 bucket name: "{account}-{prefix}-nestfolio-mfe-{mfeKey}".
   * NOTE: argument order intentionally differs from `kbBucketName(kbName, account)` —
   * call sites acquire `account` from the parent stack before knowing the mfeKey, so
   * account-first reads more naturally. Future cleanup may unify the two.
   */
  mfeBucketName(account: string, mfeKey: string): string {
    return `${account}-${this.prefix}-nestfolio-mfe-${mfeKey}`;
  }

  /** Lambda function name: "{prefix}-{service}-{functionSuffix}" */
  functionName(functionSuffix: string): string {
    return `${this.prefix}-${this.service}-${functionSuffix}`;
  }

  /** Full SSM parameter ARN for cross-account references */
  ssmParameterArn(accountId: string, region: string, resourcePath: string): string {
    return `arn:aws:ssm:${region}:${accountId}:parameter${this.ssmParameterPath(resourcePath)}`;
  }
}

/**
 * Reads and validates the "prefix" CDK context value.
 * Single source of truth for the context key name and validation.
 */
export function getPrefix(scope: Construct): string {
  const prefix = scope.node.tryGetContext('prefix');
  if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
  return prefix;
}

/**
 * Single source of truth for "does this deploy prefix denote a production
 * environment". Production environments KEEP RemovalPolicy.RETAIN on stateful
 * resources; every other environment (dev/sandbox/staging) gets DESTROY so
 * replaced resources clean up instead of orphaning.
 *
 * Used by {@link ServiceStack} (to default the `production` flag) and by
 * `resolvePipelineConfig` (to surface `production` in the resolved config).
 * Matches `detectTier`'s production detection.
 */
export function isProductionPrefix(prefix: string): boolean {
  return prefix === 'prod' || prefix === 'production';
}

/**
 * Factory function that creates a NamingService, reading the prefix from CDK context.
 * Usage: const naming = createNamingService(scope, { subsystem: 'investor', service: 'investor-bff' });
 */
export function createNamingService(
  scope: Construct,
  config: Omit<NamingServiceConfig, 'prefix'>,
): NamingService {
  return new NamingService({ ...config, prefix: getPrefix(scope) });
}
