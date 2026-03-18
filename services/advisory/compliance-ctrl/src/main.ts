import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { ComplianceCtrlStack } from './service.stack';

const subsystem = 'advisory';
const service = 'compliance-ctrl';

const app = new App();
const { prefix, account, region } = resolvePipelineConfig(app, service);

new ComplianceCtrlStack(app, `${prefix}-${service}`, {
  subsystem,
  service,
  prefix,
  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
