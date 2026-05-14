/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'path';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AdvisoryNarrativeCtrlStack } from '../../src/service.stack';

describe('AdvisoryNarrativeCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new AdvisoryNarrativeCtrlStack(app, 'TestStack', {
      prefix: 'test',
      service: 'advisory-narrative-ctrl',
      subsystem: 'advisory',
      serviceDir: join(__dirname, '..', '..', 'src'),
    });
    template = Template.fromStack(stack);
  });

  it('creates a DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('creates SQS queues', () => {
    const queues = template.findResources('AWS::SQS::Queue');
    expect(Object.keys(queues).length).toBeGreaterThanOrEqual(2);
  });

  it('creates EventBridge rules for 2 inbound event types', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({ 'detail-type': Match.anyValue() }),
    });
  });

  it('creates Lambda functions', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(2);
  });

  it('creates an S3 bucket for KB content', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('grants bedrock:StartIngestionJob', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const allStatements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement ?? [],
    );
    const actions = allStatements.flatMap((s: any) =>
      Array.isArray(s.Action) ? s.Action : [s.Action],
    );
    expect(actions).toContain('bedrock:StartIngestionJob');
  });

  it('grants events:PutEvents to the AgentRuntime execution role', () => {
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: {
        Roles: Match.arrayWith([
          Match.objectLike({ Ref: Match.stringLikeRegexp('.*AgentRuntime.*') }),
        ]),
      },
    });
    expect(Object.keys(policies).length).toBeGreaterThan(0);

    const statements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement ?? [],
    );
    const actions = statements.flatMap((s: { Action: string | string[] }) =>
      Array.isArray(s.Action) ? s.Action : [s.Action],
    );
    expect(actions).toContain('events:PutEvents');
  });

  it('grants RetrieveMemoryRecords but not BatchCreate/ListMemoryRecords (inter-agent state via SF, not Memory)', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const allStatements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement ?? [],
    );
    const actions = allStatements.flatMap((s: any) =>
      Array.isArray(s.Action) ? s.Action : [s.Action],
    );
    expect(actions).toContain('bedrock-agentcore:RetrieveMemoryRecords');
    expect(actions).not.toContain('bedrock-agentcore:BatchCreateMemoryRecords');
    expect(actions).not.toContain('bedrock-agentcore:ListMemoryRecords');
  });
});
