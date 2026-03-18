import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter, ParameterTier } from 'aws-cdk-lib/aws-ssm';
import { CfnResourceShare } from 'aws-cdk-lib/aws-ram';
import { IEventBus, CfnEventBusPolicy } from 'aws-cdk-lib/aws-events';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';

/** Map of domain subsystem names to the AWS account IDs that own them */
export interface DomainAccountMap {
  [subsystem: string]: string;
}

/**
 * Read domain account map from CDK context.
 * Returns undefined if single-account (no cross-account config).
 *
 * Usage in cdk.json:
 * {
 *   "context": {
 *     "domainAccounts": {
 *       "investor": "111111111111",
 *       "advisory": "222222222222",
 *       "execution": "333333333333",
 *       "ledger": "333333333333"
 *     }
 *   }
 * }
 */
export function getDomainAccounts(scope: Construct): DomainAccountMap | undefined {
  return scope.node.tryGetContext('domainAccounts');
}

// ────────────────────────────────────────────────────────────────────────────
// SharedParameter — Hub-side: Advanced SSM param + RAM share
// ────────────────────────────────────────────────────────────────────────────

export interface SharedParameterProps {
  parameterName: string;
  stringValue: string;
  description: string;
  /** Account IDs to share this parameter with. If empty, creates Standard tier (same-account). */
  consumerAccountIds?: string[];
}

/**
 * SSM parameter that is optionally shared cross-account via RAM.
 * - Single-account (no consumerAccountIds): creates a Standard tier parameter (current behavior).
 * - Multi-account: creates an Advanced tier parameter + RAM resource share.
 */
export class SharedParameter extends Construct {
  readonly parameter: StringParameter;

  constructor(scope: Construct, id: string, props: SharedParameterProps) {
    super(scope, id);

    const isCrossAccount = props.consumerAccountIds && props.consumerAccountIds.length > 0;

    this.parameter = new StringParameter(this, 'Param', {
      parameterName: props.parameterName,
      stringValue: props.stringValue,
      description: props.description,
      tier: isCrossAccount ? ParameterTier.ADVANCED : ParameterTier.STANDARD,
    });

    if (isCrossAccount) {
      new CfnResourceShare(this, 'Share', {
        name: `${props.parameterName.replace(/\//g, '-').slice(1)}-share`,
        resourceArns: [this.parameter.parameterArn],
        principals: props.consumerAccountIds,
        allowExternalPrincipals: false,
      });
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CrossAccountBusPolicy — Hub-side: allow PutEvents from consumer accounts
// ────────────────────────────────────────────────────────────────────────────

export interface CrossAccountBusPolicyProps {
  eventBus: IEventBus;
  consumerAccountIds: string[];
}

/**
 * Adds a resource policy to an EventBridge bus allowing cross-account PutEvents.
 */
export class CrossAccountBusPolicy extends Construct {
  constructor(scope: Construct, id: string, props: CrossAccountBusPolicyProps) {
    super(scope, id);

    const stack = Stack.of(this);

    new CfnEventBusPolicy(this, 'Policy', {
      eventBusName: props.eventBus.eventBusName,
      statementId: 'AllowCrossAccountPutEvents',
      statement: {
        Effect: 'Allow',
        Principal: { AWS: props.consumerAccountIds.map(id => `arn:aws:iam::${id}:root`) },
        Action: 'events:PutEvents',
        Resource: `arn:aws:events:${stack.region}:${stack.account}:event-bus/${props.eventBus.eventBusName}`,
      },
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// resolveBusArn — Consumer-side: resolve a domain bus ARN (same or cross-account)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a domain bus ARN. Supports both single-account and cross-account via RAM-shared SSM params.
 *
 * - Same account: uses `StringParameter.valueForStringParameter` (CloudFormation dynamic reference).
 * - Cross-account: uses `AwsCustomResource` to call `ssm:GetParameter` with the full parameter ARN
 *   (CloudFormation dynamic references don't support cross-account SSM).
 */
export function resolveBusArn(
  scope: Construct,
  id: string,
  prefix: string,
  subsystem: string,
  domainAccounts?: DomainAccountMap,
): string {
  const paramPath = `/nestfolio/${prefix}-${subsystem}/event-hub/busArn`;
  const ownerAccountId = domainAccounts?.[subsystem];
  const stack = Stack.of(scope);
  const isCrossAccount = ownerAccountId && ownerAccountId !== stack.account;

  if (!isCrossAccount) {
    return StringParameter.valueForStringParameter(scope, paramPath);
  }

  // Cross-account: AwsCustomResource calls ssm:GetParameter with full ARN
  const paramArn = `arn:aws:ssm:${stack.region}:${ownerAccountId}:parameter${paramPath}`;
  const cr = new AwsCustomResource(scope, `${id}Lookup`, {
    onUpdate: {
      service: 'SSM',
      action: 'getParameter',
      parameters: { Name: paramArn },
      physicalResourceId: PhysicalResourceId.of(`${id}-${paramArn}`),
    },
    policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: [paramArn] }),
  });

  return cr.getResponseField('Parameter.Value');
}

/**
 * Resolve an SSM parameter value, supporting cross-account via RAM-shared params.
 * Generic version of resolveBusArn for non-bus parameters (e.g. model IDs).
 */
export function resolveSsmValue(
  scope: Construct,
  id: string,
  paramPath: string,
  ownerAccountId?: string,
): string {
  const stack = Stack.of(scope);
  const isCrossAccount = ownerAccountId && ownerAccountId !== stack.account;

  if (!isCrossAccount) {
    return StringParameter.valueForStringParameter(scope, paramPath);
  }

  const paramArn = `arn:aws:ssm:${stack.region}:${ownerAccountId}:parameter${paramPath}`;
  const cr = new AwsCustomResource(scope, `${id}Lookup`, {
    onUpdate: {
      service: 'SSM',
      action: 'getParameter',
      parameters: { Name: paramArn },
      physicalResourceId: PhysicalResourceId.of(`${id}-${paramArn}`),
    },
    policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: [paramArn] }),
  });

  return cr.getResponseField('Parameter.Value');
}

/**
 * Get the list of unique account IDs from domain accounts map, excluding the current stack's account.
 * Useful for hub stacks to determine which accounts to share with.
 */
export function getConsumerAccountIds(scope: Construct, domainAccounts?: DomainAccountMap): string[] {
  if (!domainAccounts) return [];
  const stackAccount = Stack.of(scope).account;
  return [...new Set(Object.values(domainAccounts))].filter(id => id !== stackAccount);
}
