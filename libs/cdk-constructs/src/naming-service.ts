import { Construct } from 'constructs';

export interface NamingServiceConfig {
  /** Environment prefix (e.g. 'dev', 'staging', 'sandbox-pr-42') */
  prefix: string;
  /** Domain subsystem (e.g. 'investor', 'advisory', 'execution') */
  subsystem: string;
  /** Service name (e.g. 'investor-bff', 'advisory-ctrl') */
  service: string;
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
  private readonly prefix: string;
  private readonly subsystem: string;
  private readonly service: string;

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

  /** SSM parameter path: "/nestfolio/{prefix}-{subsystem}/{resourcePath}" */
  ssmParameterPath(resourcePath: string): string {
    return `/nestfolio/${this.prefix}-${this.subsystem}/${resourcePath}`;
  }

  /** SQS queue name for the service: "{prefix}-{service}-queue" or "{prefix}-{service}-{suffix}-queue" */
  queueName(suffix?: string): string {
    const base = `${this.prefix}-${this.service}`;
    return suffix ? `${base}-${suffix}-queue` : `${base}-queue`;
  }

  /** Lambda function name: "{prefix}-{service}-{functionSuffix}" */
  functionName(functionSuffix: string): string {
    return `${this.prefix}-${this.service}-${functionSuffix}`;
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
 * Factory function that creates a NamingService, reading the prefix from CDK context.
 * Usage: const naming = createNamingService(scope, { subsystem: 'investor', service: 'investor-bff' });
 */
export function createNamingService(
  scope: Construct,
  config: Omit<NamingServiceConfig, 'prefix'>,
): NamingService {
  return new NamingService({ ...config, prefix: getPrefix(scope) });
}
