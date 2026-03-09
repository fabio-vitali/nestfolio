import { App } from 'aws-cdk-lib';
import { InvestorCtrlStack } from './service.stack';

const app = new App();
const prefix = app.node.tryGetContext('prefix');
if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');

new InvestorCtrlStack(app, `${prefix}-investor-ctrl`, {
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
