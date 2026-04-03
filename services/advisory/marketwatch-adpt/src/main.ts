import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';
import { MarketwatchAdptStack } from './service.stack';

const app = new App();
const { prefix, account, region, service, subsystem, schedule, observability } = resolvePipelineConfig(
  app,
  'marketwatch-adpt',
);

new MarketwatchAdptStack(app, `${prefix}-${service}`, {
  subsystem,
  service,
  prefix,
  observability,
  schedule: schedule ?? { enabled: false, rate: 'rate(24 hours)' },
  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
