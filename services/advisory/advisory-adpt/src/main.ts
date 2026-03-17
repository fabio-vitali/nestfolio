import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { AdvisoryAdptStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'advisory-adpt');

new AdvisoryAdptStack(app, `${config.prefix}-advisory-adpt`, {
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
