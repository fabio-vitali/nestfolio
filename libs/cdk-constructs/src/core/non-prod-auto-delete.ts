import { IAspect, RemovalPolicy, CfnResource } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

/**
 * Stateful resource types whose old physical resource would otherwise be
 * RETAINed (and orphaned) on replacement. Deleting any of these is non-blocking
 * regardless of contents — unlike S3 buckets, which also need `autoDeleteObjects`
 * and are therefore handled by their constructs (State/knowledge-base/mfe-bucket),
 * not this Aspect.
 */
const AUTO_DELETE_TYPES = new Set<string>([
  'AWS::DynamoDB::Table',
  'AWS::DynamoDB::GlobalTable',
  'AWS::Logs::LogGroup',
]);

/**
 * On NON-production stacks, forces `DeletionPolicy` + `UpdateReplacePolicy` =
 * `Delete` on stateful resources that CDK defaults to RETAIN.
 *
 * Why: CDK auto-names physical resources with a hash suffix, and the State /
 * orchestration constructs default to RemovalPolicy.RETAIN. So any REPLACEMENT
 * (logical-id churn, a GSI/stream/key-schema change, or removing a construct)
 * leaves the old physical table/log-group behind — the orphan sprawl cleaned up
 * in `dev-orphaned-cfn-resources-cleanup`. Forcing DESTROY on dev/sandbox/staging
 * makes replacements self-clean; production keeps RETAIN for safety.
 *
 * Wired in {@link ServiceStack} only when `!production`, so it covers every
 * table and (CFN-managed) log group in the stack from one place.
 */
export class NonProdAutoDeleteAspect implements IAspect {
  visit(node: IConstruct): void {
    if (node instanceof CfnResource && AUTO_DELETE_TYPES.has(node.cfnResourceType)) {
      node.applyRemovalPolicy(RemovalPolicy.DESTROY);
    }
  }
}
