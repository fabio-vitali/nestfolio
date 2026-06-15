import { Construct } from 'constructs';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

/**
 * A {@link NodejsFunction} that owns an explicit, CFN-managed CloudWatch
 * {@link LogGroup} instead of relying on the deprecated `logRetention` custom
 * resource.
 *
 * Why: `logRetention` only sets a retention policy on the `/aws/lambda/<fn>`
 * group that Lambda auto-creates at runtime — that group is NOT a CloudFormation
 * resource, so it is never deleted when the function is removed or replaced. The
 * result is the orphaned-log-group sprawl cleaned up in
 * `dev-orphaned-cfn-resources-cleanup`. By creating the LogGroup as a real CFN
 * resource and wiring it via Lambda Advanced Logging Controls, the group shares
 * the function's lifecycle and is swept up by {@link NonProdAutoDeleteAspect}
 * (DESTROY on non-prod) / RETAINed on production.
 *
 * Drop-in replacement for `new NodejsFunction(...)`. Any `logRetention` passed
 * in props is honoured as the LogGroup's retention and then stripped (CDK rejects
 * `logGroup` + `logRetention` together).
 */
export class ManagedNodejsFunction extends NodejsFunction {
  constructor(scope: Construct, id: string, props?: NodejsFunctionProps) {
    const logGroup = new LogGroup(scope, `${id}LogGroup`, {
      retention: props?.logRetention ?? RetentionDays.THREE_MONTHS,
    });
    super(scope, id, { ...props, logGroup, logRetention: undefined });
  }
}
