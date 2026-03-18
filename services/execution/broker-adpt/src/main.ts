import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { BrokerAdptStack } from './service.stack';

const subsystem = 'execution';
const service = 'broker-adpt';

const app = new App();
const { prefix, account, region } = resolvePipelineConfig(app, service);

new BrokerAdptStack(app, `${prefix}-broker-adpt`, {
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
