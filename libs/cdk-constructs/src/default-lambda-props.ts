import { Construct } from 'constructs';
import { Runtime, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';

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
  },
});
