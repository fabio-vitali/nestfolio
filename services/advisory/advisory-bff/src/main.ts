import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { AdvisoryBffStack } from './service.stack';

const subsystem = 'advisory';
const service = 'advisory-bff';

const app = new App();
const { prefix, account, region } = resolvePipelineConfig(app, service);

new AdvisoryBffStack(app, `${prefix}-advisory-bff`, {
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
