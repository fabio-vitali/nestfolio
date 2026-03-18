import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { SecEdgarAdptStack } from './service.stack';

const subsystem = 'advisory';
const service = 'sec-edgar-adpt';

const app = new App();
const config = resolvePipelineConfig(app, service);
const { prefix, account, region } = config;
const schedule = (config as any).schedule ?? { enabled: false, rate: 'rate(24 hours)' };

new SecEdgarAdptStack(app, `${prefix}-sec-edgar-adpt`, {
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
