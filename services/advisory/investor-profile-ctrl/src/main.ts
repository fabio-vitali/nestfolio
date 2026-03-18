import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { InvestorProfileCtrlStack } from './service.stack';

const subsystem = 'advisory';
const service = 'investor-profile-ctrl';

const app = new App();
const { prefix, account, region } = resolvePipelineConfig(app, service);

new InvestorProfileCtrlStack(app, `${prefix}-investor-profile-ctrl`, {
  serviceDir: __dirname,
  subsystem,
  service,
  prefix,
  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
