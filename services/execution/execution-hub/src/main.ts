import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { ExecutionHubStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'execution-hub');

new ExecutionHubStack(app, `${config.prefix}-execution-hub`, {
  prefix: config.prefix,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
