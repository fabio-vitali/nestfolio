import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { ReconciliationCtrlStack } from './service.stack';

const subsystem = 'ledger';
const service = 'reconciliation-ctrl';

const app = new App();
const { prefix, account, region } = resolvePipelineConfig(app, service);

new ReconciliationCtrlStack(app, `${prefix}-reconciliation-ctrl`, {
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
