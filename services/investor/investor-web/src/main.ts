import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { InvestorWebStack } from './service.stack';

const app = new App();
const { prefix, account, region } = resolvePipelineConfig(app, 'investor-web');

new InvestorWebStack(app, `${prefix}-investor-web`, {
  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
