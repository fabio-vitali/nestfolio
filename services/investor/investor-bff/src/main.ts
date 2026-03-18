import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { InvestorBffStack } from './service.stack';

const subsystem = 'investor';
const service = 'investor-bff';

const app = new App();
const { prefix, account, region } = resolvePipelineConfig(app, service);

new InvestorBffStack(app, `${prefix}-${service}`, {
  prefix,
  subsystem,
  service,
  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
