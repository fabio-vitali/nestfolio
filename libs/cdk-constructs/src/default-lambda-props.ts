import { Construct } from 'constructs';
import { Runtime, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';

/**
 * Default Lambda props for standard service handlers (30s timeout).
 * Note: SQS Ingress visibility timeout (180s) must be >= 6x this value.
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

/**
 * Lambda props for agent-related functions (tool targets, agent invokers).
 * Uses 180s timeout to accommodate Bedrock model invocations.
 * Note: SQS Ingress visibility timeout must be >= 6x this value (1080s) when used with SQS.
 */
export const agentLambdaProps = (_scope: Construct): Partial<NodejsFunctionProps> => ({
  ...defaultLambdaProps(_scope),
  timeout: Duration.seconds(180),
  memorySize: 512,
});
