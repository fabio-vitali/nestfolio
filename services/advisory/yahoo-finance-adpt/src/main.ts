import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';
import { YahooFinanceAdptStack } from './service.stack';

const app = new App();
const { prefix, account, region, service, subsystem, schedule } = resolvePipelineConfig(
  app,
  'yahoo-finance-adpt',
);

new YahooFinanceAdptStack(app, `${prefix}-${service}`, {
  prefix,
  subsystem,
  service,
  schedule: schedule ?? { enabled: false, rate: 'rate(24 hours)' },
  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
