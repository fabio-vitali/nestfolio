import { App } from 'aws-cdk-lib';
import * as os from 'os';
import { ServiceStage, ServiceStageProps, StageContext } from '../src/service-stage';
import { ServiceStack } from '../src/service-stack';
import { Construct } from 'constructs';

function createTestStack(scope: Construct, ctx: StageContext) {
  return new ServiceStack(scope, 'TestStack', {
    prefix: ctx.prefix,
    subsystem: 'investor',
    service: 'investor-bff',
    serviceDir: os.tmpdir(),
    terminationProtection: ctx.production,
    observability: ctx.observability,
  });
}

function createStage(overrides: Partial<ServiceStageProps> = {}) {
  const app = new App();
  return new ServiceStage(app, 'TestStage', {
    prefix: 'test',
    production: false,
    observability: true,
    env: { account: '123456789012', region: 'us-east-1' },
    stackFactory: (scope, ctx) => createTestStack(scope, ctx),
    ...overrides,
  });
}

describe('ServiceStage', () => {
  it('creates stage with prefix', () => {
    const stage = createStage();
    expect(stage.prefix).toBe('test');
  });

  it('exposes production flag', () => {
    const stage = createStage({ production: true });
    expect(stage.production).toBe(true);
  });

  it('exposes observability flag', () => {
    const stage = createStage({ observability: false });
    expect(stage.observability).toBe(false);
  });

  it('defaults observability to true', () => {
    const app = new App();
    const stage = new ServiceStage(app, 'S', {
      prefix: 'test',
      production: false,
      env: { account: '123456789012', region: 'us-east-1' },
      stackFactory: () => {},
    });
    expect(stage.observability).toBe(true);
  });

  it('sets terminationProtection when production is true', () => {
    const stage = createStage({ production: true });
    const assembly = stage.synth();
    const stackArtifact = assembly.stacks[0];
    expect(stackArtifact.terminationProtection).toBe(true);
  });

  it('creates the stack via stackFactory', () => {
    const stage = createStage();
    const assembly = stage.synth();
    expect(assembly.stacks).toHaveLength(1);
    expect(assembly.stacks[0].stackName).toBe('TestStage-TestStack');
  });

  it('passes StageContext to stackFactory', () => {
    let capturedCtx: StageContext | undefined;
    const app = new App();
    new ServiceStage(app, 'S', {
      prefix: 'staging',
      production: true,
      observability: false,
      env: { account: '123456789012', region: 'us-east-1' },
      stackFactory: (_scope, ctx) => { capturedCtx = ctx; },
    });
    expect(capturedCtx).toEqual({
      prefix: 'staging',
      production: true,
      observability: false,
    });
  });
});
