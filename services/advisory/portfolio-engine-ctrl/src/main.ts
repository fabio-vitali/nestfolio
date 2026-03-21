import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs/utils';
import { PortfolioEngineCtrlStack } from './service.stack';

const app = new App();
const { prefix, account, region, service, subsystem } = resolvePipelineConfig(
  app,
  'portfolio-engine-ctrl',
);

new PortfolioEngineCtrlStack(app, `${prefix}-${service}`, {
  subsystem,
  service,
  prefix,
  env: {
    account: account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
