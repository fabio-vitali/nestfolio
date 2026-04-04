import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';
import { DashboardBffStack } from './service.stack';

const app = new App();
const { prefix, account, region, service, subsystem, observability, waf } = resolvePipelineConfig(app, 'dashboard-bff');

new DashboardBffStack(app, `${prefix}-${service}`, {
  subsystem,
  service,
  prefix,
  observability,
  waf,
  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
