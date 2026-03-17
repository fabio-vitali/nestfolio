import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { InvestorAdptStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'investor-adpt');

new InvestorAdptStack(app, `${config.prefix}-investor-adpt`, {
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
