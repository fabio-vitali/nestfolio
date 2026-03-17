import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { LedgerAdptStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'ledger-adpt');

new LedgerAdptStack(app, `${config.prefix}-ledger-adpt`, {
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
