import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { LedgerCtrlStack } from './service.stack';

const subsystem = 'ledger';
const service = 'ledger-ctrl';

const app = new App();
const { prefix, account, region } = resolvePipelineConfig(app, service);

new LedgerCtrlStack(app, `${prefix}-${service}`, {
  subsystem,
  service,
  prefix,
  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
