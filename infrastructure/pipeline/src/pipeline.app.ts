import { App } from 'aws-cdk-lib';
import { ShellStep } from 'aws-cdk-lib/pipelines';
import { GitHubWorkflow, AwsCredentials } from 'cdk-pipelines-github';
import { join } from 'path';
import { ServiceStage } from '@nestfolio/cdk-constructs';
import { discoverServices, groupByPhase, resolveServiceDir, loadStackClass } from './discover-services';

const workspaceRoot = join(__dirname, '..', '..', '..');
const app = new App();

const accountId = app.node.tryGetContext('account') ?? process.env['CDK_DEFAULT_ACCOUNT'];
const region = app.node.tryGetContext('region') ?? 'us-east-1';
if (!accountId) throw new Error('"account" context or CDK_DEFAULT_ACCOUNT is required');

const roleArn = `arn:aws:iam::${accountId}:role/nestfolio-github-actions-role`;

// Discover services
const allServices = discoverServices(workspaceRoot);
const phases = groupByPhase(allServices);
const sortedPhases = Array.from(phases.keys()).sort();

// --- Pipeline ---

const pipeline = new GitHubWorkflow(app, 'NestfolioPipeline', {
  synth: new ShellStep('Synth', {
    installCommands: ['npm install -g pnpm'],
    commands: [
      'pnpm install --frozen-lockfile',
      'ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)',
      `TS_NODE_TRANSPILE_ONLY=1 npx cdk synth --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/pipeline.app.ts' -c account=$ACCOUNT_ID -c region=${region}`,
    ],
  }),
  awsCreds: AwsCredentials.fromOpenIdConnect({
    gitHubActionRoleArn: roleArn,
  }),
  workflowPath: '.github/workflows/deploy.yml',
  workflowTriggers: {
    push: { branches: ['main'] },
  },
});

// Helper: create a ServiceStage for a single service
function createServiceStage(
  svc: ReturnType<typeof discoverServices>[number],
  prefix: string,
  production: boolean,
  observability: boolean,
  env: { account: string; region: string },
): ServiceStage {
  const serviceDir = resolveServiceDir(workspaceRoot, svc);
  const StackClass = loadStackClass(serviceDir, svc.service);

  return new ServiceStage(app, `${prefix}-${svc.service}`, {
    prefix,
    production,
    observability,
    env,
    stackFactory: (scope, ctx) => {
      new StackClass(scope, `${prefix}-${svc.service}-stack`, {
        prefix: ctx.prefix,
        terminationProtection: ctx.production,
        observability: ctx.observability,
        env,
      });
    },
  });
}

// --- Staging (auto-deploy on push to main, observability enabled) ---

const stagingEnv = { account: accountId, region };

for (const phase of sortedPhases) {
  const servicesInPhase = phases.get(phase)!;
  const wave = pipeline.addGitHubWave(`Staging-Phase-${phase}`);

  for (const svc of servicesInPhase) {
    const stage = createServiceStage(svc, 'staging', false, true, stagingEnv);
    wave.addStageWithGitHubOptions(stage, {
      gitHubEnvironment: { name: 'staging' },
    });
  }
}

// --- Production (manual approval via GitHub Environment, observability enabled) ---

const prodEnv = { account: accountId, region };

for (const phase of sortedPhases) {
  const servicesInPhase = phases.get(phase)!;
  const wave = pipeline.addGitHubWave(`Prod-Phase-${phase}`);

  for (const svc of servicesInPhase) {
    const stage = createServiceStage(svc, 'prod', true, true, prodEnv);
    wave.addStageWithGitHubOptions(stage, {
      gitHubEnvironment: { name: 'production' },
    });
  }
}

app.synth();
