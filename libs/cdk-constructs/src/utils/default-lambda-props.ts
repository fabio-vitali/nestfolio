import { Construct } from 'constructs';
import { Runtime, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';

/**
 * Default Lambda props for standard service handlers (30s timeout).
 * Note: SQS Ingress visibility timeout (180s) must be >= 6x this value.
 *
 * For richer workload-specific defaults, prefer the `LambdaProfile`
 * system in `./lambda-profiles.ts` (`handlerProps`, `adapterProps`,
 * `reducerProps`, `agentProps`).
 *
 * NOTE: log retention is intentionally NOT set — create functions via
 * `ManagedNodejsFunction`, which owns an explicit CFN-managed LogGroup so the
 * group is cleaned up with the function by the non-prod auto-delete Aspect.
 */
export const defaultLambdaProps = (_scope: Construct): Partial<NodejsFunctionProps> => ({
  runtime: Runtime.NODEJS_24_X,
  architecture: Architecture.ARM_64,
  memorySize: 256,
  timeout: Duration.seconds(30),
  tracing: Tracing.ACTIVE,
  bundling: {
    minify: true,
    sourceMap: true,
    target: 'node24',
    externalModules: ['@aws-sdk/*'],
  },
});
