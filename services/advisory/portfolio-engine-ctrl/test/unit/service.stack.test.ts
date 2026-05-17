/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'path';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { PortfolioEngineCtrlStack } from '../../src/service.stack';

describe('PortfolioEngineCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new PortfolioEngineCtrlStack(app, 'TestStack', {
      prefix: 'test',
      service: 'portfolio-engine-ctrl',
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

  it('creates EventBridge rules', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({ 'detail-type': Match.anyValue() }),
    });
  });

  it('creates the expected Lambda functions (event-listener, CDC, KB ingestion)', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    const logicalIds = Object.keys(lambdas);
    expect(logicalIds.some((id) => id.includes('PortfolioLookup'))).toBe(false);
    expect(logicalIds.some((id) => id.includes('Ingress'))).toBe(true);
    expect(logicalIds.some((id) => id.includes('Egress'))).toBe(true);
    expect(logicalIds.some((id) => id.includes('KBIngestion'))).toBe(true);
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

  it('does not grant states:SendTaskSuccess or states:SendTaskFailure to any role', () => {
    // Post advisory-cycle-agent-precomputation Task 6: PE-ctrl emits
    // AgentCompletion / AgentFailure CDC rows; DWC's CallbackIngress owns
    // the states:SendTask* grants exclusively.
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

  it('emits PORTFOLIO_COMPLETED on AgentCompletion:INSERT and PORTFOLIO_FAILED on AgentFailure:INSERT', () => {
    // Egress construct declares CDC mappings via EVENT_TYPE_MAP env var on the
    // publisher Lambda (JSON-encoded). Verify both completion + failure rows
    // are present alongside the pre-existing mappings.
    const lambdas = template.findResources('AWS::Lambda::Function');
    const egressLambdaEntry = Object.values(lambdas).find((l: any) => {
      const vars = l.Properties?.Environment?.Variables ?? {};
      return typeof vars.EVENT_TYPE_MAP === 'string'
        && vars.EVENT_TYPE_MAP.includes('AgentCompletion');
    }) as any;
    expect(egressLambdaEntry).toBeDefined();
    const map = egressLambdaEntry.Properties.Environment.Variables.EVENT_TYPE_MAP as string;
    expect(map).toContain('AgentCompletion');
    expect(map).toContain('PORTFOLIO_COMPLETED');
    expect(map).toContain('AgentFailure');
    expect(map).toContain('PORTFOLIO_FAILED');
  });
});
