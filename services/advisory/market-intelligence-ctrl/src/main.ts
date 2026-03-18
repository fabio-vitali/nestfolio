import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { MarketIntelligenceCtrlStack } from './service.stack';

const subsystem = 'advisory';
const service = 'market-intelligence-ctrl';

const app = new App();
const { prefix, account, region } = resolvePipelineConfig(app, service);

new MarketIntelligenceCtrlStack(app, `${prefix}-market-intelligence-ctrl`, {
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
