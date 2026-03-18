import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { LedgerAdptStack } from './service.stack';

const subsystem = 'ledger';
const service = 'ledger-adpt';
const app = new App();
const { prefix, account, region } = resolvePipelineConfig(app, service);

new LedgerAdptStack(app, `${prefix}-${service}`, {
  prefix,
  subsystem,
  service,

  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
