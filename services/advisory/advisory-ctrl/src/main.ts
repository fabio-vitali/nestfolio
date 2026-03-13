import { App } from 'aws-cdk-lib';
import { getPrefix } from '@nestfolio/cdk-constructs';
import { AdvisoryCtrlStack } from './service.stack';

const app = new App();
const prefix = getPrefix(app);

new AdvisoryCtrlStack(app, `${prefix}-advisory-ctrl`, {
  prefix,
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
