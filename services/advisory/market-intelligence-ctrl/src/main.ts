import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';
import { MarketIntelligenceCtrlStack } from './service.stack';

const app = new App();
const { prefix, account, region, service, subsystem, observability } = resolvePipelineConfig(
  app,
  'market-intelligence-ctrl',
);

new MarketIntelligenceCtrlStack(app, `${prefix}-${service}`, {
  subsystem,
  service,
  prefix,
  observability,
  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
