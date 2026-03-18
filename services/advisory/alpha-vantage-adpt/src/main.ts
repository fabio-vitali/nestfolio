import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { AlphaVantageAdptStack } from './service.stack';

const subsystem = 'advisory';
const service = 'alpha-vantage-adpt';

const app = new App();
const config = resolvePipelineConfig(app, service);
const { prefix, account, region } = config;
const schedule = (config as any).schedule ?? { enabled: false, rate: 'rate(24 hours)' };

new AlphaVantageAdptStack(app, `${prefix}-alpha-vantage-adpt`, {
  serviceDir: __dirname,
  prefix,
  subsystem,
  service,
  schedule,
  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
