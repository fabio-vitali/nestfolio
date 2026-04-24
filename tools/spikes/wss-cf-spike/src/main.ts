import 'dotenv/config';
import { App } from 'aws-cdk-lib';
import { join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { SpikeStack } from './spike.stack';

dotenvConfig({ path: join(__dirname, '..', '.env.local') });

const required = ['APPSYNC_API_ID', 'APPSYNC_REALTIME_HOST', 'AWS_REGION'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const app = new App();

new SpikeStack(app, 'WssCfSpikeStack', {
  env: {
    region: process.env.AWS_REGION!,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  appsyncRealtimeHost: process.env.APPSYNC_REALTIME_HOST!,
});
