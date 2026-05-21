/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'path';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { InvestorProfileCtrlStack } from '../../src/service.stack';

describe('InvestorProfileCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new InvestorProfileCtrlStack(app, 'TestStack', {
      prefix: 'test',
      service: 'investor-profile-ctrl',
      subsystem: 'advisory',
      serviceDir: join(__dirname, '..', '..', 'src'),
    });
    template = Template.fromStack(stack);
  });

  it('creates a DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('creates SQS queues for Ingress', () => {
    const queues = template.findResources('AWS::SQS::Queue');
    expect(Object.keys(queues).length).toBeGreaterThanOrEqual(2);
  });

  it('tunes the Ingress Lambda timeout to 150s and SQS visibility timeout to 240s', () => {
    // Continuous-projection writer with no production deadline — timing tuned
    // for fast SQS native redrive on maxVms saturation, not over-provisioned.
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({ Timeout: 150 }));
    template.hasResourceProperties('AWS::SQS::Queue', Match.objectLike({ VisibilityTimeout: 240 }));
  });

  it('creates EventBridge rules for inbound event types', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.anyValue(),
      }),
    });
  });

  it('creates Lambda functions for event-listener, CDC publisher, and KB ingestion', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(3);
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

  it('grants bedrock:StartIngestionJob to KB ingestion Lambda', () => {
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

  it('subscribes to INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, OPERATING_MODE_CHANGED — not ANALYZE_INVESTOR_PROFILE', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith([
          'INVESTOR_PROFILE_UPDATED',
          'MANDATE_ISSUED',
          'OPERATING_MODE_CHANGED',
        ]),
      }),
    });
    // Negative assertion: no rule subscribes to ANALYZE_INVESTOR_PROFILE
    const rules = template.findResources('AWS::Events::Rule');
    for (const rule of Object.values(rules)) {
      const detailTypes: string[] =
        (rule as any).Properties?.EventPattern?.['detail-type'] ?? [];
      expect(detailTypes).not.toContain('ANALYZE_INVESTOR_PROFILE');
    }
  });

  it('does not grant states:SendTaskSuccess or states:SendTaskFailure to any role', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    for (const policy of Object.values(policies)) {
      const statements: any[] =
        (policy as any).Properties?.PolicyDocument?.Statement ?? [];
      for (const stmt of statements) {
        const actions: string[] = Array.isArray(stmt.Action)
          ? stmt.Action
          : [stmt.Action];
        expect(actions).not.toContain('states:SendTaskSuccess');
        expect(actions).not.toContain('states:SendTaskFailure');
        expect(actions).not.toContain('states:SendTaskHeartbeat');
      }
    }
  });

  it('emits INVESTOR_PROFILE_SNAPSHOT_CREATED on InvestorProfileSnapshot:INSERT and _UPDATED on MODIFY', () => {
    // Egress construct declares CDC mappings via EVENT_TYPE_MAP env var on the publisher Lambda.
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          EVENT_TYPE_MAP: Match.stringLikeRegexp('InvestorProfileSnapshot'),
        }),
      }),
    });
    // Verify the actual mapping values are present in the JSON-encoded env var.
    const lambdas = template.findResources('AWS::Lambda::Function');
    const egressLambdaEntry = Object.values(lambdas).find((l: any) => {
      const vars = l.Properties?.Environment?.Variables ?? {};
      return typeof vars.EVENT_TYPE_MAP === 'string'
        && vars.EVENT_TYPE_MAP.includes('InvestorProfileSnapshot');
    }) as any;
    expect(egressLambdaEntry).toBeDefined();
    const map = egressLambdaEntry.Properties.Environment.Variables.EVENT_TYPE_MAP as string;
    expect(map).toContain('INVESTOR_PROFILE_SNAPSHOT_CREATED');
    expect(map).toContain('INVESTOR_PROFILE_SNAPSHOT_UPDATED');
  });
});
