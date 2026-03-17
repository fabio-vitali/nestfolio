import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { MarketwatchAdptStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'marketwatch-adpt');

const schedule = (config as any).schedule ?? { enabled: false, rate: 'rate(24 hours)' };

new MarketwatchAdptStack(app, `${config.prefix}-marketwatch-adpt`, {
  prefix: config.prefix,
  schedule,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
