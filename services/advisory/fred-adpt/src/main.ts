import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { FredAdptStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'fred-adpt');

const schedule = (config as any).schedule ?? { enabled: false, rate: 'rate(24 hours)' };

new FredAdptStack(app, `${config.prefix}-fred-adpt`, {
  prefix: config.prefix,
  schedule,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
