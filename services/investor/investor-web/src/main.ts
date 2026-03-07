import { App } from 'aws-cdk-lib';
import { InvestorWebStack } from './service.stack';

const app = new App();
const prefix = app.node.tryGetContext('prefix') ?? 'dev';

new InvestorWebStack(app, `${prefix}-investor-web`, {
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
